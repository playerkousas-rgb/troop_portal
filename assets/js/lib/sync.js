/* ============================================================
   sync.js — 同步引擎（BUILD §3 同步與多人寫入）
   ------------------------------------------------------------
   呢支係 offline.js 嘅「司機」：offline.js 有算法（三色燈、樂觀鎖、
   merge3、backoff、隊列），sync.js 負責同真通道（/api/proxy）駁埋。

   規矩：
     · 示範模式（_mock）：零 fetch，一切照舊（UI 唔會扮同步）
     · 樂觀鎖：base ＝我上次見到嘅版本／內容；server 有變 → 三路合併
     · 同一格兩邊都改 → **唔自動揀**：mode='ask' 會回 conflicts 俾 UI 逐格問
       （用我／用佢），答完再 `syncNow({ decisions })` 一次就寫
     · 無人看場（mode='batch'）：serverTime 新者勝，但留底（overwrote）
     · 送唔到（離線／5xx）→ 入本機隊列（≤200 筆），backoff＋jitter 重試
     · API 可以注入（測試用），默認真通道
   ============================================================ */
import * as S from './store.js';
import * as API from './api.js';
import {
  lightOf, makeVersion, readQueue, saveQueue, pushQueue, clearQueue, withRetry,
  merge3Rows, merge3Batch, backoffMs, versionNewer, queueDue, failQueueItem, nextRetryIn, isRetriable
} from './offline.js';

export const isLive = () => !S.isMock();
/** 網絡層例外（斷網／URL 唔啱）都要變成人話，唔可以爆出去 */
const safeCall = async (fn, where) => {
  try { return await fn(); }
  catch (e) { return { ok: false, code: where === 'load' ? 'load_fail' : 'save_fail', msg: `${where === 'load' ? '讀後端' : '寫後端'}出錯：${String(e?.message || e)}` }; }
};
const K_STATE = 'troop.sync';

/* ------------------------- 狀態／燈號 ------------------------- */
export function state() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(K_STATE) || 'null'); } catch { raw = null; }
  return {
    dirty: 0, failing: 0, lastError: null, everSaved: true, lastAt: 0, lastWrote: [],
    base: null, baseVersion: '', pending: [], ...(raw || {})
  };
}
function store(patch) {
  const next = { ...state(), ...patch };
  try { localStorage.setItem(K_STATE, JSON.stringify(next)); } catch { /* 滿咗都唔可以爆 */ }
  return next;
}
export function light() {
  const st = state();
  return lightOf({ dirty: st.dirty, failing: st.failing, lastError: st.lastError, everSaved: st.everSaved });
}
export function queueSize() { return readQueue().length; }
export function resetSync() { try { localStorage.removeItem(K_STATE); } catch { } clearQueue(); }

/** 本機改咗嘢（準備寫之前叫） */
export function markDirty(n = 1) { return store({ dirty: (state().dirty || 0) + n }); }
/** 第一次成功讀／寫之後：記住「server 當時係咩樣」做下次合併嘅 base */
export function markBase(tables, version = '') {
  return store({ base: tables || null, baseVersion: version || makeVersion(), dirty: 0, failing: 0, lastError: null, lastAt: Date.now(), everSaved: true, pending: [] });
}

/* ------------------------- 逐格衝突（UI 用） ------------------------- */
/** merge3Rows 嘅 asks 係 { id, fields:[…] } —— 呢度攤平成「一格一問」俾 UI */
export function flattenAsks(asks = [], { table = '', baseRows = [], mineRows = [], theirsRows = [] } = {}) {
  const by = rows => Object.fromEntries((rows || []).map(r => [String(r?.id), r]));
  const b = by(baseRows), m = by(mineRows), t = by(theirsRows);
  return (asks || []).flatMap(a => (a.fields || []).map(f => ({
    table, id: String(a.id), field: f,
    base: b[String(a.id)]?.[f], mine: m[String(a.id)]?.[f], theirs: t[String(a.id)]?.[f],
    key: `${table}|${a.id}|${f}`
  })));
}
/** 「一格一問」清單（UI 用） */
export function conflictList(asks = []) {
  return asks.map((a, i) => ({
    i, table: a.table || '', id: String(a.id ?? ''), field: String(a.field ?? ''),
    mine: a.mine, theirs: a.theirs, key: a.key || `${a.table || ''}|${a.id ?? ''}|${a.field ?? ''}`,
    label: `${a.table ? a.table + ' · ' : ''}${a.id ?? ''}${a.field ? ' · ' + a.field : ''}`
  }));
}
/** 用戶揀完（decisions ＝ { key: 'mine'|'theirs' }）→ 直接改落已合併嘅行度
    （merge3Rows 嘅 rows 已經幫每格留住「我」嘅值，所以揀「佢」＝覆蓋，揀「我」＝唔郁） */
export function applyDecisions(rows = [], asks = [], decisions = {}) {
  const picked = { mine: 0, theirs: 0 };
  const out = rows.map(r => ({ ...r }));
  asks.forEach(a => {
    const key = a.key || `${a.table || ''}|${a.id ?? ''}|${a.field ?? ''}`;
    const take = decisions[key] === 'theirs' ? 'theirs' : 'mine';
    picked[take]++;
    if (take === 'mine') return;
    const row = out.find(r => String(r.id) === String(a.id));
    if (row) row[a.field] = a.theirs;
  });
  return { rows: out, picked };
}

/* ------------------------- 主流程 ------------------------- */
/**
 * 同步一次。
 * @param {{api?, mode?:'ask'|'batch', tables?, decisions?:object}} o
 *   mode='ask'（預設，有人看場）→ 同格衝突唔會自動揀，回 { code:'need_decisions', conflicts }
 *   mode='batch'（無人看場）→ 同格衝突 serverTime 新者勝，回 overwrote 留底
 * @returns { ok, code?, light, asks?, conflicts?, overwrote?, wrote?, queued? }
 */
export async function syncNow({ api = API, mode = 'ask', tables = null, decisions = null, _retried = false } = {}) {
  if (!isLive()) return { ok: false, code: 'mock', light: light() };          // 鐵律：示範零 fetch
  const st = state();
  const mine = tables || API.changedTables();

  /* 讀後端（只讀要寫嘅表）—— loadTables 會回 server 版本，記住做 baseVersion */
  const keys = Object.keys(mine);
  /* ★ 讀都要 backoff＋jitter：後端忙／斷網嗰陣唔好一鎚定生死（之前只有寫入有重試） */
  const readTry = await withRetry(
    () => safeCall(() => (api.loadTables ? api.loadTables(keys) : api.gasAction('loadTables', { tables: keys })), 'load'),
    { onRetry: ({ n, wait }) => store({ failing: n, lastError: `讀後端失敗 —— ${wait}ms 後自動再試（第 ${n} 次）` }) });
  const remote = readTry.result || { ok: false, code: readTry.code || 'load_fail' };
  if (!remote.ok) return failSave(remote, mine, 'load');
  const theirs = remote.data?.data || remote.data?.tables || {};
  const base = st.base || {};

  const merged = {}, asks = [], overwrote = [], picked = { mine: 0, theirs: 0 };
  for (const [t, rows] of Object.entries(mine)) {
    const list = Array.isArray(rows) ? rows : [];
    const bRows = base[t] || [], tRows = theirs[t] || [];
    if (mode === 'batch') {
      /* 無人看場：同格衝突 serverTime 新者勝（但留底，之後 UI 會見到 overwrote） */
      const key = x => String(x.id);
      const r = merge3Batch({
        base: Object.fromEntries(bRows.map(x => [key(x), x])),
        mine: Object.fromEntries(list.map(x => [key(x), x])),
        theirs: Object.fromEntries(tRows.map(x => [key(x), x]))
      });
      merged[t] = Object.values(r.merged);
      overwrote.push(...(r.overwrote || []).map(o => ({ ...o, table: t })));
      continue;
    }
    const r = merge3Rows(bRows, list, tRows, 'id');
    /* 新增／刪除／唔同欄各自保留；同一格 → 問 */
    if (!r.asks?.length) { merged[t] = r.rows; continue; }
    const flat = flattenAsks(r.asks, { table: t, baseRows: bRows, mineRows: list, theirsRows: tRows });
    if (!decisions) { asks.push(...flat); merged[t] = null; continue; }        // 未答 → 唔寫呢張表
    const answered = applyDecisions(r.rows, flat, decisions);
    merged[t] = answered.rows;
    picked.mine += answered.picked.mine; picked.theirs += answered.picked.theirs;
  }

  if (asks.length && !decisions) {
    store({ pending: asks, baseVersion: remote.data?.version || st.baseVersion });
    return { ok: false, code: 'need_decisions', asks, conflicts: conflictList(asks), light: light() };
  }
  Object.keys(merged).forEach(k => { if (merged[k] === null) delete merged[k]; });

  /* ★ 樂觀鎖：連 baseVersion 一齊交俾 GAS —— 對唔上就係「有人搶先寫」，GAS 唔會覆蓋 */
  const wrote = await withRetry(() => safeCall(() => api.saveTables(merged, { baseVersion: st.baseVersion || remote.data?.version || '' }), 'save'), { onRetry: n => store({ failing: n }) });
  if (!wrote.ok) {
    /* 撞版：重新讀一次再合併（只自動重試一次；仲撞就叫人再撳，唔會無限迴圈） */
    if ((wrote.code === 'conflict' || wrote.conflict) && !_retried) {
      store({ baseVersion: wrote.version || '', lastError: '撞版（有人搶先寫）—— 自動重新合併一次' });
      return syncNow({ api, mode, tables, decisions, _retried: true });
    }
    return failSave(wrote, merged, 'save');
  }

  store({
    base: { ...(st.base || {}), ...merged }, baseVersion: wrote.data?.version || remote.data?.version || '',
    dirty: 0, failing: 0, lastError: null, lastAt: Date.now(), everSaved: true, pending: [], lastWrote: Object.keys(merged),
    lastConflictPicked: decisions ? picked : null
  });
  if (readQueue().length) clearQueue();
  return { ok: true, merged, wrote: Object.keys(merged), overwrote, picked, light: light() };
}
function failSave(res, tables, where) {
  const st = state();
  const now = Date.now();
  /* ★ 隊列記住「試過幾次、下次幾時試」——唔會無限即刻敲，亦唔會好快就死心 */
  const item = failQueueItem({ at: new Date(now).toISOString(), tables }, { now });
  const queued = pushQueue(item);
  store({
    failing: (st.failing || 0) + 1, lastError: res.msg || res.code || where, dirty: (st.dirty || 0) + 1,
    nextRetryAt: item.nextAt, queueTries: item.tries
  });
  return {
    ok: false, code: res.code || where + '_fail', msg: res.msg, queued,
    nextRetryAt: item.nextAt, nextRetryMs: item.nextAt - now, retriable: isRetriable(res.code), light: light()
  };
}

/** 隊列仲有幾多（UI 顯示用；同 queueSize 一樣，留個別名免混淆） */
export const pendingQueue = () => readQueue().length;
/**
 * 重試隊列：將**夠鐘**嘅隊列項再送（成唔成功都要老實報）。
 * @param {{api?, now?:number, force?:boolean, rand?:Function}} o
 *   force=true＝用戶自己撳「即刻重試」：唔理 backoff 都要試（人手優先）
 */
export async function drainQueue({ api = API, now = Date.now(), force = false, rand = Math.random } = {}) {
  const q = readQueue();
  if (!q.length) return { ok: true, sent: 0, remaining: 0, due: 0 };
  if (!isLive()) return { ok: false, code: 'mock' };
  const due = force ? q : queueDue(q, now);
  if (!due.length) {
    return { ok: false, code: 'not_due', remaining: q.length, due: 0, nextRetryMs: nextRetryIn(q, now), msg: `仲未夠鐘（backoff 中）—— 約 ${Math.ceil(nextRetryIn(q, now) / 1000)} 秒後自動再試` };
  }
  const merged = Object.assign({}, ...due.map(x => x.tables || {}));
  const r = await withRetry(() => safeCall(() => api.saveTables(merged), 'save'));
  if (r.ok) {
    saveQueue(q.filter(x => !due.includes(x)));                       // 只清送咗嗰啲（後面新加嘅留住）
    const left = readQueue().length;
    store({ dirty: left, failing: 0, lastError: left ? state().lastError : null, lastAt: Date.now(), nextRetryAt: 0 });
    return { ok: true, sent: due.length, remaining: left };
  }
  /* 失敗：逐筆記次數＋下次時間（backoff＋jitter）；唔會跌 */
  const failed = q.map(x => (due.includes(x) ? failQueueItem(x, { now, rand }) : x));
  saveQueue(failed);
  store({ failing: (state().failing || 0) + 1, lastError: r.msg || r.code, nextRetryAt: Math.min(...failed.map(x => Number(x.nextAt) || 0)) });
  return { ok: false, code: r.code || 'fail', msg: r.msg, remaining: failed.length, nextRetryMs: nextRetryIn(failed, now) };
}

/* 隊列健康（UI 顯示「下次幾時試」用） */
export function queueInfo(now = Date.now()) {
  const q = readQueue();
  return {
    size: q.length, due: queueDue(q, now).length,
    nextRetryMs: nextRetryIn(q, now), tries: q.reduce((m, x) => Math.max(m, Number(x?.tries) || 0), 0),
    lastTryAt: q.map(x => x.lastTryAt || '').filter(Boolean).sort().pop() || ''
  };
}
/** 有隊列夠鐘未？夠鐘就自動送一次（APP 開機／回到前景時叫；唔會自己無限跑）
    防重入：開機同「回前景」可以同時叫 —— 唔想同一個隊列兩邊一齊送（會撞版） */
let _draining = null;
export async function drainIfDue({ api = API, now = Date.now() } = {}) {
  if (!isLive() || !queueDue(readQueue(), now).length) return { ok: true, skipped: true };
  if (_draining) return _draining;
  _draining = drainQueue({ api, now }).finally(() => { _draining = null; });
  return _draining;
}

export { backoffMs, versionNewer, merge3Rows, isRetriable };

/* ============================================================
   offline.js — 離線優先 · 樂觀鎖 · 排隊重試 · 錯誤碼（BUILD §3／§10-3、§10-7）
   ------------------------------------------------------------
   BUILD 要求（一句一句對）：
     · 離線優先：黃（本機有未寫入）／綠（同後端一致）／紅（寫入失敗）
     · 版本由 server 派；寫入帶 `baseVersion`；撞版回 `conflict:true`
     · ScriptLock busy → 前端**排隊重試**（backoff ＋ jitter）
     · 錯誤碼統一（下面 ERROR_CODES 就係唯一字典）
   本檔零依賴、唔會自己 fetch（寫入一律經 api.js 嘅唯一掣）。
   ============================================================ */

/* ---------------- 錯誤碼字典（唯一來源；前後端共用同一批字） ---------------- */
export const ERROR_CODES = {
  not_configured: { tone: 'r', label: '後端未設定', msg: 'ADMIN 未放 Vercel env（TROOP_<旅ID>_BACKEND／_APIKEY）' },
  bad_backend: { tone: 'r', label: '後端網址唔啱', msg: 'GAS 部署要係 /exec 網址' },
  network: { tone: 'r', label: '連唔到後端', msg: '可能係網絡問題，改動仍然留喺部機' },
  bad_response: { tone: 'r', label: '後端回應唔明', msg: '回應唔似我哋嘅格式（可能係登入頁 HTML）' },
  bad_key: { tone: 'r', label: 'apikey 唔啱', msg: '要 ADMIN 對返 Vercel env 嘅 APIKEY' },
  bad_sig: { tone: 'r', label: '簽名唔啱', msg: '接駁資料同下游登記唔對；重新登記一次' },
  need_auth: { tone: 'y', label: '要登入', msg: 'session 過期——再登入一次就繼續' },
  no_session: { tone: 'y', label: '要登入', msg: 'session 過期，登入後重試' },
  need_chief: { tone: 'y', label: '只有旅長做得', msg: '呢個動作係旅長專用（你嘅角色唔夠）' },
  need_leader: { tone: 'y', label: '只有旅長／教練員做得', msg: '呢個動作係旅長或教練員專用' },
  must_change_pw: { tone: 'y', label: '要先改密碼', msg: '首登要改咗密碼先做得嘢' },
  rate_limited: { tone: 'y', label: '試得太密', msg: '等一等再試（保護帳號／防灌單）' },
  keep_one: { tone: 'y', label: '唔可以刪最後一個', msg: '每個支部至少要留一個領袖戶' },
  pending_hash: { tone: 'y', label: '未設密碼', msg: '帳號等緊設定密碼（用邀請連結）' },
  disabled: { tone: 'y', label: '帳號停用咗', msg: '請旅部開返' },
  write_fail: { tone: 'r', label: '寫入失敗', msg: '後端寫唔到（改動留返本機，可以再試）' },
  confirm_fail: { tone: 'r', label: '自證唔過', msg: '寫完讀返同送出唔一致 → 當失敗，唔會扮成功' },
  conflict: { tone: 'y', label: '有人改过同一行', msg: '後端版本比你新（或者你比佢新）→ 逐格確認' },
  busy: { tone: 'y', label: '後端正忙', msg: '有其他寫入排緊隊 → 自動重試' },
  timeout: { tone: 'r', label: '逾時', msg: '後端 20 秒冇回應，可以再試' },
  mock: { tone: '', label: '示範模式', msg: '示範模式唔會發任何請求' },
  not_allowed: { tone: 'y', label: '呢種分享唔開放', msg: '只有通告＋活動分享得（Sprint 4 定案）' },
  unknown: { tone: 'r', label: '未預期嘅錯', msg: '睇 log／報告俾 ADMIN' }
};
export const codeInfo = code => ERROR_CODES[code] || { ...ERROR_CODES.unknown, code };

/* ---------------- 三色燈（離線優先） ---------------- */
/** green＝同後端一致；yellow＝本機有未寫入／正在重試；red＝寫入失敗或者連唔到 */
export function lightOf({ dirty = 0, failing = false, lastError = null, everSaved = true } = {}) {
  if (failing || lastError) return { light: 'red', label: '紅：寫入有問題', detail: lastError ? codeInfo(lastError).msg : '上一次寫入失敗' };
  if (dirty > 0) return { light: 'yellow', label: `黃：${dirty} 項未寫入後端`, detail: '撳「儲存到後端」先會寫；登出唔會代你寫' };
  return { light: 'green', label: everSaved ? '綠：同後端一致' : '綠：未有改動', detail: '冇未寫入嘅嘢' };
}

/* ---------------- 版本（樂觀鎖） ---------------- */
/** server 派嘅版本：ISO 時間 ＋ 隨機尾數（同一秒都分得開） */
export function makeVersion(now = Date.now(), rand = Math.random) {
  return new Date(now).toISOString().replace('Z', '') + '-' + Math.floor(rand() * 0xffff).toString(16).padStart(4, '0');
}
/** 兩個版本邊個新（唔可以解析＝當「唔知」，唔會亂當新） */
export function versionNewer(a, b) {
  if (!a || !b) return null;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(a) || !/^\d{4}-\d{2}-\d{2}T/.test(b)) return null;
  return a > b;
}
/** 對比本機同後端：邊張表／邊行撞版 */
export function diffVersions(local = {}, remote = {}) {
  const out = { same: [], localNewer: [], remoteNewer: [], unknown: [], conflicts: [] };
  const keys = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]);
  keys.forEach(k => {
    const l = local?.[k], r = remote?.[k];
    if (l === r) { out.same.push(k); return; }
    const newer = versionNewer(l, r);
    if (newer === true) out.localNewer.push(k);
    else if (newer === false) out.remoteNewer.push(k);
    else if (l && r) out.conflicts.push(k);
    else if (l) out.localNewer.push(k);
    else out.remoteNewer.push(k);
  });
  return out;
}
/**
 * 寫入被拒（conflict）嗰陣：逐格（逐表）決定用邊個
 * @param {{tables:object, baseVersion:string, remoteVersion:string, remoteTables:object}} args
 */
export function resolveConflict({ tables = {}, baseVersion, remoteVersion, remoteTables = {} } = {}) {
  const newer = versionNewer(remoteVersion, baseVersion);
  if (newer === true) {
    /* 後端新：預設唔覆蓋後端；列出每張表嘅差別由人決定 */
    return {
      action: 'needs_review',
      note: '後端版本比你開工嗰陣新 —— 逐表揀「用我嘅」定「用後端嘅」，唔會自動覆蓋',
      perTable: Object.keys(tables).map(t => ({
        table: t,
        mine: (tables[t] || []).length,
        theirs: (remoteTables[t] || []).length,
        default: 'theirs'
      }))
    };
  }
  if (newer === false) return { action: 'retry_mine', note: '你嘅版本較新：用你嘅重試', perTable: Object.keys(tables).map(t => ({ table: t, default: 'mine' })) };
  return { action: 'manual', note: '版本比唔到（未知）→ 唔會自動做，要人手揀', perTable: Object.keys(tables).map(t => ({ table: t, default: 'ask' })) };
}

/* ---------------- merge3：欄位級三方合併（BUILD §3） ----------------
   base ＝ 登入嗰陣嘅快照；mine ＝ 我改咗嘅；theirs ＝ 後端而家嘅
   規矩（照 BUILD 寫）：
     · 唔同欄各自保留（我改嗰欄用我嘅、佢改嗰欄用佢嘅）
     · **同一格兩邊都改過** → 唔自動揀，彈出嚟由用戶逐格確認（ask）
     · 批量／無人看場 → serverTime 新者勝 ＋ 紅點留底（記低食咗邊個改動）
   ---------------------------------------------------------------- */
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

/**
 * 三方合併一個物件（逐欄；值係 array 都當一欄）
 * @returns {{merged:object, fields:object, asks:string[], took:string}}
 */
export function merge3(base = {}, mine = {}, theirs = {}) {
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(mine || {}), ...Object.keys(theirs || {})]);
  const merged = {}, fields = {}, asks = [];
  keys.forEach(k => {
    const b = base?.[k], m = mine?.[k], t = theirs?.[k];
    const mineChanged = !same(m, b), theirsChanged = !same(t, b);
    if (mineChanged && theirsChanged) {
      if (same(m, t)) { merged[k] = clone(m); fields[k] = 'both-same'; }           // 兩邊改到一樣 → 冇衝突
      else { asks.push(k); fields[k] = 'ask'; merged[k] = clone(m); }              // 同一格衝突 → 留我嘅，等用戶揀
    } else if (mineChanged) { merged[k] = clone(m); fields[k] = 'mine'; }
    else if (theirsChanged) { merged[k] = clone(t); fields[k] = 'theirs'; }
    else { merged[k] = clone(b); fields[k] = 'same'; }
  });
  return { merged, fields, asks, took: asks.length ? 'ask' : 'merged' };
}
/** 批量／無人看場：同格衝突用 serverTime 新者勝，但留底（紅點紀錄） */
export function merge3Batch({ base = {}, mine = {}, theirs = {}, mineAt = 0, theirsAt = 0 } = {}) {
  const r = merge3(base, mine, theirs);
  const theirsNewer = Number(theirsAt) > Number(mineAt);
  const overwrote = [];
  r.asks.forEach(k => {
    r.merged[k] = clone(theirsNewer ? theirs[k] : mine[k]);
    r.fields[k] = theirsNewer ? 'theirs-serverTime' : 'mine-serverTime';
    overwrote.push({ field: k, took: theirsNewer ? 'theirs' : 'mine', why: 'serverTime 新者勝（無人看場）' });
  });
  return { ...r, asks: [], took: 'serverTime', overwrote };
}
/** 逐行合併：以 id 對齊；兩邊都改同一行同一欄 → ask */
export function merge3Rows(baseRows = [], mineRows = [], theirsRows = [], key = 'id') {
  const by = rows => Object.fromEntries((Array.isArray(rows) ? rows : []).map(r => [String(r?.[key]), r]));
  const b = by(baseRows), m = by(mineRows), t = by(theirsRows);
  const ids = new Set([...Object.keys(b), ...Object.keys(m), ...Object.keys(t)]);
  const out = { rows: [], asks: [], added: [], deleted: [] };
  ids.forEach(id => {
    const base = b[id], mine = m[id], theirs = t[id];
    if (base && !mine && !theirs) return;
    if (base && mine && !theirs) { out.deleted.push(id); return; }              // 佢刪咗
    if (base && theirs && !mine) { out.deleted.push(id); return; }              // 我刪咗
    if (!base && mine) { out.rows.push(clone(mine)); out.added.push(id); return; }      // 我新增
    if (!base && theirs) { out.rows.push(clone(theirs)); out.added.push(id); return; }  // 佢新增
    const r = merge3(base || {}, mine || {}, theirs || {});
    if (r.asks.length) out.asks.push({ id, fields: r.asks });
    out.rows.push({ ...r.merged, [key]: id });
  });
  return out;
}

/* ---------------- 排隊重試（backoff ＋ jitter） ---------------- */
export const RETRY = { tries: 5, baseMs: 250, capMs: 8000 };
/** 第 n 次重試等幾多（毫秒）：指數 ＋ 隨機抖動（防同時重試撞埋） */
export function backoffMs(n, { baseMs = RETRY.baseMs, capMs = RETRY.capMs, rand = Math.random } = {}) {
  const raw = Math.min(capMs, baseMs * Math.pow(2, Math.max(0, n - 1)));
  return Math.round(raw * (0.5 + rand() * 0.5));         // 50%~100% 抖動
}
export const isRetriable = code => ['busy', 'timeout', 'network', 'rate_limited'].includes(String(code));

/**
 * 帶重試嘅執行器（唔會自己 fetch；caller 傳入做嘢嘅函式）
 * @returns {{ok:boolean, code?:string, result?:any, tries:number, log:string[]}}
 */
export async function withRetry(fn, { tries = RETRY.tries, rand = Math.random, sleep = ms => new Promise(r => setTimeout(r, ms)), onRetry = null } = {}) {
  const log = [];
  for (let n = 1; n <= tries; n++) {
    let r = null;
    try { r = await fn(n); } catch (e) { r = { ok: false, code: 'network', msg: String(e?.message || e) }; }
    if (r && r.ok !== false) return { ok: true, result: r, tries: n, log };
    const code = r?.code || 'unknown';
    log.push(`第 ${n} 次：${code}`);
    if (!isRetriable(code) || n === tries) return { ok: false, code, result: r, tries: n, log };
    const wait = backoffMs(n, { rand });
    log.push(`等 ${wait}ms 再試（backoff＋jitter）`);
    if (onRetry) onRetry({ n, code, wait });
    await sleep(wait);
  }
  return { ok: false, code: 'unknown', tries, log };
}

/* ---------------- 離線隊列（本機暫存改動；唔會自動送） ---------------- */
const K_QUEUE = 'troop.queue.v1';
export function readQueue(storage = globalThis.localStorage) {
  try { return JSON.parse(storage.getItem(K_QUEUE) || '[]'); } catch { return []; }
}
export function pushQueue(item, storage = globalThis.localStorage) {
  const q = readQueue(storage); q.push({ ...item, at: item.at || new Date().toISOString() });
  storage.setItem(K_QUEUE, JSON.stringify(q.slice(-200)));         // 上限 200 筆
  return q.length;
}
export function clearQueue(storage = globalThis.localStorage) { storage.setItem(K_QUEUE, '[]'); }

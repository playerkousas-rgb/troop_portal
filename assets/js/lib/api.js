/* ============================================================
   api.js — 旅前端 ↔ 後端（真模式）唯一通道
   ------------------------------------------------------------
   鐵律：
     · 前端**永遠唔會**直接打 GAS／見 apikey：一律同源 `/api/*`
     · 示範模式（`_mock`）：全部函式即刻回 { ok:false, code:'mock' }，
       **唔會發任何請求**（smoke 有一條測試釘死呢點）
     · 未設定後端／session 過期 → 老實講，唔會扮成功
   ============================================================ */
import * as S from './store.js';

/** 資料欄 ↔ 旅 SHEET 分頁（要同 Code.gs TABLES 對得上） */
export const TABLE_MAP = {
  users: '旅員', branches: '支部', modules: '模組開關', financeSubmits: '財務整合',
  inventory: '物資整合', notices: '旅通告', calendar: '旅行事曆', publicInfo: '公開資料',
  shares: '分享', rescues: '求救', invites: '邀請', applications: '申請', transfers: '移交',
  docs: '教材', progress: '進度摘要', settings: '設定值'
};

export const isLive = () => !S.isMock();
export const unitId = () => String(S.load()?.unit?.code || '').replace(/^0+(?=\d)/, '') || '';

let savedSnapshot = null;                  // 上次寫入成功嘅快照（用嚟計邊啲表有改）

/** 有改動嘅表（同 GAS 分頁名對應） */
export function changedTables(data = S.load()) {
  const cur = JSON.parse(JSON.stringify(data));
  delete cur._mock; delete cur.meta;
  const out = {};
  Object.entries(TABLE_MAP).forEach(([key, gasName]) => {
    const now = JSON.stringify(cur[key] ?? null);
    const was = savedSnapshot ? JSON.stringify(savedSnapshot[key] ?? null) : null;
    if (now !== was) out[gasName] = cur[key] ?? [];
  });
  return out;
}
export function markBaseline(data = S.load()) {
  const snap = JSON.parse(JSON.stringify(data));
  delete snap._mock; delete snap.meta;
  savedSnapshot = snap;
}

/* ------------------------- 底層 ------------------------- */
/* ★ 錯誤碼統一（BUILD §10 條 7）：HTTP 狀態 → 一個穩定嘅 code，
   分清楚「重試有意義」（busy／timeout／network／rate_limited）同「重試都冇用」（權限／規則／版本）。
   前端唔會再單靠 message 文字判斷係咪應該 backoff。 */
export function codeForStatus(status, hasBody = false) {
  const n = Number(status) || 0;
  if (n === 429) return 'rate_limited';
  if (n === 408) return 'timeout';
  if (n === 502 || n === 503 || n === 504) return 'busy';
  if (n >= 500) return hasBody ? 'fail' : 'busy';       // 有 JSON（業務錯）就照 code；純 5xx＝後端忙
  if (n === 401 || n === 403) return 'no_session';
  if (n === 404) return 'not_found';
  return 'fail';
}
const rawPost = async (path, body) => {
  let r;
  try {
    r = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify(body || {})
    });
  } catch (e) {
    /* 斷網／DNS／CORS／被攔：一律 network（可重試），唔可以爆出去 */
    return { ok: false, code: 'network', msg: `連唔到伺服器（${String(e?.message || e)}）—— 改動會留住，等下次再試`, http: 0 };
  }
  const j = await r.json().catch(() => null);
  if (!j) {
    const code = codeForStatus(r.status, false);
    return { ok: false, code, msg: r.status >= 500 ? `後端忙緊（HTTP ${r.status}）—— 等等再試` : `回應唔係 JSON（HTTP ${r.status}）`, http: r.status };
  }
  if (j.success === true) return { ok: true, data: j.data, note: j.note, http: r.status };
  return { ok: false, code: j.code || codeForStatus(r.status, true), msg: j.error || '失敗', http: r.status };
};
/** ★ 靜默刷新：session 靜靜到期會令做做下嘅嘢白做 —— 收到 401 就續期一次再重試（只一次，唔會無限迴圈） */
const isMockSessionGuard = () => !isLive();
let _retryOnce = false;
const jfetch = async (path, body) => {
  const out = await rawPost(path, body);
  if (out.code === 'no_session' && !_retryOnce && !isMockSessionGuard()) {
    _retryOnce = true;
    try {
      const { refreshSession } = await import('./auth.js');
      const rf = await refreshSession();
      if (rf.ok) return await rawPost(path, body);
    } finally { _retryOnce = false; }
  }
  return out;
};
const guard = () => (isLive() ? null : { ok: false, code: 'mock', msg: '示範模式：唔會發任何請求' });

/* ------------------------- 登入／session ------------------------- */
export async function login(email, password) {
  const g = guard(); if (g) return g;
  return jfetch('/api/auth', { action: 'login', unit: unitId(), email, password });
}
export async function session() {
  const g = guard(); if (g) return g;
  return jfetch('/api/auth', { action: 'session' });
}
export async function logout() {
  const g = guard(); if (g) return g;
  return jfetch('/api/auth', { action: 'logout' });
}
export async function changePassword(email, newPassword, oldPassword) {
  const g = guard(); if (g) return g;
  return jfetch('/api/auth', { action: 'changePassword', unit: unitId(), email, newPassword, oldPassword });
}
/* 忘記密碼：要求一次性連結（唔會講個 email 有冇戶口） */
export async function forgotPassword(email) {
  const g = guard(); if (g) return g;
  return jfetch('/api/auth', { action: 'forgot', unit: unitId(), email });
}
/* 一次性 setup token 設密碼（第一個旅長／重設密碼共用同一條路線；GAS 永遠唔見明文） */
export async function setupWithToken(token, password, email) {
  const g = guard(); if (g) return g;
  return jfetch('/api/auth', { action: 'setupFirstChief', unit: unitId(), token, password, email });
}
export async function redeemInvite(token, password, email, name) {
  const g = guard(); if (g) return g;
  return jfetch('/api/auth', { action: 'redeemInvite', unit: unitId(), token, password, email, name });
}

/* ------------------------- 讀寫旅 SHEET ------------------------- */
/* ★ 樂觀鎖版本：sync.js 每次同步成功會推上去；其他寫入路線（main.js 儲存掣）攞嚟做 baseVersion，
   避免「用舊資料覆蓋人哋啱啱寫嘅嘢」 */
let _baseVersion = '';
export const baseVersion = () => _baseVersion;
export const setBaseVersion = v => { _baseVersion = String(v || ''); return _baseVersion; };
export async function loadTables(tables) {
  const g = guard(); if (g) return g;
  /* 讀取樂觀化：後端會回 consistent（pointer 覆查結果）——原封不動交俾同步層判斷 */
  const out = await jfetch('/api/proxy', { action: 'loadTables', unit: unitId(), payload: { tables } });
  if (out.ok && out.data?.version) setBaseVersion(out.data.version);       // 記住 server 版本做下次寫入嘅 base
  return out;
}
export async function saveTables(data, { baseVersion: bv = null } = {}) {
  const g = guard(); if (g) return g;
  /* baseVersion＝樂觀鎖：對唔上 GAS 會回 conflict（唔會覆蓋人哋嘅改動）；
     唔傳＝用上次同步記住嘅版本（sync.js／main.js 共用） */
  const payload = { data, baseVersion: bv === null ? _baseVersion : String(bv || '') };
  const out = await jfetch('/api/proxy', { action: 'saveTables', unit: unitId(), payload });
  if (out.ok && out.data?.version) setBaseVersion(out.data.version);
  if (out.conflict || out.code === 'conflict') return { ...out, hint: '有人搶先寫過 —— 重新讀一次再合併（唔會覆蓋）' };
  return out;
}
/* ------------------------- P4：移交與升降團（BUILD §6） ------------------------- */
export async function transferOut(payload) {
  const g = guard(); if (g) return g;
  return jfetch('/api/proxy', { action: 'transferOut', unit: unitId(), payload });
}
export async function importTransferBundle(payload) {
  const g = guard(); if (g) return g;
  return jfetch('/api/proxy', { action: 'importTransferBundle', unit: unitId(), payload });
}
/* ------------------------- P6b：家長子女綁定（要該團領袖確認） ------------------------- */
/* 後端實況（系統 → 後端）：status／dbInfo 都係讀取，會如實報分件現況 */
export async function dbInfo() {
  const g = guard(); if (g) return g;
  return jfetch('/api/proxy', { action: 'dbInfo', unit: unitId(), payload: {} });
}
export async function backendStatus() {
  const g = guard(); if (g) return g;
  return jfetch('/api/proxy', { action: 'status', unit: unitId(), payload: {} });
}

export async function bindChild(payload) {
  const g = guard(); if (g) return g;
  return jfetch('/api/proxy', { action: 'bindChild', unit: unitId(), payload });
}
export async function decideBind(payload) {
  const g = guard(); if (g) return g;
  return jfetch('/api/proxy', { action: 'decideBind', unit: unitId(), payload });
}
export async function gasAction(action, payload = {}) {
  const g = guard(); if (g) return g;
  return jfetch('/api/proxy', { action, unit: unitId(), payload });
}
/* ------------------------- P1：聚合／註冊表／分享／求救 ------------------------- */
/** 旅層聚合讀取（分層 cache：通告活動 5 分鐘、財務物資 30 分鐘） */
export async function troop({ fresh = false } = {}) {
  const g = guard(); if (g) return g;
  const r = await fetch(`/api/troop?unit=${encodeURIComponent(unitId())}${fresh ? '&fresh=1' : ''}`, { credentials: 'same-origin' });
  const j = await r.json().catch(() => null);
  return j && j.success === true ? { ok: true, data: j.data } : { ok: false, code: (j && j.code) || 'fail', msg: (j && j.error) || `HTTP ${r.status}` };
}
/** 能力註冊表（呢個旅開咗邊啲模組／呢個支部用唔用得） */
export async function registry({ branch = '', fresh = false } = {}) {
  const g = guard(); if (g) return g;
  const qs = new URLSearchParams({ unit: unitId() });
  if (branch) qs.set('branch', branch);
  if (fresh) qs.set('fresh', '1');
  const r = await fetch(`/api/registry?${qs}`, { credentials: 'same-origin' });
  const j = await r.json().catch(() => null);
  return j && j.success === true ? { ok: true, data: j.data } : { ok: false, code: (j && j.code) || 'fail', msg: (j && j.error) || `HTTP ${r.status}` };
}
/** 成員入口導流（M1 一次登入／M3 轉去該團入口）—— 唔會做帳號枚舉 */
export async function memberEntry(branch) {
  const g = guard(); if (g) return g;
  const r = await fetch(`/api/member-entry?unit=${encodeURIComponent(unitId())}&branch=${encodeURIComponent(branch)}`, { credentials: 'same-origin' });
  const j = await r.json().catch(() => null);
  return j && j.success === true ? { ok: true, data: j.data } : { ok: false, code: (j && j.code) || 'fail', msg: (j && j.error) || `HTTP ${r.status}` };
}
/** 產生有簽名嘅公開分享連結（通告／活動；最長 90 日） */
export async function shareLink({ kind, id, to = '', days = 30 } = {}) {
  const g = guard(); if (g) return g;
  return jfetch('/api/share', { action: 'create', unit: unitId(), kind, id, to, exp: Date.now() + days * 24 * 3600 * 1000 });
}
/** 求救／問題回報**落旅 SHEET**（免登入都用得：ADMIN 先喺旅系統見到） */
export async function saveRescue(rescue) {
  const g = guard(); if (g) return g;
  return jfetch('/api/proxy', { action: 'saveRescue', unit: unitId(), payload: { rescue } });
}
/** 發起分享（寫入旅 SHEET `分享` 表） */
export async function saveShare(share) {
  const g = guard(); if (g) return g;
  return jfetch('/api/proxy', { action: 'saveShare', unit: unitId(), payload: { share } });
}

export async function getDownstreams({ fresh = false } = {}) {
  const g = guard(); if (g) return g;
  const r = await fetch(`/api/downstreams?unit=${encodeURIComponent(unitId())}${fresh ? '&fresh=1' : ''}`, { credentials: 'same-origin' });
  const j = await r.json().catch(() => null);
  return j && j.success === true ? { ok: true, data: j.data } : { ok: false, msg: (j && j.error) || `HTTP ${r.status}` };
}

/* ------------------------- 唯一寫入掣嘅真模式實現 ------------------------- */
/**
 * 逐表寫 → 讀返自證 → 收據（真模式）
 * @returns {{ok:boolean, confirmed?:boolean, wrote?:object, readBack?:object, fails?:string[], msg?:string, ms?:number}}
 */
export async function pushToBackend() {
  const g = guard(); if (g) return g;
  const data = changedTables();
  const names = Object.keys(data);
  if (!names.length) return { ok: true, confirmed: true, wrote: {}, readBack: {}, fails: [], msg: '冇改動（唔使寫）' };
  const t0 = Date.now();
  let r = await saveTables(data);
  let ms = Date.now() - t0;
  /* ★ 撞版（有人搶先寫）：拉最新資料落本機（merge 由 sync.js 嘅三路合併做），
     呢度只誠實講「撞版，改動仍然留住喺本機」，唔會硬覆蓋。 */
  if (!r.ok && (r.code === 'conflict' || r.conflict)) {
    return { ok: false, confirmed: false, conflict: true, code: 'conflict', msg: '有人搶先寫過（版本對唔上）—— 已經幫你拉返最新版本落本機；請去「系統 → 同步」做一次三路合併（唔會覆蓋人哋嘅改動）', ms };
  }
  if (!r.ok) return { ok: false, confirmed: false, msg: r.msg, code: r.code, ms };
  const d = r.data || {};
  /* confirmed 為準：GAS 讀返自證唔齊 → 當失敗（改動留返本機） */
  if (d.confirmed !== true) return { ok: false, confirmed: false, wrote: d.wrote, readBack: d.readBack, fails: d.fails || [], msg: '後端自證唔齊（改動留返本機）', ms };
  S.markSaved();
  markBaseline();
  return { ok: true, confirmed: true, wrote: d.wrote || {}, readBack: d.readBack || {}, fails: d.fails || [], ms };
}

/** 真模式開機：由旅 SHEET 拉資料，寫入本機 store */
export async function pullFromBackend(tables) {
  const g = guard(); if (g) return g;
  const r = await loadTables(tables);
  if (!r.ok) return r;
  const byGas = r.data?.data || {};
  const patch = {};
  Object.entries(TABLE_MAP).forEach(([key, gasName]) => { if (byGas[gasName]) patch[key] = byGas[gasName]; });
  if (Object.keys(patch).length) {
    S.commit(d => { Object.assign(d, patch); }, { markDirty: false });
    markBaseline();
  }
  return { ok: true, data: { tables: Object.keys(patch), version: r.data?.version } };
}

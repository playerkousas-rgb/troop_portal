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
const jfetch = async (path, body) => {
  const r = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', body: JSON.stringify(body || {})
  });
  const j = await r.json().catch(() => null);
  if (!j) return { ok: false, code: 'bad_response', msg: `回應唔係 JSON（HTTP ${r.status}）` };
  return j.success === true ? { ok: true, data: j.data, note: j.note } : { ok: false, code: j.code || 'fail', msg: j.error || '失敗', http: r.status };
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
export async function redeemInvite(token, password, email, name) {
  const g = guard(); if (g) return g;
  return jfetch('/api/auth', { action: 'redeemInvite', unit: unitId(), token, password, email, name });
}

/* ------------------------- 讀寫旅 SHEET ------------------------- */
export async function loadTables(tables) {
  const g = guard(); if (g) return g;
  return jfetch('/api/proxy', { action: 'loadTables', unit: unitId(), payload: { tables } });
}
export async function saveTables(data) {
  const g = guard(); if (g) return g;
  return jfetch('/api/proxy', { action: 'saveTables', unit: unitId(), payload: { data } });
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
  const r = await saveTables(data);
  const ms = Date.now() - t0;
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

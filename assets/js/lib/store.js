/* ============================================================
   store.js — 單一狀態來源（示範模式住瀏覽器）
   ------------------------------------------------------------
   ★ 鐵律：**寫入後端只有一個掣**（頂部「儲存到後端」）。
     其他任何時候改動＝只改本機（黃點）＋計入「N 項未寫入」。
   ★ 示範模式（MOCK）：資料住 localStorage，永遠唔會送去任何後端；
     真模式：同樣嘅函式會經 /api/proxy 打旅 GAS /exec。
   ============================================================ */

import { makeDemo } from './demo.js';
import { deepClone, toast } from './util.js';
import { defaultRankFor } from './registry.js';

const K_DATA = 'troop.demo.db.v1';
const K_SESSION = 'troop.session.v1';
const K_PREFS = 'troop.prefs.v1';

let data = null;
let session = null;
let prefs = null;
let dirty = 0;                // 未寫入後端嘅改動數
const listeners = new Set();

/* ---------------- 載入／儲存 ---------------- */
function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function write(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { toast('本機儲存空間不足（示範資料）', 'warn'); }
}

export function load() {
  if (data) return data;
  data = read(K_DATA, null) || makeDemo();
  if (!data.settings) data.settings = makeDemo().settings;
  session = read(K_SESSION, null);
  prefs = read(K_PREFS, { view: {}, hideDemoBanner: false, chosenUnit: '' });
  return data;
}
export const getSession = () => session;
export const getPrefs = () => prefs;

export function setSession(s) {
  session = s;
  write(K_SESSION, s);
  notify();
}
export function clearSession() {
  session = null;
  try { localStorage.removeItem(K_SESSION); } catch {}
  notify();
}
export function setPref(k, v) { prefs[k] = v; write(K_PREFS, prefs); notify(); }

/** 改動資料（只改本機）：mutator 直接改 draft，之後 markDirty */
function nowStr() {
  const n = new Date(), p = x => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ${p(n.getHours())}:${p(n.getMinutes())}`;
}

export function commit(mutator, { markDirty = true, silent = false } = {}) {
  const d = load();
  mutator(d);
  if (markDirty) dirty += 1;
  write(K_DATA, d);
  if (!silent) notify();
  return d;
}

export const isMock = () => !!load()._mock;
export const dirtyCount = () => dirty;
export function markSaved() { dirty = 0; notify(); }
/** 重新載入示範資料（示範模式專用；真模式 = 由後端拉） */
export function resetDemo() {
  data = makeDemo();
  write(K_DATA, data);
  dirty = 0;
  notify();
}
export function exportAll() {
  const d = deepClone(load());
  d._exportedFrom = isMock() ? 'mock' : 'real';
  d._exportedAt = new Date().toISOString();
  return d;
}
export function importAll(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('JSON 格式錯誤');
  data = obj;
  write(K_DATA, data);
  dirty = 1;
  notify();
}

/* ---------------- 訂閱 ---------------- */
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function notify() { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }

/* ---------------- 常用查詢 ---------------- */
export const branches = () => load().branches;
export const branchById = id => branches().find(b => b.id === id) || null;
export const branchName = id => (id === 'troop' ? '旅部' : (branchById(id)?.name || id || '—'));
export const users = () => load().users;
export const userById = id => users().find(u => u.id === id) || null;
export const membersOf = branchId => load().members.filter(m => m.branchId === branchId);
export const memberByYmis = y => load().members.find(m => m.ymis === y) || null;
export const currentUser = () => (session?.userId ? userById(session.userId) : null);
export const isChief = () => session?.role === 'chief';
export const isParent = () => session?.role === 'parent';
export const isMember = () => session?.role === 'member';
export const isCoach = () => session?.role === 'coach';
export const isSuper = () => session?.role === 'super';

/** 超管係隱藏帳號：唔會喺任何名單／計數出現 */
export const visibleUsers = () => users().filter(u => !u.hidden);

/** 支部人員（團長／副團長／成員）嘅所屬支部 */
export const myBranchId = () => session?.branchId || null;
export const myBranch = () => (session?.branchId ? branchById(session.branchId) : null);
/** ★ 支部版面：各支部自家設計，之後照抄入嚟（旅側唔另設一套） */
export const branchLayout = id => (id === 'troop' ? null : (branchById(id)?.layout || null));
export const myIdentity = () => session?.identity || null;
export const myTitle = () => session?.title || null;
export const myMember = () => (session?.ymis ? memberByYmis(session.ymis) : null);
export const isBranchLeader = () => ['團長', '副團長'].includes(session?.identity || '');

/** 逐人權限微調：member.perms = { rank?, borrow?, publish?, notes? } */
export function permsOf(member) {
  const m = member || myMember();
  return (m && m.perms) || {};
}
export function effectiveRank(member) {
  const m = member || myMember();
  if (!m) return viewerRank();
  const override = Number((m.perms || {}).rank);
  return Number.isFinite(override) && override > 0 ? override : defaultRankFor(m.identity, m.title);
}

export function canSeeBranch(b) {
  if (!b) return false;
  if (!session) return false;
  if (session.role === 'chief') return true;
  if (session.role === 'super') return true;
  if (session.role === 'member') return session.branchId === b.id;          // 支部人員：只睇自己團
  if (session.role === 'parent') return load().members.some(m => (currentUser()?.children || []).includes(m.ymis) && m.branchId === b.id);
  const u = currentUser();
  if (!u) return false;
  if (u.branchAccess?.includes('*')) return true;
  return (u.branchAccess || []).includes(b.id);
}
export const myBranches = () => branches().filter(canSeeBranch);

/** 家長睇得到嘅子女（跨支部） */
export function childrenOf(u = currentUser()) {
  if (!u?.children?.length) return [];
  return u.children.map(y => {
    const m = memberByYmis(y);
    return m ? { ...m, branch: branchById(m.branchId) } : { ymis: y, name: '（未對上名冊）', branch: null, missing: true };
  });
}

/** 可見等級過濾：viewerRank（0=公眾／未登入；支部人員按身份／職稱／逐人微調） */
export function viewerRank() {
  if (!session) return 0;
  if (session.role === 'member') return effectiveRank(myMember());
  return { chief: 5, coach: 4, parent: 3, super: 5, guest: 0 }[session.role] ?? 1;
}
export function visiblePublic(items, rank = viewerRank()) {
  return (items || []).filter(it => Number(it.vis || 0) <= rank);
}

/** 通告：旅 + 你睇得到嘅支部（分享前設＝接收方有該模組） */
export function noticesForViewer() {
  const d = load();
  return d.notices.filter(n => {
    if (n.scope !== 'branch') return true;
    const b = branchById(n.ownerBranch);
    return b && canSeeBranch(b);
  });
}
export function noticeSignedCount(n) {
  const base = Number(n.signed || 0);
  return base;
}

/** 旅／支部日曆事件 */
export function calendarForViewer() {
  const d = load();
  return d.calendar.filter(e => e.cal === 'troop' || canSeeBranch({ id: e.cal }));
}

/* ---------------- 分享（★ 新方向：收件方決定出唔出） ----------------
   規矩：A 團 share 去 B 團 → B 團自己決定「要唔要佢出現」。
       未接收 = 淨係喺 B 團嘅「分享中心 · 待接收」見到；接收先會混入 B 團自己嘅清單。
       接收／退回要有該支部嘅決定權（執委或以上）；旅長可以代勞，但會記邊個落嘅決定。
   ------------------------------------------------------------ */
export const shares = () => load().shares || [];
/** 發去我支部（或全旅）嘅分享 */
export const sharesToMe = (branchId = myBranchId()) => shares().filter(s => s.to === branchId || s.to === 'all');
/** 我支部發出嘅分享 */
export const sharesFromMe = (branchId = myBranchId()) => shares().filter(s => s.from === branchId);
export const pendingShares = (branchId = myBranchId()) => sharesToMe(branchId).filter(s => s.state === 'pending');
/** 已接收（＝真係會出現喺我清單） */
export const acceptedShares = (branchId = myBranchId(), kind = null) =>
  sharesToMe(branchId).filter(s => s.state === 'accepted' && (!kind || s.kind === kind));
export const KIND_LABEL = { notice: '通告', event: '活動', item: '物資（舊）', progress: '進度／成果（舊）', album: '相簿（舊）', doc: '教材（舊）' };
export function decideShare(id, state, note = '') {
  const u = currentUser();
  return commit(d => {
    const s = (d.shares || []).find(x => x.id === id);
    if (!s) return;
    s.state = state;                       // accepted ／ declined ／ withdrawn
    s.decidedBy = u?.name || getSession()?.email || '';
    s.decidedAt = nowStr();
    if (note) s.decideNote = note;
  });
}
export function addShare({ kind, title, from, to, level = 2, note = '', ref = '' }) {
  const u = currentUser();
  const id = 'sh-' + Date.now();
  commit(d => {
    (d.shares = d.shares || []).unshift({
      id, kind, title, from, to, level, note, ref,
      state: 'pending', at: nowStr(), by: u?.name || getSession()?.email || ''
    });
  });
  return id;
}

/* ---------------- 計數（導航徽章／儀表板） ---------------- */
export function pendingList() {
  const d = load();
  return d.applications.filter(a => a.state === 'pending');
}
export function counters() {
  const d = load();
  return {
    pendingCount: pendingList().length,
    noticeDrafts: (d.notices || []).filter(n => n.status === 'draft').length,
    financeDue: (d.financeSubmits || []).filter(f => f.state === 'missing' || f.state === 'query').length,
    loanPending: (d.inventory || []).reduce((n, i) => n + (i.loans || []).filter(l => l.state === 'pending').length, 0),
    transferPending: (d.transfers || []).filter(t => t.state === 'pending').length,
    usersPending: (d.users || []).filter(u => u.status === 'pending' && !u.hidden).length,
    sharesPending: pendingShares().length,
    sharesSentPending: sharesFromMe().filter(s => s.state === 'pending').length,
    systemAlerts: (d.branches || []).filter(b => b.link.state !== 'green').length + (d.backend?.broken?.length || 0)
  };
}

/* ---------------- 審計（前端示範；真模式由 server 寫） ---------------- */
export function audit(action, target = '', detail = '', via = 'UI') {
  const u = currentUser();
  const now = new Date();
  const p = n => String(n).padStart(2, '0');
  const at = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
  return commit(d => {
    d.audit.unshift({
      id: 'au-' + Date.now(), at, actor: u?.name || session?.email || '（訪客）',
      role: session?.role || 'guest', identity: session?.identity || '', branchId: session?.branchId || '',
      action, target, via, detail
    });
  }, { markDirty: false, silent: true });
}

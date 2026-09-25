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
import { defaultRankFor, gateOfLink } from './registry.js';

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
/** ★ 支部系統登入通道（open／sig-only）—— 由旅側登記版面控制；支部系統嗰邊冇掣。
    閂咗＝支部系統唔可以自己登入（本地 403），就算已登記、睇到張 SHEET 都唔畀入；只經旅入口。
    真模式：呢一步係 sig write action `setGate`（下游寫入 ALLOW_LOCAL_LOGIN，回 confirmed）。
    fail-closed：下游未登記（紅燈）＝ 改唔到，亦唔會當成功。 */
export function setBranchGate(branchId, gate, { note = '', by = null, silent = false } = {}) {
  const u = by || currentUser();
  const at = nowStr();
  const b0 = branchById(branchId);
  /* fail-closed：未登記下游 ＝ 改唔到（唔會扮成功） */
  if (!b0) return { ok: false, msg: '搵唔到呢個支部' };
  if (!b0.link?.registeredAt || b0.link.state === 'red') {
    return { ok: false, msg: `「${b0.name}」未登記下游 SHEET —— 控制唔到該團嘅閘。請先「改登記」（URL ＋ KEY ＋ sig 用途）。` };
  }
  const res = commit(d => {
    const t = (d.branches || []).find(x => x.id === branchId);
    if (!t || !t.link) return;
    t.link.gate = gate;
    t.link.localLogin = gate === 'open';           // 舊欄位同步（向下兼容）
    t.link.state = gate === 'open' ? 'yellow' : 'green';
    t.link.gateBy = u?.name || getSession()?.email || '';
    t.link.gateAt = at;
    t.link.gateNote = '';
    t.link.note = gate === 'open' ? '支部系統自己登入得（旅入口亦入得）' : '閂咗支部系統登入：只經旅入口';
    /* 真模式：下游寫入會回 confirmed → 下游真相跟住旅側記錄走（示範：直接同步） */
    const dn = (d.downstream || {})[branchId];
    if (dn) dn.localLogin = gate === 'open';
  }, { markDirty: true, silent });
  return { ok: true, at, by: u?.name || '', result: res };
}
/** 讀閘（含舊資料推導） */
export const branchGate = branchId => {
  const b = branchById(branchId);
  return b ? gateOfLink(b.link) : 'open';
};

/* ---------------- ★ 帳號下限：每個 leaf 至少留 1 個領袖戶（BUILD §2） ----------------
   用戶 2026-09-25 澄清：「呢個係指 DELETE ACCOUNT，要保留最小 1 個」。
   即係：刪／停用帳號之前，要確保嗰個 leaf 仲有領袖戶入得返 —— 唔可以刪到冇人。
   呢條規矩同「閂咗分支系統登入之後本地戶一樣 403」冇衝突：
   一個係「有冇戶口」，一個係「本地登入通唔通」。 */
export const BRANCH_LEADER_IDENTITIES = ['團長', '副團長'];
const isBranchLeaderUser = u => u?.role === 'member' && BRANCH_LEADER_IDENTITIES.includes(u.identity);

/** 該 leaf 仲有幾多個啟用中領袖戶（唔計自己） */
export function otherLeaders(u) {
  if (!u) return [];
  if (u.role === 'chief') return load().users.filter(x => x.role === 'chief' && x.status === 'active' && x.id !== u.id);
  if (u.role === 'member') return load().users.filter(x => x.role === 'member' && x.branchId === u.branchId && x.status === 'active' && x.id !== u.id && isBranchLeaderUser(x));
  return [];
}

/** 刪／停用之前一定要過呢度 */
export function removalGuard(u) {
  if (!u) return { ok: false, msg: '搵唔到帳號' };
  if (u.role === 'super' || u.hidden) return { ok: false, msg: '平台超管（隱藏）唔可以停用／刪除 —— 佢係最後一道（第二層備援）' };
  if (u.role === 'chief') {
    if (!otherLeaders(u).length) return { ok: false, msg: '旅長係旅 SHEET 最後一個領袖戶 —— 要先開多一個旅長，先可以停用／刪除', leaf: '旅 SHEET' };
    return { ok: true, leaf: '旅 SHEET', rest: otherLeaders(u).length };
  }
  if (isBranchLeaderUser(u)) {
    const rest = otherLeaders(u);
    if (!rest.length) return { ok: false, msg: `「${branchName(u.branchId)}」得呢一個領袖戶（${u.identity}）—— 要先開多一個團長／副團長，先可以停用／刪除`, leaf: branchName(u.branchId), rest: 0 };
    return { ok: true, leaf: branchName(u.branchId), rest: rest.length };
  }
  return { ok: true, leaf: u.role === 'member' ? branchName(u.branchId) : '旅 SHEET', rest: otherLeaders(u).length };
}

/** 停用／復原（停用要過下限守衛） */
export function setUserStatus(userId, status) {
  const u = userById(userId);
  if (!u) return { ok: false, msg: '搵唔到帳號' };
  if (status !== 'active') {
    const g = removalGuard(u);
    if (!g.ok) return g;
  }
  const at = nowStr();
  commit(d => {
    const t = d.users.find(x => x.id === userId);
    if (t) { t.status = status; t.statusAt = at; t.statusBy = currentUser()?.name || ''; }
  }, { markDirty: true });
  return { ok: true, at, u };
}

/** 刪除帳號（同一個下限守衛；唔可以刪到某個 leaf 冇領袖戶） */
export function removeUserAccount(userId) {
  const u = userById(userId);
  if (!u) return { ok: false, msg: '搵唔到帳號' };
  const g = removalGuard(u);
  if (!g.ok) return g;
  const at = nowStr();
  commit(d => {
    d.users = d.users.filter(x => x.id !== userId);
    d.removedUsers = d.removedUsers || [];
    d.removedUsers.unshift({ id: u.id, name: u.name, email: u.email, role: u.role, branchId: u.branchId || '', identity: u.identity || '', at, by: currentUser()?.name || '' });
  }, { markDirty: true });
  return { ok: true, at, u, leaf: g.leaf };
}

/* ---------------- ★ 求救制（取代逃生門；用戶定案 2026-09-25） ----------------
   求救＝**請求**：送得出去、睇得到、有人跟 —— 但唔會自動開任何嘢。
   處理（開返閘／重設密碼／答覆）全部由 ADMIN 人手做，逐單留紀錄。 */
export const rescues = () => load().rescues || [];
export const rescueById = id => rescues().find(r => r.id === id) || null;
export const rescuesOf = branchId => rescues().filter(r => r.branchId === branchId);
export const openRescues = () => rescues().filter(r => r.state !== 'done');
/** 送求救（★ 免登入都用得：佢哋就係入唔到先求救） */
export function addRescue({ branchId = '', by = '', contact = '', kind = 'other', note = '', via = '求救頁' } = {}) {
  const at = nowStr();
  if (!String(by).trim()) return { ok: false, msg: '要填你係邊個（ADMIN 要搵得返你）' };
  if (!String(contact).trim()) return { ok: false, msg: '要留低點搵到你（電話或 email）' };
  const id = 'r-' + Date.now().toString(36);
  commit(d => {
    d.rescues = d.rescues || [];
    d.rescues.unshift({ id, at, branchId, by: String(by).trim(), contact: String(contact).trim(), kind, note: String(note).trim(), via, state: 'open' });
  }, { markDirty: true });
  return { ok: true, id, at };
}
/** ADMIN 處理求救：open-gate（開返支部系統登入）／reset-pw（重設密碼）／reply（答覆結案） */
export function resolveRescue(id, { action = 'reply', reply = '', account = '', by = null } = {}) {
  const u = by || currentUser();
  const at = nowStr();
  const r0 = rescueById(id);
  if (!r0) return { ok: false, msg: '搵唔到呢張求救單' };
  if (r0.state === 'done') return { ok: false, msg: '呢張求救單已經處理咗' };
  const done = { at, by: u?.name || getSession()?.email || '', action };
  if (action === 'open-gate') {
    if (!r0.branchId) return { ok: false, msg: '求救單冇指明支部 —— 開唔到閘；先問清楚係邊個團' };
    const g = setBranchGate(r0.branchId, 'open', { silent: true });
    if (!g.ok) return g;                                   // 誠實失敗：唔會當成功
    done.gate = 'open';
  }
  if (action === 'reset-pw') {
    const pw = resetPasswordFor(account, { by: u });
    if (!pw.ok) return pw;                                 // 誠實失敗：唔會當成功
    done.account = pw.account;
    done.tempPwNote = pw.note;
  }
  commit(d => {
    const r = (d.rescues || []).find(x => x.id === id);
    if (!r) return;
    r.state = 'done'; r.done = done;
    if (reply) r.reply = String(reply).trim();
  }, { markDirty: true });
  return { ok: true, at, by: done.by, action, tempPw: action === 'reset-pw' ? DEMO_TEMP_PW : '' };
}
/** ★ 重設密碼（求救處理同超管救援共用）：發臨時密碼，首登強制改 */
export function resetPasswordFor(account, { by = null } = {}) {
  const u = by || currentUser();
  const at = nowStr();
  const acc = String(account || '').trim().toLowerCase();
  if (!acc) return { ok: false, msg: '要填帳號（email 或 YMIS）' };
  const t = load().users.find(x => String(x.email || '').toLowerCase() === acc || String(x.ymis || '') === String(account).trim());
  if (!t) return { ok: false, msg: `搵唔到帳號「${account}」—— 要 email 或 YMIS（成員戶要該團團長執行）` };
  commit(d => {
    const x = d.users.find(y => y.id === t.id);
    x.mustChangePw = true; x.pwResetAt = at; x.pwResetBy = u?.name || '';
  }, { markDirty: true });
  return {
    ok: true, at, account: t.email || t.ymis, userId: t.id,
    note: t.role === 'member' ? '臨時密碼已發（首登強制改）；成員戶真模式要該團團長執行' : '臨時密碼已發（首登強制改）'
  };
}

/** 示範用臨時密碼（真模式：隨機產生 ＋ 一次性連結，唔會顯示喺畫面） */
export const DEMO_TEMP_PW = 'demo1234';
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
/** ★ 求救單計入待辦（ADMIN 一打開就見到） */
export const rescuesPending = () => (load().rescues || []).filter(r => r.state !== 'done').length;
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
    rescuesPending: rescuesPending(),
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

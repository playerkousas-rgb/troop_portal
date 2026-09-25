/* ============================================================
   auth.js — 登入（旅＝所有人嘅登入窗口）
   ------------------------------------------------------------
   示範模式：示範帳號 + 密碼 `demo1234`。
   真模式：密碼由旅 GAS `authLogin` server-side 核對（PBKDF2 + 鎖定），
          前端只保存 session；`mustChangePw` 期間只放行改密碼。

   ★ 角色（見 registry.js）：
       chief 旅長 ／ coach 教練員 ／ parent 家長   → 帳號住旅 SHEET
       member 支部人員（團長、副團長、成員）        → 帳號住該團支部 SHEET
       super 平台超管（隱藏）
   ★ 支部人員一定要「先揀團」：
       旅要對得上該團（下游 SHEET）先入得到；未登記下游＝紅字講明，唔會靜靜地失敗。
   ============================================================ */

import { commit, currentUser, load, setSession, clearSession, getSession, userById } from './store.js';
import { toast, normId } from './util.js';
import { ROLE_LABEL, identityMeta, titleMeta, ageFromDob, ageGroupOf } from './registry.js';

export const DEMO_PASSWORD = 'demo1234';

/** 旅層帳號（住旅 SHEET）：旅長、教練員、家長 */
export const DEMO_LOGINS = [
  { userId: 'u-chief', email: 'chief@demo.troop', role: 'chief', label: '旅長', desc: '陳大文 · 全旅最高權限' },
  { userId: 'u-lee', email: 'coach@demo.troop', role: 'coach', label: '教練員', desc: '李美儀 · 跨團教練（童軍＋幼童軍）' },
  { userId: 'u-parent', email: 'parent@demo.troop', role: 'parent', label: '家長', desc: '陳小萍 · 子女跨兩個支部' }
];

/** 支部人員帳號（住該團支部 SHEET）：全部要經「先揀團」入 */
export const DEMO_BRANCH_LOGINS = [
  { userId: 'u-b-leader', email: 'cs-leader@demo.troop', role: 'member', branchId: 'cs0082', identity: '團長', label: '團長', desc: '鄭美玲 · 幼童軍團' },
  { userId: 'u-b-leader2', email: 'cs-deputy@demo.troop', role: 'member', branchId: 'cs0082', identity: '副團長', label: '副團長', desc: '黃志強 · 幼童軍團' },
  { userId: 'u-m-exec', email: 'vs-exec@demo.troop', role: 'member', branchId: 'vs0082', identity: '執委', title: '主席', label: '執委（主席）', desc: '郭嘉敏 · 深資童軍團 · 18+' },
  { userId: 'u-m-adult', email: 'vs-team@demo.troop', role: 'member', branchId: 'vs0082', identity: '團隊長', label: '團隊長（18+）', desc: '陳家豪 · 深資童軍團' },
  { userId: 'u-m-minor', email: 'sc-cpl@demo.troop', role: 'member', branchId: 'sc0082', identity: '副隊長', label: '副隊長（未夠 18）', desc: '陳家欣 · 童軍團 · 監護人：陳小萍' },
  { userId: 'u-m-scout', email: 'sc-scout@demo.troop', role: 'member', branchId: 'sc0082', identity: '團員', label: '團員（18+）', desc: '林浩然 · 童軍團 · 普通成員（睇得到但唔夠權決定分享）' }
];

/** 超管：隱藏帳號 —— 唔喺名單、唔喺登入頁 chips，要 ?step=super 或撳 ⚜ 五下 */
export const SUPER_ID = 'u-super';
export const SUPER_EMAIL = 'super@platform.local';

/* ---------------- 登入 ---------------- */
export function login(email, password) {
  const mail = String(email || '').trim().toLowerCase();
  const pw = String(password || '');
  if (!mail || !pw) return { ok: false, msg: '請輸入帳號同密碼' };
  const u = load().users.find(x => String(x.email || '').toLowerCase() === mail);
  if (!u) return { ok: false, msg: '帳號或密碼不正確' };   // 同一句，防帳號枚舉
  if (u.status === 'disabled') return { ok: false, msg: '此帳號已停用，請聯絡旅長' };
  if (pw !== DEMO_PASSWORD) return { ok: false, msg: '帳號或密碼不正確' };

  /* 支部人員：旅要先對得上該團（下游登記狀態）先入得到 */
  if (u.role === 'member') {
    const st = branchEntryStatus(u.branchId);
    if (!st.ok) return { ok: false, msg: st.msg };
  }

  const member = u.ymis ? load().members.find(m => m.ymis === u.ymis) : null;
  setSession({
    userId: u.id, email: u.email, role: u.role, name: u.name,
    branchId: u.branchId || '', ymis: u.ymis || '',
    identity: u.identity || (member ? member.identity : '') || '',
    title: u.memberTitle || (member ? member.title : '') || '',
    ageGroup: u.ageGroup || ageGroupOf(member?.dob),
    mustChangePw: !!u.mustChangePw, at: Date.now(), via: 'local',
    /* ★ 旅入口＝支部入口：支部人員一登入就已經「企喺自己支部」 */
    landedIn: u.role === 'member' ? (u.branchId || '') : ''
  });
  commit(d => {
    const t = d.users.find(x => x.id === u.id);
    if (t) t.lastLogin = new Date().toISOString().slice(0, 16).replace('T', ' ');
  }, { markDirty: false, silent: true });
  return { ok: true, role: u.role, mustChangePw: !!u.mustChangePw, branchId: u.branchId || '' };
}

/** 示範：一鍵代入（唔想打密碼時用） */
export function loginAs(userId) {
  const u = userById(userId);
  if (!u) return { ok: false, msg: '冇呢個示範帳號' };
  return login(u.email, DEMO_PASSWORD);
}

export function logout() { clearSession(); }

export function changePassword(oldPw, newPw) {
  const s = getSession();
  if (!s) return { ok: false, msg: '未登入' };
  if (String(oldPw || '') !== DEMO_PASSWORD) return { ok: false, msg: '舊密碼不正確' };
  if (String(newPw || '').length < 8) return { ok: false, msg: '新密碼至少 8 位' };
  commit(d => { const u = d.users.find(x => x.id === s.userId); if (u) u.mustChangePw = false; }, { markDirty: true });
  setSession({ ...s, mustChangePw: false });
  return { ok: true };
}

/* ---------------- 支部入口（旅只做導流） ---------------- */
/** 該團可唔可以「入得到」：要登記咗下游（有 URL ＋ KEY ＋ 測試過）先讀到支部資料 */
export function branchEntryStatus(branchId) {
  const b = load().branches.find(x => x.id === branchId);
  if (!b) return { ok: false, state: 'red', msg: '搵唔到呢個團' };
  const st = b.link?.state || 'red';
  if (st === 'red') {
    return {
      ok: false, state: 'red',
      msg: `「${b.name}」未登記下游 SHEET —— 旅讀唔到該團資料，所以由旅窗口入唔到。請旅長先去「支部 → 接駁與登記」登記（URL ＋ KEY ＋ sig 用途）再試。`
    };
  }
  if (st === 'yellow') {
    return {
      ok: true, state: 'yellow', branch: b,
      note: `「${b.name}」已登記但未閂本地登入（黃燈）：可以入，但兩邊都仲可以自己登入 —— 搬完數記得閂口。`
    };
  }
  return { ok: true, state: 'green', branch: b, note: `「${b.name}」已接駁（綠燈）` };
}

/** 該團嘅入口 URL（真模式：轉去該團系統；旅唔會、亦唔可以代驗支部密碼） */
export function branchEntryUrl(branchId, ymis = '') {
  const b = load().branches.find(x => x.id === branchId);
  if (!b) return '';
  return b.hasPortal
    ? `portal.html?from=troop&u=${encodeURIComponent(b.id)}${ymis ? '&ymis=' + encodeURIComponent(ymis) : ''}`
    : `${b.id}/members.html?u=${encodeURIComponent(b.code || b.id)}${ymis ? '&ymis=' + encodeURIComponent(ymis) : ''}`;
}

/** 成員入口導流（M3 路線）：旅唔驗成員密碼，只帶你去自己屬團嘅入口 */
export function memberEntryHint(branchId, ymis) {
  const st = branchEntryStatus(branchId);
  if (!st.ok) return { ok: false, msg: st.msg };
  const b = st.branch;
  const y = normId(ymis || '');
  return {
    ok: true,
    branch: b,
    url: branchEntryUrl(branchId, y),
    note: '密碼由你自己屬團嘅後端核對（旅系統唔會、亦唔可以代驗成員密碼）',
    state: st.state
  };
}

/* ---------------- 邀請 ---------------- */
export function makeInvite({ kind = 'coach', role = '教練員', email = '', branchAccess = [], branchId = '', identity = '', createdBy = '' }) {
  const token = 'TROOP-' + kind.slice(0, 3).toUpperCase() + '-' + Math.random().toString(36).slice(2, 10).toUpperCase();
  const at = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  commit(d => {
    d.invites.unshift({ id: 'iv-' + Date.now(), kind, role, email, token, branchAccess, branchId, identity, expires, used: false, createdBy, at });
  });
  return token;
}
export function inviteUrl(token) {
  const base = location.origin + location.pathname.replace(/[^/]*$/, '');
  return `${base}join.html?t=${encodeURIComponent(token)}`;
}
export function redeemInvite(token, { name, email, password }) {
  const d = load();
  const inv = d.invites.find(i => i.token === token);
  if (!inv) return { ok: false, msg: '連結無效' };
  if (inv.used) return { ok: false, msg: '連結已用過（一次性）' };
  if (inv.expires < new Date().toISOString().slice(0, 10)) return { ok: false, msg: '連結已過期（24 小時）' };
  if (String(password || '').length < 8) return { ok: false, msg: '密碼至少 8 位' };
  const role = inv.kind === 'parent' ? 'parent' : inv.kind === 'member' ? 'member' : 'coach';
  const identity = inv.identity || (inv.kind === 'member' ? '團員' : '');
  commit(dd => {
    const found = dd.invites.find(i => i.token === token);
    if (found) { found.used = true; found.usedAt = new Date().toISOString().slice(0, 16).replace('T', ' '); }
    dd.users.push({
      id: 'u-' + Date.now(), role, name: name || '（新用戶）', email: email || inv.email || '',
      title: inv.role, branchAccess: inv.branchAccess || [], children: [],
      branchId: role === 'member' ? (inv.branchId || '') : '',
      identity: role === 'member' ? identity : '',
      anchor: role === 'member' ? `該團支部 SHEET（${inv.branchId || '—'}）` : '旅 SHEET',
      ageGroup: 'minor', status: 'active', mustChangePw: false,
      at: new Date().toISOString().slice(0, 16).replace('T', ' ')
    });
  });
  return { ok: true, role };
}

/* ---------------- 身份／年齡小工具（UI 用） ---------------- */
export function describeIdentity(identity, memberTitle) {
  const i = identityMeta(identity);
  const t = titleMeta(memberTitle);
  const parts = [];
  if (identity) parts.push(`身份：${identity}（可見等級上限 ${i.rank}）`);
  if (memberTitle) parts.push(`職稱：${memberTitle}（默認跟「${t.follows}」）`);
  return parts.join(' · ');
}
export function ageLine(dob) {
  const a = ageFromDob(dob);
  const g = ageGroupOf(dob);
  return a === null ? '生日未填（當未成年處理）' : `${a} 歲 · ${g === 'adult' ? '18+' : '未夠 18'}`;
}

export const roleLabel = r => ROLE_LABEL[r] || r;
export const session = () => getSession();
export const me = () => currentUser();
export function requireLogin() {
  if (!getSession()) { location.hash = '#/'; return false; }
  return true;
}
export function toastLogin(u) { toast(`已登入：${ROLE_LABEL[u.role]} ${u.name}`, 'ok'); }

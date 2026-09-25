/* ============================================================
   auth.js — 登入（旅＝所有人嘅登入窗口）
   ------------------------------------------------------------
   示範模式：任何一個示範帳號 ＋ 密碼 `demo1234` 就入得。
   真模式：密碼由旅 GAS `authLogin` server-side 核對（PBKDF2 + 鎖定），
          前端只保存 session；`mustChangePw` 期間只放行改密碼。
   ★ 角色同權限：
       旅長 chief ＞ 旅層領袖 leader ＞ 家長 parent ＞ 成員 member
       · 成員帳號住該團支部（旅只做導流：揀支部 → 轉去該團成員入口）
       · 家長帳號住旅（子女跨支部由旅 server-side 併埋）
   ============================================================ */

import { commit, currentUser, load, setSession, clearSession, getSession, userById } from './store.js';
import { toast, normId } from './util.js';
import { ROLE_LABEL } from './registry.js';

export const DEMO_PASSWORD = 'demo1234';

export const DEMO_LOGINS = [
  { userId: 'u-chief', email: 'chief@demo.troop', role: 'chief', label: '旅長', desc: '陳大文 · 全旅最高權限' },
  { userId: 'u-lee', email: 'leader@demo.troop', role: 'leader', label: '旅層領袖', desc: '李美儀 · 跨團教練（童軍＋幼童軍）' },
  { userId: 'u-wong', email: 'wong@demo.troop', role: 'leader', label: '旅層領袖（秘書）', desc: '黃志強 · 只帶幼童軍團' },
  { userId: 'u-parent', email: 'parent@demo.troop', role: 'parent', label: '家長', desc: '陳小萍 · 子女跨兩個支部' }
];

export function login(email, password) {
  const mail = String(email || '').trim().toLowerCase();
  const pw = String(password || '');
  if (!mail || !pw) return { ok: false, msg: '請輸入帳號同密碼' };
  const u = load().users.find(x => String(x.email || '').toLowerCase() === mail);
  if (!u) return { ok: false, msg: '帳號或密碼不正確' };   // 同一句，防帳號枚舉
  if (u.status === 'disabled') return { ok: false, msg: '此帳號已停用，請聯絡旅長' };
  if (pw !== DEMO_PASSWORD) return { ok: false, msg: '帳號或密碼不正確' };
  setSession({
    userId: u.id, email: u.email, role: u.role, name: u.name,
    at: Date.now(), via: 'local', mustChangePw: !!u.mustChangePw
  });
  commit(d => { const t = d.users.find(x => x.id === u.id); if (t) t.lastLogin = new Date().toISOString().slice(0, 16).replace('T', ' '); }, { markDirty: false, silent: true });
  return { ok: true, role: u.role, mustChangePw: !!u.mustChangePw };
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
  if (String(newPw || '').length < 4) return { ok: false, msg: '新密碼至少 4 位' };
  commit(d => { const u = d.users.find(x => x.id === s.userId); if (u) u.mustChangePw = false; }, { markDirty: true });
  setSession({ ...s, mustChangePw: false });
  return { ok: true };
}

/** 一次性邀請連結（領袖／家長）：隨機 12 字、24 小時、用一次即廢 */
export function makeInvite({ kind = 'leader', role = '旅層領袖', email = '', branchAccess = [], createdBy = '' }) {
  const token = 'TROOP-' + kind.slice(0, 3).toUpperCase() + '-' + Math.random().toString(36).slice(2, 10).toUpperCase();
  const at = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  commit(d => {
    d.invites.unshift({ id: 'iv-' + Date.now(), kind, role, email, token, branchAccess, expires, used: false, createdBy, at });
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
  const role = inv.kind === 'parent' ? 'parent' : 'leader';
  commit(dd => {
    const found = dd.invites.find(i => i.token === token);
    if (found) { found.used = true; found.usedAt = new Date().toISOString().slice(0, 16).replace('T', ' '); }
    dd.users.push({
      id: 'u-' + Date.now(), role, name: name || '（新用戶）', email: email || inv.email || '',
      title: inv.role, branchAccess: inv.branchAccess || [], children: [], status: 'active',
      mustChangePw: false, at: new Date().toISOString().slice(0, 16).replace('T', ' '), lastLogin: '—'
    });
  });
  return { ok: true };
}

/** 成員入口導流（M3 路線）：旅唔驗成員密碼，只帶你去自己屬團嘅入口 */
export function memberEntryHint(branchId, ymis) {
  const b = load().branches.find(x => x.id === branchId);
  if (!b) return { ok: false, msg: '搵唔到呢個支部' };
  const y = normId(ymis || '');
  return {
    ok: true,
    url: `${b.id}/members.html?u=${encodeURIComponent(b.code)}&ymis=${encodeURIComponent(y)}`,
    note: '密碼由你自己屬團嘅後端核對（旅系統唔會、亦唔可以代驗成員密碼）'
  };
}

export const roleLabel = r => ROLE_LABEL[r] || r;
export const session = () => getSession();
export const me = () => currentUser();
export function requireLogin() {
  if (!getSession()) { location.hash = '#/'; return false; }
  return true;
}
export function toastLogin(u) { toast(`已登入：${ROLE_LABEL[u.role]} ${u.name}`, 'ok'); }

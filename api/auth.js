/* ============================================================
   /api/auth — 旅系統登入／改密碼／邀請（Vercel Function · 零依賴 · node:crypto）
   ------------------------------------------------------------
   規矩（建構計劃 §3.3／§6.3、用戶 2026-09-26 Q1 定案：混合制）：
     · 密碼**只喺呢度**驗（PBKDF2-SHA256 ≥100,000 次＋per-user salt＋timing-safe）
     · hash 存喺旅 SHEET（由 `Code.gs` 保管），GAS **永遠唔驗密碼**
     · session：HS256 JWT，HttpOnly ＋ Secure ＋ SameSite=Lax，30 分鐘
     · 5 次錯 → 鎖 15 分鐘（同一 IP；連 ACCESS_LOG 一齊記）
     · 一次登入之後：接駁好嘅團可以用 M1（旅側代交 sig）／未接駁嘅團行 M3
   ============================================================ */
import crypto from 'node:crypto';

export const config = { runtime: 'nodejs' };

const PBKDF2 = { algo: 'pbkdf2-sha256', iter: 100000, keylen: 32, digest: 'sha256' };
const SESSION_TTL_MS = 30 * 60 * 1000;
const FAIL = { max: 5, windowMs: 15 * 60 * 1000 };

/* ------------------------- 密碼（公開測試用） ------------------------- */
export function hashPassword(password, salt, iter = PBKDF2.iter) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password), s, iter, PBKDF2.keylen, PBKDF2.digest).toString('hex');
  return { algo: PBKDF2.algo, iter, salt: s, hash };
}
export function verifyPassword(password, rec) {
  if (!rec || !rec.hash || !rec.salt) return false;
  const iter = Number(rec.iter || PBKDF2.iter);
  const got = crypto.pbkdf2Sync(String(password), String(rec.salt), iter, PBKDF2.keylen, PBKDF2.digest);
  const want = Buffer.from(String(rec.hash), 'hex');
  if (want.length !== got.length) return false;
  return crypto.timingSafeEqual(got, want);
}

/* ------------------------- session（HS256 JWT） ------------------------- */
const b64u = buf => Buffer.from(buf).toString('base64url');
export function signSession(payload, secret, ttlMs = SESSION_TTL_MS) {
  if (!secret) throw new Error('冇 SESSION_SECRET');
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + ttlMs }));
  const sig = crypto.createHmac('sha256', secret).update(head + '.' + body).digest('base64url');
  return head + '.' + body + '.' + sig;
}
export function verifySession(token, secret) {
  if (!token || !secret) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const want = crypto.createHmac('sha256', secret).update(parts[0] + '.' + parts[1]).digest('base64url');
  const a = Buffer.from(parts[2]); const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p = null; try { p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
  if (!p.exp || p.exp < Date.now()) return null;
  return p;
}

/* ------------------------- GAS 通道（server 側 inject apikey） ------------------------- */
export function unitEnv(unit) {
  const id = String(unit || '').trim().toUpperCase().replace(/^0+(?=\d)/, '');
  const pick = (...names) => names.map(n => process.env[n]).find(v => v && v.trim()) || '';
  return {
    unit: id,
    backend: pick(`TROOP_${id}_BACKEND`, `TROOP_${String(id).padStart(4, '0')}_BACKEND`),
    apikey: pick(`TROOP_${id}_APIKEY`, `TROOP_${String(id).padStart(4, '0')}_APIKEY`)
  };
}
export async function gas(unit, body) {
  const { backend, apikey } = unitEnv(unit);
  if (!backend || !apikey) return { ok: false, code: 'not_configured', msg: `未設定 TROOP_${unit}_BACKEND／_APIKEY（ADMIN 放 Vercel env）` };
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(backend)) return { ok: false, code: 'bad_backend', msg: 'BACKEND 格式唔啱（要 /exec）' };
  try {
    const r = await fetch(backend, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, apikey }), redirect: 'follow' });
    const j = await r.json().catch(() => null);
    if (!j) return { ok: false, code: 'bad_response', msg: `旅 SHEET 回應唔係 JSON（HTTP ${r.status}）` };
    return j.success === true ? { ok: true, data: j.data, note: j.note } : { ok: false, code: j.code || 'gas_fail', msg: j.error || '旅 SHEET 失敗' };
  } catch (e) {
    return { ok: false, code: 'network', msg: `連唔到旅 SHEET：${String(e?.message || e)}` };
  }
}

/* ------------------------- 限流（best-effort；逐個 warm instance） ------------------------- */
const HITS = new Map();
const nowMs = () => Date.now();
function fails(ip) { return (HITS.get(ip) || []).filter(t => nowMs() - t < FAIL.windowMs); }
function bump(ip) { const a = fails(ip); a.push(nowMs()); HITS.set(ip, a); if (HITS.size > 5000) HITS.clear(); return a.length; }
function clear(ip) { HITS.delete(ip); }
export const _locked = ip => fails(ip).length >= FAIL.max;

/* ------------------------- HTTP 小工具 ------------------------- */
const send = (res, code, body, headers = {}) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(body));
};
const readBody = async req => {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return null; } }
  const raw = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
  try { return JSON.parse(raw || '{}'); } catch { return null; }
};
const cookieOf = (req, name) => (String(req.headers?.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '=')) || '').slice(name.length + 1);
const sessionCookie = token => `troop_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`;

/* ------------------------- handler ------------------------- */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const secret = process.env.SESSION_SECRET || '';
  const body = await readBody(req);
  if (!body || typeof body !== 'object') return send(res, 400, { success: false, error: '要 JSON body' });

  const action = String(body.action || '');
  const unit = body.unit || '';

  /* ---- 現有 session ---- */
  if (action === 'session') {
    const s = verifySession(cookieOf(req, 'troop_session'), secret);
    return s ? send(res, 200, { success: true, data: { email: s.email, role: s.role, unit: s.unit, exp: s.exp } }) : send(res, 401, { success: false, error: '冇 session／已過期' });
  }
  if (action === 'logout') {
    return send(res, 200, { success: true, data: { loggedOut: true } }, { 'Set-Cookie': 'troop_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0' });
  }

  /* ---- 登入 ---- */
  if (action === 'login') {
    if (!unit) return send(res, 400, { success: false, error: '要旅 ID' });
    if (!body.email || !body.password) return send(res, 400, { success: false, error: '要帳號同密碼' });
    if (_locked(ip)) return send(res, 429, { success: false, error: '試得太多（15 分鐘）—— 請等一等' });
    const r = await gas(unit, { action: 'authUser', email: body.email });
    if (!r.ok) { bump(ip); await gas(unit, { action: 'saveAudit', actionName: 'LOGIN_FAIL', target: String(body.email).slice(0, 60), detail: r.code || 'gas', via: 'api' }); return send(res, 401, { success: false, error: r.msg, code: r.code }); }
    const u = r.data;
    if (u.status === 'pending_hash') return send(res, 403, { success: false, error: '帳號未設定密碼（請用邀請連結／setup token 設定）', code: 'pending_hash' });
    if (u.status !== 'active') { bump(ip); return send(res, 403, { success: false, error: '帳號停用咗', code: 'disabled' }); }
    if (!verifyPassword(body.password, u)) {
      const n = bump(ip);
      await gas(unit, { action: 'saveAudit', actionName: 'LOGIN_FAIL', target: u.email || String(body.email).slice(0, 60), detail: `第 ${n} 次（PBKDF2 ${u.iter || PBKDF2.iter}）`, via: 'api' });
      return send(res, 401, { success: false, error: `帳號或密碼唔啱${n >= 3 ? `（仲有 ${Math.max(0, FAIL.max - n)} 次就鎖 15 分鐘）` : ''}` });
    }
    clear(ip);
    const token = signSession({ email: u.email, role: u.role, unit: unitEnv(unit).unit, branchId: u.branchId || '', identity: u.identity || '' }, secret);
    await gas(unit, { action: 'saveAudit', actionName: 'LOGIN_OK', target: u.email, detail: `pv=${u.pv || 1}｜mustChangePw=${!!u.mustChangePw}`, via: 'api' });
    return send(res, 200, {
      success: true,
      data: { email: u.email, role: u.role, name: u.name, branchId: u.branchId || '', identity: u.identity || '', mustChangePw: !!u.mustChangePw, pv: u.pv || 1 }
    }, { 'Set-Cookie': sessionCookie(token + '') });
  }

  /* ---- 改密碼（舊密碼正確，或者已有 session） ---- */
  if (action === 'changePassword') {
    if (!unit || !body.email || !body.newPassword) return send(res, 400, { success: false, error: '要 unit／email／newPassword' });
    if (String(body.newPassword).length < 8) return send(res, 400, { success: false, error: '新密碼最少 8 字' });
    const s = verifySession(cookieOf(req, 'troop_session'), secret);
    const samePerson = s && String(s.email).toLowerCase() === String(body.email).toLowerCase();
    if (!samePerson) {
      if (!body.oldPassword) return send(res, 401, { success: false, error: '要舊密碼（或者先登入）' });
      const r0 = await gas(unit, { action: 'authUser', email: body.email });
      if (!r0.ok) return send(res, 401, { success: false, error: r0.msg });
      if (!verifyPassword(body.oldPassword, r0.data)) return send(res, 401, { success: false, error: '舊密碼唔啱' });
    }
    const h = hashPassword(body.newPassword);
    const r = await gas(unit, { action: 'changePassword', email: body.email, password_hash: h.hash, password_salt: h.salt, iter: h.iter });
    if (!r.ok) return send(res, 502, { success: false, error: r.msg, code: r.code });
    return send(res, 200, { success: true, data: { changed: true, pv: r.data?.pv, iter: h.iter } }, { 'Set-Cookie': 'troop_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0' });
  }

  /* ---- 邀請開戶 ---- */
  if (action === 'redeemInvite') {
    if (!unit || !body.token || !body.password) return send(res, 400, { success: false, error: '要 unit／token／password' });
    if (String(body.password).length < 8) return send(res, 400, { success: false, error: '密碼最少 8 字' });
    const h = hashPassword(body.password);
    const r = await gas(unit, { action: 'redeemInvite', token: body.token, email: body.email || '', name: body.name || '', password_hash: h.hash, password_salt: h.salt });
    if (!r.ok) return send(res, 400, { success: false, error: r.msg, code: r.code });
    return send(res, 200, { success: true, data: { email: (r.data && r.data.user && r.data.user.email) || body.email || '' } });
  }

  /* ---- 第一個旅長：用一次性 setup token 設密碼 ---- */
  if (action === 'setupFirstChief') {
    if (!unit || !body.token || !body.password) return send(res, 400, { success: false, error: '要 unit／token／password' });
    if (String(body.password).length < 8) return send(res, 400, { success: false, error: '密碼最少 8 字' });
    const h = hashPassword(body.password);
    const r = await gas(unit, { action: 'setupWithToken', token: body.token, email: body.email || '', password_hash: h.hash, password_salt: h.salt });
    if (!r.ok) return send(res, 400, { success: false, error: r.msg, code: r.code });
    return send(res, 200, { success: true, data: { email: (r.data && r.data.email) || body.email || '', ready: true } });
  }

  return send(res, 501, { success: false, error: `action='${action}' 未實作`, allowed: ['login', 'logout', 'session', 'changePassword', 'redeemInvite', 'setupFirstChief'] });
}

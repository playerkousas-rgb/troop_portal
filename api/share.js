/* ============================================================
   /api/share — 公開分享連結產生器（stateless、無密鑰落庫）
   ------------------------------------------------------------
   用喺：通告／活動想俾**唔係系統用戶**睇（家長、外間）——分享一條有簽名嘅連結，
   過期自動失效；唔使開戶、唔使登入、唔使將任何嘢放入資料庫。
   格式：`?s=<base64url payload>.<base64url HMAC>`，payload＝{v,kind,unit,id,to?,exp}
   種類白名單（同 §5 用戶定案一致）：`notice`（通告）＋ `calendar`（活動）。
   驗簽：HMAC-SHA256(SHARE_SECRET ∥ SESSION_SECRET, payload)；過期／亂簽＝拒。
   ============================================================ */
export const config = { runtime: 'nodejs' };
import crypto from 'node:crypto';

/** 允許分享嘅種類（Sprint 4 用戶定案：只有通告＋行事曆） */
export const KINDS = ['notice', 'calendar'];
export const MAX_TTL_MS = 90 * 24 * 3600 * 1000;      // 最長 90 日

const b64u = buf => Buffer.from(buf).toString('base64url');
const secretOf = (env = process.env) => env.SHARE_SECRET || env.SESSION_SECRET || '';

export function signShare(payload, secret) {
  if (!secret) return { ok: false, error: '未設定 SHARE_SECRET／SESSION_SECRET' };
  if (!KINDS.includes(String(payload.kind))) return { ok: false, error: `種類只可以係 ${KINDS.join('／')}` };
  if (!payload.id) return { ok: false, error: '要 id（通告／活動編號）' };
  const body = {
    v: 1,
    kind: String(payload.kind),
    unit: String(payload.unit || '').toUpperCase().replace(/^0+(?=\d)/, ''),
    id: String(payload.id).slice(0, 64),
    to: payload.to ? String(payload.to).slice(0, 60) : '',
    exp: Number(payload.exp) || (Date.now() + 30 * 24 * 3600 * 1000)
  };
  if (body.exp - Date.now() > MAX_TTL_MS) body.exp = Date.now() + MAX_TTL_MS;
  const p = b64u(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(p).digest('base64url');
  return { ok: true, token: `${p}.${sig}`, payload: body };
}

export function verifyShare(token, secret, { now = Date.now() } = {}) {
  if (!secret) return { ok: false, error: '伺服器未設定分享密鑰' };
  const [p, sig] = String(token || '').split('.');
  if (!p || !sig) return { ok: false, error: '連結格式唔啱' };
  const want = crypto.createHmac('sha256', secret).update(p).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: '連結簽名唔啱（可能被改過）' };
  let body = null; try { body = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); } catch { return { ok: false, error: '連結內容唔啱' }; }
  if (!body.exp || body.exp < now) return { ok: false, error: '連結已過期' };
  if (!KINDS.includes(body.kind)) return { ok: false, error: '呢種連結唔開放' };
  return { ok: true, payload: body };
}

/** 分享連結指向邊個公開頁（旅側自己嘅免登入頁） */
export function pageFor(kind, payload) {
  if (kind === 'notice') return `/notice.html?n=${encodeURIComponent(payload.id)}&s=${encodeURIComponent(payload.token || '')}`;
  return `/public.html?tab=calendar&e=${encodeURIComponent(payload.id)}`;
}

const send = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, 'http://x');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(req.body); } catch { body = null; } }
  const action = String((body && body.action) || url.searchParams.get('action') || 'create');
  const secret = secretOf();
  if (!secret) return send(res, 501, { success: false, error: '未設定 SHARE_SECRET（ADMIN 放 Vercel env）', code: 'not_configured' });

  if (action === 'verify') {
    const token = (body && body.token) || url.searchParams.get('token') || '';
    const r = verifyShare(token, secret);
    return r.ok ? send(res, 200, { success: true, data: r.payload }) : send(res, 401, { success: false, error: r.error });
  }
  if (action !== 'create') return send(res, 501, { success: false, error: `action='${action}' 未實作`, allowed: ['create', 'verify'] });

  const r = signShare({ kind: (body && body.kind), unit: (body && body.unit), id: (body && body.id), to: body && body.to, exp: body && body.exp }, secret);
  if (!r.ok) return send(res, 400, { success: false, error: r.error });
  r.payload.token = r.token;
  return send(res, 200, { success: true, data: { token: r.token, url: pageFor(r.payload.kind, r.payload), payload: r.payload } });
}

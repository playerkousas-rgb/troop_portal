/* ============================================================
   /api/super — 中央登入票據驗證端點（`SUPER_VERIFY_URL` 指呢度）
   ------------------------------------------------------------
   合約（BUILD §1／建構計劃 §4.6 ①）：
     · 下游 GAS 收到 `login` 帶 `super_ticket` → 回打呢個固定端點
     · 票據 60 秒、AES-256-GCM、**綁定旅**、**一次性防重放**
     · `SUPER_KEY` 只喺 Vercel env；Sheet 永遠收唔到密碼或 hash
   票據格式（緊湊、冇 JSON 就走得）：
     `v1.<iv_b64url>.<ct_b64url>.<tag_b64url>`
     明文 = {"unit":"82","email":"...","role":"chief","exp":<ms 或秒>,"nonce":"..."}
   金鑰 = HKDF-SHA256(SUPER_KEY, salt='troop-super-ticket', info='v1')
   ============================================================ */
import crypto from 'node:crypto';

export const config = { runtime: 'nodejs' };

const TICKET_TTL_MS = 60 * 1000;

export function ticketKey(superKey, info = 'v1') {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(superKey), 'utf8'), Buffer.from('troop-super-ticket'), Buffer.from(info), 32));
}
/** 產生票據（平台側；放喺呢度係為咗有單一實現同測試） */
export function makeTicket(payload, superKey) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', ticketKey(superKey), iv);
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(payload), 'utf8')), c.final()]);
  return ['v1', iv.toString('base64url'), ct.toString('base64url'), c.getAuthTag().toString('base64url')].join('.');
}
/** 驗票據：格式／簽章／TTL／綁旅／一次性 */
export function openTicket(ticket, superKey, { unit, seen = new Map(), ttlMs = TICKET_TTL_MS, now = Date.now() } = {}) {
  const parts = String(ticket || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return { ok: false, error: '票據格式唔啱' };
  let pt = '';
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', ticketKey(superKey), Buffer.from(parts[1], 'base64url'));
    d.setAuthTag(Buffer.from(parts[3], 'base64url'));
    pt = Buffer.concat([d.update(Buffer.from(parts[2], 'base64url')), d.final()]).toString('utf8');
  } catch { return { ok: false, error: '票據驗唔過（簽章唔啱）' }; }
  let p = null; try { p = JSON.parse(pt); } catch { return { ok: false, error: '票據內容唔啱' }; }
  const expMs = p.exp > 1e12 ? p.exp : Number(p.exp) * 1000;
  if (!expMs || expMs < now) return { ok: false, error: '票據過期（60 秒）' };
  if (p.unit && unit && normUnit(p.unit) !== normUnit(unit)) return { ok: false, error: '票據唔係呢個旅（綁定旅）' };
  const key = p.nonce || parts[3];
  if (seen.has(key)) return { ok: false, error: '票據已用過（一次性）' };
  seen.set(key, now);
  for (const [k, t] of seen) if (now - t > ttlMs * 10) seen.delete(k);
  return { ok: true, data: { email: p.email || '', role: p.role || '', unit: normUnit(p.unit || unit || ''), branchId: p.branchId || '' } };
}
const normUnit = v => String(v || '').trim().toUpperCase().replace(/^0+(?=\d)/, '');

const send = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};
const SEEN = new Map();                        // 一次性防重放（warm instance；正式要落 KV／Cache）

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST') return send(res, 405, { success: false, error: '只收 POST' });
  const superKey = process.env.SUPER_KEY || '';
  if (!superKey) return send(res, 501, { success: false, error: '未設定 SUPER_KEY（Vercel env）' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== 'object') return send(res, 400, { success: false, error: '要 JSON body' });

  const ticket = body.ticket || body.super_ticket || '';
  if (!ticket) return send(res, 400, { success: false, error: '要 ticket' });
  const r = openTicket(ticket, superKey, { unit: body.unit, seen: SEEN });
  if (!r.ok) {
    console.log(`[super] 驗票失敗 ip=${String(req.headers['x-forwarded-for'] || '').split(',')[0]}：${r.error}`);   // 只記 metadata
    return send(res, 401, { success: false, error: r.error });
  }
  console.log(`[super] 驗票成功 unit=${r.data.unit} role=${r.data.role}`);                                        // 唔記密碼／hash
  return send(res, 200, { success: true, data: r.data });
}

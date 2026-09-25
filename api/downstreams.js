/* ============================================================
   /api/downstreams — 旅之下嘅支部清單（**只回公開部分**）
   ------------------------------------------------------------
   來源：旅 GAS `getDownstreams`（ScriptProperties 嘅 registry），
        經 server 側 inject apikey 讀；**永不回 URL／KEY／purpose／/exec**。
   Cache：5 分鐘（用戶 2026-09-26 Q4 定案：分層 cache；呢個係 registry 類，5 分鐘）。
   ============================================================ */
export const config = { runtime: 'nodejs' };

const CACHE = new Map();                        // unit → { at, data }
const TTL_MS = 5 * 60 * 1000;

const send = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};
const normUnit = v => String(v || '').trim().toUpperCase().replace(/^0+(?=\d)/, '');

/** 只留公開欄位（白名單，唔係黑名單） */
export function publicParts(list) {
  return (Array.isArray(list) ? list : []).map(b => ({
    id: String(b.id || b.unit || '').slice(0, 32),
    name: String(b.name || b.id || '').slice(0, 60),
    api: String(b.api || 'v1').slice(0, 8),
    at: String(b.at || '').slice(0, 20),
    linked: !!b.linked
  }));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, 'http://x');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const unit = normUnit((body && body.unit) || url.searchParams.get('unit') || '');
  if (!unit) return send(res, 400, { success: false, error: '要 unit（旅 ID）' });

  const fresh = url.searchParams.get('fresh') === '1';
  const hit = CACHE.get(unit);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) {
    return send(res, 200, { success: true, data: { downstreams: hit.data, cached: true, at: new Date(hit.at).toISOString() } });
  }

  const backend = process.env[`TROOP_${unit}_BACKEND`] || process.env[`TROOP_${String(unit).padStart(4, '0')}_BACKEND`] || '';
  const apikey = process.env[`TROOP_${unit}_APIKEY`] || process.env[`TROOP_${String(unit).padStart(4, '0')}_APIKEY`] || '';
  if (!backend || !apikey) return send(res, 501, { success: false, error: `未設定 TROOP_${unit}_BACKEND／_APIKEY`, code: 'not_configured' });
  try {
    const r = await fetch(backend, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'getDownstreams', apikey }), redirect: 'follow' });
    const j = await r.json().catch(() => null);
    if (!j || j.success !== true) return send(res, 502, { success: false, error: (j && j.error) || `HTTP ${r.status}` });
    const data = publicParts(j.data);
    CACHE.set(unit, { at: Date.now(), data });
    return send(res, 200, { success: true, data: { downstreams: data, cached: false, at: new Date().toISOString() } });
  } catch (e) {
    return send(res, 502, { success: false, error: `連唔到旅 SHEET：${String(e?.message || e)}` });
  }
}

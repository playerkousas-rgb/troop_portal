/* ============================================================
   /api/units — 公開旅清單（只公開 metadata；`?diag=1` 出登記診斷，只列變數名、冇值）
   ------------------------------------------------------------
   `data/units.json` ＝ 平台 registry 嘅公開部分（旅 ID／名／支部數）。
   `TROOP_<旅ID>_*` 一律住 Vercel env，**永遠唔會出現喺呢個回應**。
   ============================================================ */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const config = { runtime: 'nodejs' };

const normUnit = v => String(v || '').trim().toUpperCase();
const visibleNames = () => {
  const ids = {};
  Object.keys(process.env).forEach(k => {
    const m = k.match(/^TROOP_([0-9A-Z]+)_(BACKEND|APIKEY|NAME)$/);
    if (!m) return;
    ids[m[1]] = ids[m[1]] || [];
    if (!ids[m[1]].includes(m[2])) ids[m[1]].push(m[2]);
  });
  return ids;
};

const send = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', code === 200 ? 'public, max-age=300' : 'no-store');
  res.end(JSON.stringify(body));
};

export function loadUnits(root = process.cwd()) {
  try { return JSON.parse(readFileSync(join(root, 'data/units.json'), 'utf8')); } catch { return { units: [] }; }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, 'http://x');
  const file = loadUnits();
  const env = visibleNames();
  const units = (file.units || []).map(u => {
    const id = normUnit(u.id);
    const have = env[id.replace(/^0+(?=\d)/, '')] || env[id] || [];
    return {
      id,
      name: u.name || '',
      nameEn: u.nameEn || '',
      district: u.district || '',
      branches: u.branches || 0,
      registered: have.length >= 2,               // BACKEND ＋ APIKEY 兩件齊
      ready: have.includes('BACKEND') && have.includes('APIKEY')
    };
  });
  if (url.searchParams.get('diag') === '1') {
    /* 診斷：**只列變數名**（冇值），同前端「登記診斷」對得上 */
    const names = Object.keys(process.env).filter(k => k.startsWith('TROOP_') || k === 'SUPER_KEY' || k === 'SESSION_SECRET');
    const expected = units.map(u => `TROOP_${u.id.replace(/^0+(?=\d)/, '')}_BACKEND`);
    return send(res, 200, {
      success: true,
      data: {
        onVercel: !!process.env.VERCEL,
        region: process.env.VERCEL_REGION || '',
        count: units.length,
        recognizedNames: names.filter(n => /^TROOP_[0-9A-Z]+_(BACKEND|APIKEY|NAME)$/.test(n)),
        withKey: names.filter(n => /_APIKEY$/.test(n)).map(n => n.replace(/_APIKEY$/, '')),
        withBackend: names.filter(n => /_BACKEND$/.test(n)).map(n => n.replace(/_BACKEND$/, '')),
        missingBackend: expected.filter(n => !process.env[n]),
        suspicious: names.filter(n => /^TROOP[^_]|_URL$|_KEY$|KEY$/.test(n)),
        hasSuperKey: !!process.env.SUPER_KEY,
        hasSessionSecret: !!process.env.SESSION_SECRET
      }
    });
  }
  return send(res, 200, { success: true, data: { units, at: new Date().toISOString() } });
}

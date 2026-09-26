/* ============================================================
   /api/registry — 能力註冊表（capability discovery）
   ------------------------------------------------------------
   答一條問題：「呢個旅開咗邊啲模組？呢個支部用唔用得？」
     · `TROOP_MODULES` 嘅**真相＝旅 SHEET `模組開關` 分頁**（用戶 §13 Q5 定案）→ 經 GAS 讀
     · 支部層：邊個支部接駁咗／燈號／行邊條登入路線（**唔回 URL／KEY**）
     · 5 分鐘 cache；`?fresh=1` 強制刷新
   唔回任何**資料**（通告內容、成員名單…）—— 純 capability。
   ============================================================ */
export const config = { runtime: 'nodejs' };

const CACHE = new Map();                     // unit → { at, data }
const TTL_MS = 5 * 60 * 1000;

const send = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};
const normUnit = v => String(v || '').trim().toUpperCase().replace(/^0+(?=\d)/, '');
export const normId = v => String(v || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

/** 模組開關（Sheet 分頁）→ 前端用嘅 shape；閂咗＝off（唔會刪資料） */
export function moduleState(rows) {
  const out = {};
  (Array.isArray(rows) ? rows : []).forEach(r => {
    const id = String(r.id || '').trim();
    if (!id) return;
    out[id] = {
      id,
      mode: r.mode === 'off' ? 'off' : (r.mode === 'custom' ? 'custom' : 'all'),
      branches: Array.isArray(r.branches) ? r.branches.map(String) : [],
      at: String(r.at || ''),
      by: String(r.by || '')
    };
  });
  return out;
}
/** 一個支部用唔用得某個模組：旅層 off＝一律唔得；custom＝要喺名單；all＝得 */
export function allowedFor(mod, branchId) {
  if (!mod || mod.mode === 'off') return false;
  if (mod.mode === 'all') return true;
  const b = normId(branchId);
  return !!b && mod.branches.map(normId).includes(b);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, 'http://x');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const unit = normUnit((body && body.unit) || url.searchParams.get('unit') || '');
  const branch = normId((body && body.branch) || url.searchParams.get('branch') || '');
  if (!unit) return send(res, 400, { success: false, error: '要 unit（旅 ID）' });
  const fresh = url.searchParams.get('fresh') === '1';

  const hit = CACHE.get(unit);
  let data = !fresh && hit && Date.now() - hit.at < TTL_MS ? { ...hit.data, cached: true } : null;

  if (!data) {
    const auth = await import('./auth.js');
    const [mods, reg] = await Promise.all([
      auth.gas(unit, { action: 'listModules' }),
      auth.gas(unit, { action: 'registry' })
    ]);
    if (!mods.ok) return send(res, mods.code === 'not_configured' ? 503 : 502, { success: false, error: mods.msg, code: mods.code });
    data = {
      unit,
      modules: moduleState(mods.data),
      branches: (Array.isArray(reg.data) ? reg.data : []).map(d => ({
        id: d.id, name: d.name, linked: d.linked === true, light: d.status || 'amber', note: d.note || ''
      })),
      cached: false
    };
    CACHE.set(unit, { at: Date.now(), data: { unit, modules: data.modules, branches: data.branches } });
  }

  if (branch) {
    const b = data.branches.find(x => normId(x.id) === branch) || null;
    data.answer = {
      branch,
      known: !!b,
      linked: !!(b && b.linked),
      light: b ? b.light : 'amber',
      modules: Object.fromEntries(Object.entries(data.modules).map(([k, m]) => [k, allowedFor(m, branch)]))
    };
  }
  return send(res, 200, { success: true, data });
}

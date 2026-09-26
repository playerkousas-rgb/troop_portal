/* ============================================================
   /api/troop — 旅層聚合讀取（BUILD §10-7「讀取樂觀化」＋分層 cache）
   ------------------------------------------------------------
   做咩：
     · 一次過由旅 GAS 拉「旅自己嘅表」（通告／行事曆／財務／物資／公開資料／求救／分享…）
     · 加埋 `getSummary`（支部燈號 registry）——**唔回 URL／KEY**
     · 分層 cache：通告／活動／求救＝5 分鐘；財務／物資／進度＝30 分鐘（用戶 §13 Q4 定案）
     · `?fresh=1`＝強制刷新（前端嗰個「強制刷新」掣）
   唔做咩：
     · **唔會**逐個下游拉數（零回打＋唔想前端等 5 個 GAS）；要下游數據＝下游自己開公開 API 或
       由旅側經 sig 拉（P2）。呢支純粹係「旅自己嘅嘢＋支部清單」。
   ============================================================ */
export const config = { runtime: 'nodejs' };

/** 分層 cache 級別（分鐘）——用戶 2026-09-26 §13 Q4 定案 */
export const CACHE_TIERS = { fast: 5, slow: 30 };
export const TABLES_TIER = {
  fast: ['旅通告', '旅行事曆', '求救', '公開資料', '分享', '模組開關'],
  slow: ['財務整合', '物資整合', '進度摘要', '支部', '教材']
};
/** GAS 分頁名 → 回應欄位名（前端 TABLE_MAP 嘅鏡像） */
const KEY_OF = {
  '旅員': 'users', '支部': 'branches', '模組開關': 'modules', '財務整合': 'financeSubmits',
  '物資整合': 'inventory', '旅通告': 'notices', '旅行事曆': 'calendar', '公開資料': 'publicInfo',
  '分享': 'shares', '求救': 'rescues', '邀請': 'invites', '申請': 'applications',
  '移交': 'transfers', '教材': 'docs', '進度摘要': 'progress', '設定值': 'settings'
};

/** 每張表屬於邊個 tier */
export function tierOf(table) {
  if (TABLES_TIER.slow.includes(table)) return 'slow';
  return 'fast';
}
export function ttlMs(tier) { return (CACHE_TIERS[tier] || CACHE_TIERS.fast) * 60 * 1000; }

/* ---------------- cache（best-effort：逐個 warm instance 一份） ---------------- */
const CACHE = new Map();                        // `${unit}|${table}` → { at, rows }
export function cacheGet(unit, table, { fresh = false, now = Date.now() } = {}) {
  const k = `${unit}|${table}`;
  const hit = CACHE.get(k);
  if (!fresh && hit && now - hit.at < ttlMs(tierOf(table))) return hit;
  return null;
}
export function cachePut(unit, table, rows, now = Date.now()) { CACHE.set(`${unit}|${table}`, { at: now, rows }); return rows; }
export function cacheClear(unit) { [...CACHE.keys()].forEach(k => { if (k.startsWith(unit + '|')) CACHE.delete(k); }); }
export const _cacheSize = () => CACHE.size;

export const normUnit = v => String(v || '').trim().toUpperCase().replace(/^0+(?=\d)/, '');

const send = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

/** 由 GAS 拉一批表（逐表帶 cache；只拉 cache 過期嗰啲） */
export async function pullTables(unit, env, { tables, fresh = false, now = Date.now() } = {}) {
  const want = (tables && tables.length ? tables : [...TABLES_TIER.fast, ...TABLES_TIER.slow]);
  const need = want.filter(t => fresh || !cacheGet(unit, t, { fresh, now }));
  const out = {}; const served = {};
  want.forEach(t => { const hit = cacheGet(unit, t, { fresh: false, now }); if (hit) { out[t] = hit.rows; served[t] = 'cache'; } });
  if (need.length) {
    const r = await env.gas({ action: 'loadTables', tables: need });
    if (!r.ok) return { ok: false, code: r.code, msg: r.msg };
    const byGas = (r.data && r.data.data) || {};
    need.forEach(t => {
      const rows = byGas[t] || [];
      cachePut(unit, t, rows, now);
      out[t] = rows; served[t] = 'gas';
    });
  }
  return { ok: true, tables: out, served };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, 'http://x');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const unit = normUnit((body && body.unit) || url.searchParams.get('unit') || '');
  if (!unit) return send(res, 400, { success: false, error: '要 unit（旅 ID）' });
  const fresh = url.searchParams.get('fresh') === '1' || (body && body.fresh === true);

  const auth = await import('./auth.js');
  /* session（可選）：有就當登入（順手驗 session 屬唔屬呢個旅）；冇就照讀（旅公開層資料） */
  const secret = process.env.SESSION_SECRET || '';
  const sess = secret ? auth.verifySession(cookieValue(req, 'troop_session'), secret) : null;
  if (sess && normUnit(sess.unit) !== unit) return send(res, 403, { success: false, error: 'session 唔屬於呢個旅' });

  const env = { gas: b => auth.gas(unit, b) };

  /* ① 分頁資料（逐 tier cache） */
  const wanted = fresh ? undefined : [...TABLES_TIER.fast, ...TABLES_TIER.slow];
  const pulled = await pullTables(unit, env, { tables: wanted, fresh });
  if (!pulled.ok) return send(res, pulled.code === 'not_configured' ? 503 : 502, { success: false, error: pulled.msg, code: pulled.code });

  /* ② 摘要＋支部燈號（呢個永遠要新鮮：佢係狀態，唔係內容） */
  const sum = await env.gas({ action: 'getSummary' });
  if (!sum.ok) return send(res, sum.code === 'not_configured' ? 503 : 502, { success: false, error: sum.msg, code: sum.code });

  /* ③ 砌回應（欄位名同前端 TABLE_MAP 對得上） */
  const tables = {};
  Object.entries(pulled.tables).forEach(([gasName, rows]) => { tables[KEY_OF[gasName] || gasName] = rows; });
  return send(res, 200, {
    success: true,
    data: {
      unit,
      summary: { ...sum.data },
      tables,
      tiers: { fast: TABLES_TIER.fast.map(KEY_OF), slow: TABLES_TIER.slow.map(KEY_OF) },
      served: pulled.served,
      at: new Date().toISOString(),
      cached: Object.values(pulled.served).some(v => v === 'cache'),
      session: sess ? { email: sess.email, role: sess.role } : null
    }
  });
}

function cookieValue(req, name) {
  const raw = String(req.headers?.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '=')) || '';
  return raw.slice(name.length + 1);
}

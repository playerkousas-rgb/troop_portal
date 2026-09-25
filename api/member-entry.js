/* ============================================================
   /api/member-entry — 成員入口導流（建構計劃 §3.3 · M1／M3）
   ------------------------------------------------------------
   點解要有一支咁嘅嘢：成員喺旅閘「揀咗團」之後，旅要話佢知**行邊條路**：
     · M1 one-stop：支部接駁好＋綠燈＋測過連線 → 旅側代交 sig，一次登入
     · M3 two-stop：未 ready → 旅只做門戶（轉去該團入口，密碼由該團自己驗）
     · none：    呢個旅之下搵唔到呢個支部 → **老實講**，唔會亂指
   ★ 私隱：呢支**唔會**回答「某個 email 有冇戶口」（帳號存在性＝資料外洩）。
     想知入唔入得，就要真係行登入；「驗唔到就唔好扮驗到」。
   ============================================================ */
export const config = { runtime: 'nodejs' };

export const ROUTES = {
  'one-stop': { mode: 'one-stop', label: '一次登入（M1）', desc: '旅側代交 sig，成員只喺旅閘打一次密碼' },
  'two-stop': { mode: 'two-stop', label: '轉去該團入口（M3）', desc: '旅只做門戶；密碼由該團自己驗（團側零改動）' },
  none: { mode: 'none', label: '未接駁', desc: '呢個旅之下冇呢個支部；請向旅部查詢' }
};

/** 一個支部行邊條路線（同前端 registry.js `loginRouteFor` 同一條規則） */
export function routeForDownstream(d = {}) {
  const ready = d.linked === true && d.status === 'green' && d.tested === true;
  return ready ? 'one-stop' : 'two-stop';
}

const send = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};
const normId = v => String(v || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, 'http://x');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const unit = String((body && body.unit) || url.searchParams.get('unit') || '').trim().toUpperCase().replace(/^0+(?=\d)/, '');
  const branch = normId((body && body.branch) || url.searchParams.get('branch') || '');
  if (!unit) return send(res, 400, { success: false, error: '要 unit（旅 ID）' });
  if (!branch) return send(res, 400, { success: false, error: '要 branch（支部 id；例 vs0082）' });

  const auth = await import('./auth.js');
  const r = await auth.gas(unit, { action: 'registry' });
  if (!r.ok) {
    const code = r.code === 'not_configured' ? 503 : 502;
    /* 未設定／連唔到 → **唔可以扮知道**：回 none 但有明確原因，前端要老實顯示 */
    return send(res, code, { success: false, error: r.msg, code: r.code, data: { unit, branch, route: 'none', reason: r.code } });
  }
  const list = Array.isArray(r.data) ? r.data : [];
  const hit = list.find(d => normId(d.id) === branch);
  if (!hit) return send(res, 200, { success: true, data: { unit, branch, route: 'none', reason: 'not_linked', note: ROUTES.none.desc } });
  const mode = routeForDownstream(hit);
  return send(res, 200, {
    success: true,
    data: {
      unit, branch,
      name: hit.name || branch,
      route: mode,
      label: ROUTES[mode].label,
      desc: ROUTES[mode].desc,
      light: hit.status, note: hit.note || '',
      linked: hit.linked === true,
      /* 入口：**唔會**回支部 URL（registry 永不含 URL）；旅側只提供自己嘅門 */
      entry: mode === 'one-stop' ? `/?step=login&u=${encodeURIComponent(unit)}&b=${encodeURIComponent(branch)}` : `/?step=branch&u=${encodeURIComponent(unit)}&b=${encodeURIComponent(branch)}`,
      how: mode === 'one-stop'
        ? ['旅閘打一次密碼 → 旅側驗完即刻簽 sig 交該團 → 入到去', '密碼 hash 住該團 SHEET；旅側唔存你嘅密碼']
        : ['旅閘先確認你係邊個支部', '轉去該團入口，由該團自己驗密碼', '接駁好＋綠燈＋測過連線之後，旅側會自動升做一次登入'],
      privacy: '呢個端點唔會透露任何帳號有冇存在（唔做帳號枚舉）。'
    }
  });
}

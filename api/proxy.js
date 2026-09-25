/* ============================================================
   /api/proxy — 旅系統唯一代理出口（Vercel Function · 零依賴）
   ------------------------------------------------------------
   規矩（建構計劃 §6.2／§6.8）：
     · apikey／端點永遠唔落前端：前端只打同源 /api/proxy
     · 逐個 action 白名單；未實作嘅 action 一律「誠實失敗」（501），唔會靜靜當成功
     · log 只記 metadata（時間／action／結果），唔記內容、唔記密碼

   ★ 已實作：action = 'issue'
     對正 Scout Admin「問題回報 TICK」合約（同一支 GAS、同一張表 —— 同圖書館
     report.html?app=圖書館 一樣）：
       POST { type:'issue', sourceApp, title, desc, severity, troopId, name, contact }
     severity 白名單：低／中／高／緊急；亂填／陌生值 → 落「高」。
     ADMIN 側唔使改任何嘢：佢見 type:'issue' 就寫入「問題回報」表 ＋ Email 通知。

   之後（P0）會加：action = login / troop / proxy:<action> → 旅 GAS /exec（inject apikey）。
   ============================================================ */
export const config = { runtime: 'nodejs' };

const REPORT = {
  type: 'issue',
  severities: ['低', '中', '高', '緊急'],
  fallbackSeverity: '高',
  maxDesc: 2000,
  maxTitle: 120
};

/** ADMIN 收件匣（Scout Admin）嘅固定 Apps Script 端點。可由環境變數蓋過，但永遠只留喺 server 側。 */
const ADMIN_ISSUE_ENDPOINT = process.env.ADMIN_ISSUE_ENDPOINT ||
  'https://script.google.com/macros/s/AKfycbxj5BDDGgjs559smkK4Z5aYImWYeXbN5af8U1ObON0z9WnsN6QJW4I1XWolhs5kQ_H-UQ/exec';

/* 限流（best-effort：逐個 warm instance 記 IP；正式限流喺旅 GAS 階段一齊做） */
const HITS = new Map();
const LIMIT = { max: 6, windowMs: 10 * 60 * 1000 };
function rateLimited(ip) {
  const now = Date.now();
  const arr = (HITS.get(ip) || []).filter(t => now - t < LIMIT.windowMs);
  arr.push(now);
  HITS.set(ip, arr);
  if (HITS.size > 5000) HITS.clear();                 // 唔好無限增長
  return arr.length > LIMIT.max;
}

const send = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

/** 問題回報：把前端表單砌成合同 payload（同前端 registry.REPORT.payload 一套規矩） */
export function buildIssuePayload(form = {}) {
  const sev = REPORT.severities.includes(form.severity) ? form.severity : REPORT.fallbackSeverity;
  return {
    type: REPORT.type,
    sourceApp: String(form.sourceApp || 'troop_portal').trim(),
    title: String(form.title || '').trim().slice(0, REPORT.maxTitle),
    desc: String(form.desc || '').trim().slice(0, REPORT.maxDesc),
    severity: sev,
    troopId: String(form.troopId || '').trim(),
    name: String(form.name || '').trim(),
    contact: String(form.contact || '').trim()
  };
}

export async function forwardIssue(payload) {
  const r = await fetch(ADMIN_ISSUE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'follow'
  });
  const text = await r.text().catch(() => '');
  let json = null;
  try { json = JSON.parse(text); } catch { /* GAS 有時回 HTML／空字串 */ }
  const ok = r.ok && !(json && json.success === false);
  return { ok, status: r.status, error: ok ? '' : (json?.error || `HTTP ${r.status}`) };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const at = new Date().toISOString();
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

  /* 收 body（Vercel Node runtime：預設已 parse JSON；保險起見兩種都食） */
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== 'object') return send(res, 400, { success: false, error: '要 JSON body' });

  const action = String(body.action || '');
  console.log(`[proxy] ${at} ip=${ip} action=${action || '(none)'}`);   // 只記 metadata

  /* ---------- action: issue（Scout Admin 問題回報 TICK） ---------- */
  if (action === 'issue') {
    const payload = buildIssuePayload(body);
    if (!payload.title) return send(res, 400, { success: false, error: '要填標題（一句）' });
    if (!payload.desc) return send(res, 400, { success: false, error: '要填問題詳情' });
    if (rateLimited(ip)) return send(res, 429, { success: false, error: '送得太密（10 分鐘最多 6 次）—— 請等一等再試' });
    try {
      const out = await forwardIssue(payload);
      if (!out.ok) return send(res, 502, { success: false, error: `送唔到 ADMIN 收件匣（${out.error}）`, officialUrl: 'https://scout-admin-blue.vercel.app/report.html?app=troop_portal' });
      return send(res, 200, { success: true, data: { type: payload.type, sourceApp: payload.sourceApp, severity: payload.severity, at } });
    } catch (e) {
      return send(res, 502, { success: false, error: `連唔到 ADMIN 收件匣（${String(e?.message || e)}）`, officialUrl: 'https://scout-admin-blue.vercel.app/report.html?app=troop_portal' });
    }
  }

  /* ---------- 其他 action：未實作 → 誠實失敗（唔會扮成功） ---------- */
  return send(res, 501, {
    success: false,
    error: `action='${action || '(none)'}' 未實作（UI 先行）`,
    planned: ['issue（已實作）', 'login / logout', 'troop（聚合讀取）', 'proxy:<白名單 action> → 旅 GAS /exec'],
    note: 'apikey 只喺 server 側注入；前端、QR、URL 永不帶 key'
  });
}

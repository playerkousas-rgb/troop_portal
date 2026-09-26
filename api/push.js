/* ============================================================
   /api/push — 個人化訂閱接入（★ 復用圖書館現有推送鏈，零另起爐灶）
   ------------------------------------------------------------
   BUILD §5.4：圖書館每日 scrape → Supabase `push_subscriptions`
   → GitHub Actions 06:00 `notify.py` → pywebpush（VAPID）→ 7 日 rolling 補漏。
   旅系統只做「訂閱設定前端」：把瀏覽器訂閱（endpoint／keys）轉去**圖書館**張表。

   三條鐵律（同 push.js 一致）：
     ① 送出去嘅只有 endpoint／keys／topics／scope／source —— **冇姓名、冇 email、冇 YMIS**
        （白名單過濾：payload 有任何其他欄位一律剝走，唔會轉發）
     ② 未設定 `PUSH_INGEST_URL`／`VAPID_PUBLIC_KEY`＝**誠實講未開通**（唔會扮成功、唔會自己存一份）
     ③ 前端永遠只認同源 `/api/…`（Supabase key 同圖書館 URL 只住 Vercel env）

   env：`VAPID_PUBLIC_KEY`（前端訂閱要用嘅公鑰；私鑰住圖書館側唔會出現喺呢度）
        `PUSH_INGEST_URL`（圖書館嘅收件位；Supabase Edge Function 或現成 webhook）
        `PUSH_INGEST_KEY`（可選：Bearer）
   ============================================================ */
export const config = { runtime: 'nodejs' };

const TOPICS = ['circulars', 'notices', 'calendar'];
const MAX_PER_IP = 10;                       // 每個 IP 每 10 分鐘
const WINDOW_MS = 10 * 60 * 1000;
const hits = new Map();                      // 本機／serverless 實例內（best-effort）

const send = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};
const ok = (res, data) => send(res, 200, { success: true, data });
const bad = (res, code, msg, extra = {}) => send(res, 200, { success: false, code, error: msg, ...extra });

const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const looksLikeEndpoint = u => /^https:\/\/[^\s]{10,500}$/.test(String(u || ''));
const looksLikeKey = (k, n) => /^[A-Za-z0-9_-]{20,200}$/.test(String(k || '')) && String(k).length <= n;

/** ★ 白名單：受得了嘅欄位就係呢幾個；其他一律剝走（唔會將 PII 轉去圖書館） */
export function sanitizeSubscription(payload) {
  const p = payload || {};
  const topics = (Array.isArray(p.topics) ? p.topics : []).map(t => str(t, 20)).filter(t => TOPICS.includes(t));
  return {
    source: str(p.source || 'troop_portal', 20),
    endpoint: str(p.endpoint, 500),
    keys: { p256dh: str(p.keys?.p256dh, 200), auth: str(p.keys?.auth, 100) },
    topics: topics.length ? Array.from(new Set(topics)) : ['circulars'],
    scope: str(p.scope, 40),                 // 例：82/sc0082（單位／支部；唔係個人）
    at: new Date().toISOString(),
    ua: ''                                   // 刻意唔轉發 user-agent（冇必要、避免指紋）
  };
}
export function validateSubscription(s) {
  const missing = [];
  if (!looksLikeEndpoint(s.endpoint)) missing.push('endpoint');
  if (!looksLikeKey(s.keys.p256dh, 200)) missing.push('p256dh');
  if (!looksLikeKey(s.keys.auth, 100)) missing.push('auth');
  return { ok: missing.length === 0, missing };
}
/** 有冇帶疑似個人資料（測試用；正常路徑已經白名單剝走） */
export function hasPii(payload) {
  const flat = JSON.stringify(payload || {});
  return /"(email|name|ymis|phone|scout_id|user)"\s*:|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i.test(flat);
}
export function rateLimited(ip, now = Date.now()) {
  const k = String(ip || 'unknown');
  const arr = (hits.get(k) || []).filter(t => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_IP) { hits.set(k, arr); return true; }
  arr.push(now); hits.set(k, arr);
  return false;
}

export function pushConfig(env = process.env) {
  const vapid = str(env.VAPID_PUBLIC_KEY, 200);
  const ingest = str(env.PUSH_INGEST_URL, 500);
  return {
    enabled: !!(vapid && ingest),
    vapidPublicKey: vapid,                                  // 公鑰係公開嘅，可以畀前端
    hasIngest: !!ingest,                                    // 但收件位（Supabase URL）唔會出
    source: 'troop_portal',
    topics: TOPICS,
    note: (vapid && ingest)
      ? '圖書館推送鏈已設定：訂閱會轉去館方（唔會存喺旅側）'
      : `未開通：${!vapid ? '未設 VAPID_PUBLIC_KEY' : ''}${!vapid && !ingest ? '、' : ''}${!ingest ? '未設 PUSH_INGEST_URL' : ''} —— 訂閱意願只會存喺你自己部機（唔會扮成功）`
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST') return bad(res, 'bad_method', '只收 POST');
  let body = null;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || null); } catch { body = null; }
  if (!body || typeof body !== 'object') return bad(res, 'bad_json', 'body 唔係 JSON');
  const action = str(body.action, 20);
  const ip = str((req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '', 60).split(',')[0].trim();

  if (action === 'config') return ok(res, pushConfig());
  if (action !== 'subscribe' && action !== 'unsubscribe') return bad(res, 'bad_action', 'action 只可以 config／subscribe／unsubscribe');

  if (rateLimited(ip)) return bad(res, 'rate_limited', `同一個網絡每 10 分鐘最多 ${MAX_PER_IP} 次訂閱操作 —— 請等一等`);

  const cfg = pushConfig();
  if (action === 'unsubscribe') {
    const endpoint = str(body.endpoint, 500);
    if (!cfg.hasIngest) return bad(res, 'not_configured', cfg.note);
    const r = await forward({ action: 'unsubscribe', endpoint }, cfg);
    return r.ok ? ok(res, { forwarded: true, note: '已交館方停止推送（旅側冇存過任何嘢）' }) : bad(res, r.code || 'ingest_fail', r.msg);
  }

  const sub = sanitizeSubscription(body.payload || body);
  const v = validateSubscription(sub);
  if (!v.ok) return bad(res, 'bad_subscription', `訂閱資料唔齊：${v.missing.join('、')}`);
  if (hasPii(body.payload || body)) {
    /* 有 PII 都唔會轉發（白名單已剝）——但記落回應，等前端知自己送多咗（唔會靜靜食咗） */
    return ok(res, { stored: false, stripped: true, note: '你嘅訂閱資料含個人資料欄位，已經剝走先轉發（館方只需要 endpoint／keys／topics）' , ...(cfg.hasIngest ? await forwardForwarding(sub, cfg) : {}) });
  }
  if (!cfg.enabled) {
    return bad(res, 'not_configured', cfg.note, { localOnly: true, topics: sub.topics, vapidMissing: !cfg.vapidPublicKey });
  }
  const r = await forward({ action: 'subscribe', subscription: sub }, cfg);
  return r.ok ? ok(res, { stored: true, topics: sub.topics, note: '已交館方推送鏈（旅側唔存訂閱表）' }) : bad(res, r.code || 'ingest_fail', r.msg);
}

async function forwardForwarding(sub, cfg) {
  const r = await forward({ action: 'subscribe', subscription: sub }, cfg);
  return r.ok ? { stored: true } : { stored: false, code: r.code || 'ingest_fail' };
}
/** 轉去圖書館收件位（Supabase Edge Function／webhook）；唔會寫任何旅側儲存 */
async function forward(payload, cfg) {
  const url = cfg.hasIngest ? process.env.PUSH_INGEST_URL : '';
  if (!url) return { ok: false, code: 'not_configured', msg: '未設定 PUSH_INGEST_URL' };
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.PUSH_INGEST_KEY) headers.Authorization = `Bearer ${process.env.PUSH_INGEST_KEY}`;
  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const txt = await r.text().catch(() => '');
    if (!r.ok) return { ok: false, code: 'ingest_fail', msg: `館方收件位回 HTTP ${r.status}${txt ? '：' + str(txt, 120) : ''}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, code: 'ingest_unreachable', msg: `連唔到館方收件位（${String(e?.message || e)}）` };
  }
}

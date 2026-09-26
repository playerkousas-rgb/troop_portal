/* ============================================================
   push.js — 個人化訂閱（★ BUILD 重中之重）
   ------------------------------------------------------------
   BUILD 寫法：「前端訂閱設定 → **圖書館現有推送鏈**（Supabase `push_subscriptions`
   → GitHub Actions 06:00 `notify.py` → pywebpush）。系統**零另起爐灶**。」
   鐵律：
     · 我哋**唔建**第二條推送鏈、唔存自己嘅訂閱表
     · 送出去嘅只有：`endpoint`／`keys`（VAPID 必需）＋ `topics`（訂咩）＋ `source`
       **冇姓名、冇 email、冇旅 ID 對人**（館方知道「幾多人訂、訂咩」，唔知「邊個」）
     · 未設定（VAPID 公鑰／館方收件位）＝本機照樣記低訂閱意願，但**唔會扮成功**
   真訂閱流程（四個位，任何一步唔得都會老實講）：
     ① 能力檢查（service worker ＋ PushManager ＋ 通知權限）
     ② 問 server 拎設定（同源 `/api/push` action=config）→ 未開通就停喺 `not_configured`
     ③ 註冊 `sw.js` ＋ `pushManager.subscribe({ userVisibleOnly:true, applicationServerKey })`
     ④ 將訂閱（匿名）交去 `/api/push` → 轉去館方（旅側唔存）
   ============================================================ */

/** 圖書館推送鏈嘅接入位（同源；Supabase key 同館方 URL 只住 Vercel env） */
export const PUSH_CONFIG = {
  endpoint: '/api/push',
  source: 'troop_portal',
  topics: ['circulars', 'notices', 'calendar']
};
export const SW_URL = './sw.js';

/** 訂閱意向 → 送去圖書館嘅 payload（**只有匿名資料**） */
export function buildSubscription(sub, { topics = [], unit = '', branch = '' } = {}) {
  const t = (Array.isArray(topics) ? topics : []).map(x => String(x).trim()).filter(x => PUSH_CONFIG.topics.includes(x));
  return {
    source: PUSH_CONFIG.source,
    endpoint: String(sub?.endpoint || '').slice(0, 500),
    keys: { p256dh: String(sub?.keys?.p256dh || '').slice(0, 200), auth: String(sub?.keys?.auth || '').slice(0, 100) },
    topics: t.length ? t : ['circulars'],
    /* 只帶「邊個單位／支部」呢類 **唔係個人** 嘅維度；刻意冇 email／name */
    scope: [unit, branch].filter(Boolean).join('/').slice(0, 40),
    at: new Date().toISOString()
  };
}
/** 檢查訂閱：有 endpoint ＋ 兩條 key 才算有效 */
export function checkSubscription(sub) {
  const missing = [];
  if (!sub?.endpoint) missing.push('endpoint');
  if (!sub?.keys?.p256dh) missing.push('p256dh');
  if (!sub?.keys?.auth) missing.push('auth');
  return { ok: missing.length === 0, missing };
}
/** 前端環境能力（唔會 throw；冇 service worker／冇 PushManager 就老實講） */
export function capability(win = globalThis) {
  const hasSW = !!(win.navigator && 'serviceWorker' in win.navigator);
  const hasPush = !!(win.PushManager || (win.window && win.window.PushManager) || (win.self && win.self.PushManager));
  const perm = (() => { try { return (win.Notification && win.Notification.permission) || 'default'; } catch (e) { return 'unknown'; } })();
  const can = hasSW && hasPush;
  return {
    serviceWorker: hasSW, push: hasPush, permission: perm,
    ok: can,
    note: can
      ? (perm === 'denied' ? '瀏覽器已經封鎖通知權限（要喺瀏覽器設定開返）' : '支援：可以訂閱推送')
      : '呢個瀏覽器唔支援推送（或者唔喺 https／localhost）—— 訂閱意願照樣存低，但唔會收到推送'
  };
}
const b64ToBytes = b64 => {
  const s = String(b64 || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s + '='.repeat((4 - (s.length % 4)) % 4);
  const raw = (globalThis.atob ? globalThis.atob(pad) : Buffer.from(pad, 'base64').toString('binary'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
};

/** 拎推送鏈設定（同源 /api/push action=config）—— 示範模式零 fetch */
export async function pushConfig({ fetchImpl = globalThis.fetch, live = true } = {}) {
  if (!live) return { ok: false, code: 'mock', msg: '示範模式：唔會發任何請求（亦唔會扮訂閱成功）' };
  try {
    const r = await fetchImpl(PUSH_CONFIG.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ action: 'config' })
    });
    const j = await r.json().catch(() => null);
    if (!j) return { ok: false, code: 'bad_response', msg: `回應唔係 JSON（HTTP ${r.status}）` };
    return j.success === true ? { ok: true, data: j.data } : { ok: false, code: j.code || 'fail', msg: j.error || '失敗' };
  } catch (e) {
    return { ok: false, code: 'network', msg: `連唔到（${String(e?.message || e)}）` };
  }
}

/** 送出訂閱（真模式先會發；示範模式回 mock，唔會扮成功） */
export async function subscribe(sub, opts, api, { fetchImpl = globalThis.fetch } = {}) {
  const chk = checkSubscription(sub);
  if (!chk.ok) return { ok: false, code: 'bad_subscription', msg: `訂閱資料唔齊：${chk.missing.join('、')}` };
  const payload = buildSubscription(sub, opts);
  const live = !!(api && api.isLive && api.isLive());
  if (!live) return { ok: true, code: 'mock', data: { ...payload, localOnly: true }, msg: '示範模式：只存本機（唔會送去圖書館）' };
  try {
    const r = await fetchImpl(PUSH_CONFIG.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ action: 'subscribe', payload })
    });
    const j = await r.json().catch(() => null);
    if (!j) return { ok: false, code: 'bad_response', msg: `回應唔係 JSON（HTTP ${r.status}）` };
    return j.success === true ? { ok: true, data: j.data } : { ok: false, code: j.code || 'fail', msg: j.error || '訂閱失敗' };
  } catch (e) {
    return { ok: false, code: 'network', msg: `連唔到（${String(e?.message || e)}）` };
  }
}
/** 停止推送（交館方移除；旅側從來冇存過） */
export async function unsubscribe(endpoint, { fetchImpl = globalThis.fetch } = {}) {
  try {
    const r = await fetchImpl(PUSH_CONFIG.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ action: 'unsubscribe', endpoint })
    });
    const j = await r.json().catch(() => null);
    return j && j.success === true ? { ok: true, data: j.data } : { ok: false, code: j?.code || 'fail', msg: j?.error || '取消失敗' };
  } catch (e) {
    return { ok: false, code: 'network', msg: String(e?.message || e) };
  }
}

/**
 * ★ 真正訂閱呢部裝置（四步；任何一步唔得都回老實結果，唔會扮成功）
 * @returns {{ok:boolean, code?:string, msg?:string, data?:object}}
 */
export async function subscribeDevice({ topics = [], unit = '', branch = '', win = globalThis } = {}) {
  const cap = capability(win);
  if (!cap.serviceWorker) return { ok: false, code: 'no_sw', msg: '呢個瀏覽器冇 service worker —— 唔可以訂閱' };
  if (!cap.push) return { ok: false, code: 'no_push', msg: '呢個瀏覽器冇 Push API —— 唔可以訂閱' };

  /* ① 設定：未開通就唔會嘈住要權限（唔會扮成功） */
  const cfg = await pushConfig({ fetchImpl: win.fetch ? win.fetch.bind(win) : undefined, live: true });
  if (!cfg.ok) return { ok: false, code: cfg.code, msg: cfg.msg };
  if (!cfg.data?.enabled) return { ok: false, code: 'not_configured', msg: cfg.data?.note || '圖書館推送鏈未開通' };
  if (!cfg.data?.vapidPublicKey) return { ok: false, code: 'no_vapid', msg: '未設 VAPID 公鑰 —— 冇得訂閱' };

  /* ② 通知權限（用戶唔畀就停，唔會再問） */
  try {
    const perm = await win.Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, code: 'permission_denied', msg: '未開通知權限 —— 收唔到推送（可以喺瀏覽器設定開返）' };
  } catch (e) {
    return { ok: false, code: 'permission_error', msg: `通知權限問唔到（${String(e?.message || e)}）` };
  }

  /* ③ 註冊 service worker ＋ 訂閱 */
  let reg = null, sub = null;
  try {
    reg = await win.navigator.serviceWorker.register(SW_URL, { scope: './' });
    await (win.navigator.serviceWorker.ready || Promise.resolve());
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToBytes(cfg.data.vapidPublicKey)
    });
  } catch (e) {
    return { ok: false, code: 'subscribe_fail', msg: `訂閱失敗（${String(e?.message || e)}）` };
  }

  /* ④ 交去館方（旅側唔存） */
  const sent = await subscribe(sub.toJSON ? sub.toJSON() : sub, { topics, unit, branch }, { isLive: () => true }, { fetchImpl: win.fetch ? win.fetch.bind(win) : undefined });
  if (!sent.ok) return { ok: false, code: sent.code, msg: sent.msg };
  return { ok: true, data: { ...sent.data, endpoint: sub.endpoint, note: sent.data?.note || '已交館方推送鏈' } };
}

/** 頁面載入時掛：接收 sw 嘅訂閱變更通知 → 重新訂閱一次（唔會無限迴圈） */
export function watchSubscriptionChanges(win = globalThis, onChanged = null) {
  if (!win.navigator?.serviceWorker) return () => { };
  const h = e => { if (e.data?.type === 'push-subscription-change') onChanged && onChanged(e.data); };
  win.navigator.serviceWorker.addEventListener('message', h);
  return () => win.navigator.serviceWorker.removeEventListener('message', h);
}

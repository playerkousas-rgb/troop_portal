/* ============================================================
   push.js — 個人化訂閱（★ BUILD 重中之重）
   ------------------------------------------------------------
   BUILD 寫法：「前端訂閱設定 → **圖書館現有推送鏈**（Supabase `push_subscriptions`
   → GitHub Actions 06:00 `notify.py` → pywebpush）。系統**零另起爐灶**。」
   鐵律：
     · 我哋**唔建**第二條推送鏈、唔存自己嘅訂閱表
     · 送出去嘅只有：`endpoint`／`keys`（VAPID 必需）＋ `topics`（訂咩）＋ `source`
       **冇姓名、冇 email、冇旅 ID 對人**（館方知道「幾多人訂、訂咩」，唔知「邊個」）
     · 未設定 Supabase 端點＝本機照樣記低，但**唔會扮成功**
   ============================================================ */

/** 圖書館推送鏈嘅接入位（Vercel env；前端只認同源 /api/…，唔會直接打外部 URL） */
export const PUSH_CONFIG = {
  /** 由 server 側讀 env 之後轉發（前端永不見 Supabase key） */
  endpoint: '/api/proxy',
  source: 'troop_portal',
  topics: ['circulars', 'notices', 'calendar']
};

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
  const hasPush = !!(win.PushManager || (win.window && win.window.PushManager));
  return {
    serviceWorker: hasSW, push: hasPush,
    note: hasSW && hasPush ? '支援：可以訂閱' : '呢個瀏覽器唔支援推送（或者未開通知權限）—— 訂閱設定照樣存低'
  };
}
/** 送出訂閱（真模式先會發；示範模式回 mock） */
export async function subscribe(sub, opts, api) {
  const chk = checkSubscription(sub);
  if (!chk.ok) return { ok: false, code: 'bad_subscription', msg: `訂閱資料唔齊：${chk.missing.join('、')}` };
  const payload = buildSubscription(sub, opts);
  if (!api || !api.isLive || !api.isLive()) return { ok: true, code: 'mock', data: { ...payload, localOnly: true }, msg: '示範模式：只存本機（唔會送去圖書館）' };
  const r = await api.gasAction('subscribePush', { payload });          // 旅 GAS／圖書館鏈側接
  return r.ok ? { ok: true, data: r.data } : { ok: false, code: r.code || 'fail', msg: r.msg };
}

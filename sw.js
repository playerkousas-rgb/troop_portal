/* ============================================================
   sw.js — 旅系統 service worker（推送接收端）
   ------------------------------------------------------------
   只做三件事（唔做離線快取、唔攔截 fetch —— 免得同 Vercel／app 打架）：
     ① push：收圖書館推送（VAPID）→ 顯示通知（同一個 tag 會取代舊通知）
     ② notificationclick：撳通知 → 開／聚焦旅系統，帶 ?from=push
     ③ pushsubscriptionchange：訂閱被瀏覽器換咗 → 通知頁面重新訂閱（頁面接收後會自動重送）

   推送內容約定（館方 notify.py 送）：{ title, body, url, topics, tag, at }
   —— 收唔到／壞 JSON 都要照樣彈一個安全通知（唔可以靜靜食咗）。
   ============================================================ */
const VERSION = 'v1';
const DEFAULT_TITLE = '旅系統通知';

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: (event.data && event.data.text && event.data.text()) || '' }; }
  const title = String(d.title || DEFAULT_TITLE);
  const body = String(d.body || d.message || '（冇內容）').slice(0, 300);
  const url = String(d.url || d.link || './?from=push');
  const tag = String(d.tag || d.topics || 'troop-notice');
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    renotify: false,
    data: { url, at: d.at || new Date().toISOString() },
    badge: './assets/img/badge.png',
    icon: './assets/img/icon.png'
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(String((event.notification.data && event.notification.data.url) || './?from=push'), self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        try { await c.focus(); } catch (e) { /* 聚焦唔到就照開新窗 */ }
        if (c.navigate) { try { await c.navigate(target); return; } catch (e) { /* 舊瀏覽器唔支援 */ } }
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

/* 瀏覽器換咗訂閱（例如重裝）：叫頁面重新訂閱，頁面會將新 endpoint 送去館方 */
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    all.forEach(c => c.postMessage({ type: 'push-subscription-change', at: new Date().toISOString() }));
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'ping') {
    if (event.source && event.source.postMessage) event.source.postMessage({ type: 'pong', version: VERSION });
  }
});

#!/usr/bin/env node
/* ============================================================
   dev-server.mjs — 本機靜態伺服器（零依賴）
   ------------------------------------------------------------
   · 直接 serve repo root（同 Vercel 靜態部署一致：冇 build step）
   · /api/* → 暫時回「誠實失敗」（UI 先行：後端未實作）
     真模式：同源 /api/proxy → 旅 GAS /exec（apikey 只喺 server 側注入，
     前端／QR／URL 永遠唔會見到 key）
   · 綁 0.0.0.0，方便 preview／手機測試
   ============================================================ */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.pdf': 'application/pdf'
};

const json = (res, code, obj) => {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = decodeURIComponent(url.pathname);
  const started = Date.now();

  /* ---------- /api/proxy + action=issue：本機 sink（唔會真送去 ADMIN） ----------
     ★ 點解：本機測試唔應該真係喺 ADMIN 收件匣開 TICK（真送係 Vercel 上 api/proxy.js 嘅事）。
     所以 dev-server 只會 log 出「對正合同」嘅 payload，回一個明確標示「本機示範」嘅成功；
     前端照樣行同一條 code path（sendAdminReport → POST /api/proxy）。 */
  if (path === '/api/proxy' && req.method === 'POST') {
    const raw = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
    let body = null;
    try { body = JSON.parse(raw || '{}'); } catch { body = null; }
    if (!body || body.action !== 'issue') {
      /* 其他 action（旅 GAS 白名單等）→ **行真 handler**（api/proxy.js）：
         未設 TROOP_<旅ID>_* env 就會誠實回 503 not_configured，唔會扮成功。 */
      console.log(`[api] POST /api/proxy action=${body?.action || '(none)'} → 真 handler（本機）`);
      const mod = await import('./api/proxy.js');
      req.body = body;                       // ★ body 已經讀咗：交返俾 handler（唔係就會「要 JSON body」）
      return await mod.default(req, res);
    }
    const { buildIssuePayload } = await import('./api/proxy.js');
    const payload = buildIssuePayload(body);
    if (!payload.title || !payload.desc) return json(res, 400, { success: false, error: payload.title ? '要填問題詳情' : '要填標題（一句）' });
    console.log(`[issue] 對正 Scout Admin 合同（本機 sink，冇真送）：${JSON.stringify(payload)}`);
    return json(res, 200, {
      success: true,
      data: { type: payload.type, sourceApp: payload.sourceApp, severity: payload.severity, at: new Date().toISOString(), localSink: true },
      note: '本機 dev-server 只做 sink（唔會真送 ADMIN）；真送＝Vercel 上 api/proxy.js。'
    });
  }

  /* ---------- /api/*：真 handler（同 Vercel 同一支 code；env 唔齊嘅會誠實回 501／503） ----------
     ★ 點解要咁做：本機 preview 都應該行**真**邏輯（唔係另一套），例如：
       · /api/units            → 公開旅清單（唔使 env）＋ ?diag=1
       · /api/downstreams      → 未設 TROOP_82_* env 就回 not_configured（唔會扮有）
       · /api/auth、/api/super → 未設 SESSION_SECRET／SUPER_KEY 就誠實拒
     只有 `issue` 例外（下面單獨處理）＝本機 sink，唔會真喺 ADMIN 開 TICK。 */
  const API_ROUTES = {
    '/api/units': './api/units.js', '/api/downstreams': './api/downstreams.js',
    '/api/auth': './api/auth.js', '/api/super': './api/super.js',
    '/api/troop': './api/troop.js', '/api/registry': './api/registry.js',
    '/api/member-entry': './api/member-entry.js', '/api/share': './api/share.js'
  };
  if (API_ROUTES[path]) {
    try {
      const mod = await import(API_ROUTES[path]);
      console.log(`[api] ${req.method} ${path}${url.searchParams.toString() ? '?' + url.searchParams : ''} → 真 handler（本機）`);
      return await mod.default(req, res);
    } catch (e) {
      console.log(`[api] ${path} 爆咗：${e?.message || e}`);
      return json(res, 500, { success: false, error: String(e?.message || e), where: 'dev-server → ' + API_ROUTES[path] });
    }
  }

  /* ---------- /api/*：其餘（UI 先行） ---------- */
  if (path.startsWith('/api/')) {
    const action = url.searchParams.get('action') || url.searchParams.get('a') || '';
    console.log(`[api] ${req.method} ${path}${action ? '?action=' + action : ''} → 501（UI 先行，未實作）`);
    return json(res, 501, {
      ok: false,
      error: 'backend-not-implemented',
      uiPhase: true,
      message: '旅系統而家係 UI 先行示範：/api 未實作，前端唔會當你成功。',
      requested: { method: req.method, path, action, unit: url.searchParams.get('unit') || url.searchParams.get('u') || '' },
      planned: 'POST/GET → /api/proxy → 旅 GAS /exec（server 側注入 apikey；前端、QR、URL 永不帶 key）',
      hint: '真模式落成之後，同一個路徑會回 { success, confirmed, data }；前端只認 confirmed:true。'
    });
  }

  /* ---------- 靜態檔 ---------- */
  let rel = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
  let abs = join(ROOT, normalize(rel));
  if (!abs.startsWith(ROOT)) return json(res, 403, { ok: false, error: 'forbidden' });

  try {
    let st = await stat(abs).catch(() => null);
    if (st?.isDirectory()) { abs = join(abs, 'index.html'); rel = join(rel, 'index.html'); st = await stat(abs).catch(() => null); }
    if (!st) {
      const fallback = await readFile(join(ROOT, 'index.html')).catch(() => null);
      if (fallback && !extname(rel)) {
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
        return res.end(fallback);
      }
      console.log(`[404] ${req.method} ${path}`);
      return json(res, 404, { ok: false, error: 'not-found', path });
    }
    const body = await readFile(abs);
    const type = MIME[extname(abs).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'content-length': body.length,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    });
    if (req.method === 'HEAD') return res.end();
    console.log(`[200] ${req.method} ${path} (${body.length}B, ${Date.now() - started}ms)`);
    return res.end(body);
  } catch (e) {
    console.error('[500]', e.message);
    return json(res, 500, { ok: false, error: 'server-error', message: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n旅系統 dev server（示範模式 · 零依賴）`);
  console.log(`→ http://localhost:${PORT}/          旅閘／登入／主介面`);
  console.log(`→ http://localhost:${PORT}/public.html  公開頁（免登入）`);
  console.log(`→ http://localhost:${PORT}/notice.html?n=n-1  通告分享連結示範`);
  console.log(`→ http://localhost:${PORT}/join.html?t=TROOP-COA-7F3A9C2E  邀請開戶示範（教練員）`);
  console.log(`→ http://localhost:${PORT}/borrow.html  物資借用（免登入）`);
  console.log(`\n示範帳號（密碼一律 demo1234，按旅閘身份分流入）：
  旅長／教練員  chief@demo.troop / coach@demo.troop
  家長          parent@demo.troop
  支部人員      cs-leader@demo.troop（團長）/ cs-deputy@demo.troop（副團長）
                vs-exec@demo.troop（執委·主席）/ vs-team@demo.troop（團隊長·18+）
                sc-cpl@demo.troop（副隊長·未夠 18）／sc-scout@demo.troop（團員·18+）
                ← 支部人員入之前要先揀團；登入後直接入自己支部（旅入口＝支部入口）
  超管（隱藏）  index.html?step=super  或旅閘撳 ⚜ 五下 → super@platform.local
  支部系統登入通道  旅長 → 支部 → 揀團 →「接駁與登記」→ 開／閂（閂咗＝支部系統唔可以自己登入）
  🆘 求救          入唔到 → index.html?step=rescue（免登入）→ 旅長「待辦與批核 → 🆘 求救」處理
                   開返支部系統登入／重設密碼／答覆並結案（示範：樂行團長求救、家長求救）`);
  console.log(`/api/* 現況（本機全部行真 handler，唔會扮成功）：\n  units／downstreams／auth／super／troop／registry／member-entry／share → api/*.js\n  proxy + action=issue          → 本機 sink（log 對正合同嘅 payload；唔會真送 ADMIN）\n  proxy + 其他 action            → 真 handler（要 session；未設 TROOP_<旅ID>_* env ＝ 503 not_configured）\n`);
});

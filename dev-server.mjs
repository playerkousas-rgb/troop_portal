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

  /* ---------- /api/*：後端唔存在（UI 先行） ---------- */
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
                sc-cpl@demo.troop（副隊長·未夠 18）   ← 入之前要先揀團
  超管（隱藏）  index.html?step=super  或旅閘撳 ⚜ 五下 → super@platform.local`);
  console.log(`/api/* 暫時回 501（UI 先行，後端未實作）\n`);
});

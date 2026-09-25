/* ============================================================
   router.js — hash 路由（#/路徑/參數）
   ============================================================ */

const routes = [];
export function route(pattern, handler) { routes.push({ parts: pattern.split('/').filter(Boolean), handler, pattern }); }

export function parse(hash = location.hash) {
  const raw = String(hash || '').replace(/^#\/?/, '').split('?')[0];
  const parts = raw.split('/').filter(Boolean);
  const query = {};
  const qi = String(hash).indexOf('?');
  if (qi >= 0) new URLSearchParams(String(hash).slice(qi + 1)).forEach((v, k) => { query[k] = v; });
  return { parts, query, path: parts.join('/') };
}

export function resolve(hash) {
  const { parts, query, path } = parse(hash);
  for (const r of routes) {
    if (r.parts.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < r.parts.length; i++) {
      const p = r.parts[i];
      if (p.startsWith(':')) { params[p.slice(1)] = decodeURIComponent(parts[i]); continue; }
      if (p !== parts[i]) { ok = false; break; }
    }
    if (ok) return { handler: r.handler, params, query, path };
  }
  return null;
}

export function go(path, { replace = false } = {}) {
  const h = '#/' + String(path || '').replace(/^#?\/?/, '');
  if (replace) location.replace(h); else location.hash = h;
}

export function currentPath() { return parse().path || 'dashboard'; }

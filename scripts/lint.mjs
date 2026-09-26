#!/usr/bin/env node
/* ============================================================
   lint.mjs — 零依賴靜態檢查（旅系統 · UI 先行）
   ------------------------------------------------------------
   檢查：
     1. 語法：所有 .js/.mjs ＋ 每個 HTML 嘅 inline module script
     2. 匯入圖：import 目標存在；named import 真係有 export（最易死嘅一類）
     3. 模組註冊表：id 唯一、欄位齊、圖示存在、角色有效、子頁前綴
     4. 導航／路由：registry ↔ main.js route() 對得上
     5. HTML：本機資源存在、有 viewport／title／lang、inline 引用嘅 id 存在
     6. 安全：冇金鑰值寫死、冇 localhost 寫死、冇 key 落 QR／URL
     7. 體積治理：dist-like 檔案總量 < 5MB、單檔 < 1.5MB
   ============================================================ */
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const notes = [];
const rel = p => relative(ROOT, p).replaceAll('\\', '/');
const fail = (what, detail = '') => fails.push(`${what}${detail ? ' — ' + detail : ''}`);

/* ---------- 1. 收集檔案 ---------- */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', '.vercel', 'docs', '.cache', 'coverage'].includes(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const all = walk(ROOT);
const jsFiles = all.filter(f => /\.(m?js)$/.test(f));
const htmlFiles = all.filter(f => f.endsWith('.html'));
const cssFiles = all.filter(f => f.endsWith('.css'));

/* ---------- 2. 語法檢查（含 HTML inline module script） ---------- */
const tmpFiles = [];
function checkSyntax(source, label) {
  const tmp = join(ROOT, `.lint-tmp-${tmpFiles.length}.mjs`);
  writeFileSync(tmp, source);
  tmpFiles.push(tmp);
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  if (r.status !== 0) fail(`語法錯誤：${label}`, (r.stderr || '').split('\n').slice(0, 4).join(' | '));
}
for (const f of jsFiles) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) fail(`語法錯誤：${rel(f)}`, (r.stderr || '').split('\n').slice(0, 4).join(' | '));
}
const htmlInline = new Map();     // html 檔 → inline script 源碼
for (const f of htmlFiles) {
  const src = readFileSync(f, 'utf8');
  const matches = [...src.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
  matches.forEach((m, i) => {
    const label = `${rel(f)} (inline #${i + 1})`;
    checkSyntax(m[1], label);
    htmlInline.set(`${rel(f)}#${i}`, m[1]);
  });
}

/* ---------- 3. 匯入圖 ---------- */
function exportsOf(src) {
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      if (t.includes(' as ')) names.add(t.split(/\s+as\s+/)[1].trim());
      else names.add(t.split(/\s+/)[0].trim());
    }
  }
  if (/export\s+default/.test(src)) names.add('default');
  return names;
}
const moduleCache = new Map();
function sourceOf(abs) {
  if (!moduleCache.has(abs)) moduleCache.set(abs, readFileSync(abs, 'utf8'));
  return moduleCache.get(abs);
}
function checkImports(abs, src, label) {
  for (const m of src.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const clause = m[1].trim();
    const spec = m[2];
    if (!spec.startsWith('.')) continue;              // 只檢查本機相對路徑
    const target = join(dirname(abs), spec);
    if (!existsSync(target)) { fail(`匯入目標唔存在：${label}`, spec); continue; }
    const tsrc = sourceOf(target);
    const ex = exportsOf(tsrc);
    const brace = clause.match(/\{([\s\S]*)\}/);
    if (brace) {
      for (const part of brace[1].split(',')) {
        const t = part.trim();
        if (!t) continue;
        const name = (t.includes(' as ') ? t.split(/\s+as\s+/)[0] : t).trim();
        if (!ex.has(name)) fail(`import 咗唔存在嘅 export：${label}`, `{ ${name} } ← ${rel(target)}`);
      }
    }
    if (/^[A-Za-z0-9_$]+\s*,/.test(clause) && !ex.has('default')) fail(`import 咗唔存在嘅 default：${label}`, rel(target));
  }
}
for (const f of jsFiles) checkImports(f, readFileSync(f, 'utf8'), rel(f));
for (const [label, src] of htmlInline) checkImports(join(ROOT, label.split('#')[0]), src, label);

/* ---------- 4. 註冊表／路由 ---------- */
const registry = await import('../assets/js/lib/registry.js');
const utilSrc = readFileSync(join(ROOT, 'assets/js/lib/util.js'), 'utf8');
const iconsBlock = utilSrc.slice(utilSrc.indexOf('const ICONS'), utilSrc.indexOf('export function icon'));
const ICONS = new Set([...iconsBlock.matchAll(/^\s{2}([A-Za-z]+):/gm)].map(m => m[1]));

const seen = new Set();
const validRoles = new Set(['chief', 'coach', 'parent', 'member', 'guest', 'super']);
for (const m of registry.MODULES) {
  if (seen.has(m.id)) fail('模組 id 重複', m.id);
  seen.add(m.id);
  for (const k of ['label', 'icon', 'group', 'tier', 'desc']) if (!m[k]) fail(`模組 ${m.id} 缺 ${k}`);
  if (!registry.GROUPS[m.group]) fail(`模組 ${m.id} group 唔存在`, m.group);
  if (!['P0', 'P1', 'P2', 'P3'].includes(m.tier)) fail(`模組 ${m.id} tier 唔啱`, m.tier);
  if (typeof m.order !== 'number') fail(`模組 ${m.id} 缺 order`);
  if (!ICONS.has(m.icon)) fail(`模組 ${m.id} 圖示唔存在`, m.icon);
  if (!Array.isArray(m.roles) || !m.roles.length) fail(`模組 ${m.id} 冇 roles`);
  else for (const r of m.roles) if (!validRoles.has(r)) fail(`模組 ${m.id} 角色唔啱`, r);
  if (m.badge !== undefined && typeof m.badge !== 'function') fail(`模組 ${m.id} badge 唔係 function`);
  for (const s of m.subs || []) {
    if (!s.id?.startsWith(m.id + '-')) fail(`模組 ${m.id} 子頁前綴唔啱`, s.id);
    if (!s.label) fail(`模組 ${m.id} 子頁缺 label`, s.id);
  }
}

const mainSrc = readFileSync(join(ROOT, 'assets/js/main.js'), 'utf8');
const routes = [...mainSrc.matchAll(/route\(\s*'([^']+)'/g)].map(m => m[1]);
const alias = { branch: 'branches', notice: 'notices' };
for (const m of registry.MODULES) {
  if (!routes.includes(m.id)) fail(`registry 有模組但 main.js 冇 route`, m.id);
}
for (const r of routes) {
  const head = r.split('/')[0];
  const target = alias[head] || head;
  if (!registry.MODULES.some(m => m.id === target)) fail(`main.js route 對唔上 registry`, r);
}
for (const f of readdirSync(join(ROOT, 'assets/js/views'))) {
  const abs = join(ROOT, 'assets/js/views', f);
  const src = readFileSync(abs, 'utf8');
  const id = f.replace('.js', '');
  if (id === 'ui') continue;                          // 共用元件唔係模組、冇 render
  if (!/export\s+function\s+render/.test(src)) fail(`view 冇 export render`, f);
  if (!mainSrc.includes(`./views/${f}`)) fail(`view 冇被 main.js 引入`, f);
  if (!registry.MODULES.some(m => m.id === id)) fail(`view 對唔上 registry 模組`, f);
}

/* ---------- 5. HTML 檢查 ---------- */
for (const f of htmlFiles) {
  const src = readFileSync(f, 'utf8');
  const label = rel(f);
  if (!/lang="zh-Hant"/.test(src)) fail(`${label} 缺 lang="zh-Hant"`);
  if (!/<title>[^<]{2,}<\/title>/.test(src)) fail(`${label} 缺 title`);
  if (!/name="viewport"/.test(src)) fail(`${label} 缺 viewport`);
  for (const m of src.matchAll(/(?:src|href)="((?!https?:|data:|#|mailto:)[^"]+)"/g)) {
    if (m[1].includes('${')) continue;               // inline script 嘅模板字串，唔係靜態連結
    const p = m[1].split('?')[0];
    if (!existsSync(join(ROOT, p))) fail(`${label} 引用咗唔存在嘅本機檔案`, m[1]);
  }
  // inline script 引用嘅 element id 要真係有（getElementById('x') → id="x"）
  for (const [key, inline] of htmlInline) {
    if (!key.startsWith(label + '#')) continue;
    for (const m of inline.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)) {
      if (!src.includes(`id="${m[1]}"`)) fail(`${label} inline script 引用咗唔存在嘅 id`, m[1]);
    }
  }
}

/* ---------- 5b. CSS：用到嘅 class 要真係有定義（防「寫咗但冇樣」） ---------- */
{
  const css = cssFiles.map(f => readFileSync(f, 'utf8')).join('\n');
  const defined = new Set([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map(m => m[1]));
  const used = new Map();
  const scan = (src, label) => {
    const cleaned = src.replace(/\$\{[^}]*\}/g, ' ');     // 去掉模板插值，只睇靜態 class
    for (const m of cleaned.matchAll(/class="([^"]*)"/g)) {
      for (const c of m[1].split(/\s+/)) {
        if (!c) continue;
        if (!used.has(c)) used.set(c, label);
      }
    }
  };
  for (const f of htmlFiles) scan(readFileSync(f, 'utf8'), rel(f));
  for (const f of jsFiles.filter(f => rel(f).startsWith('assets/js'))) scan(readFileSync(f, 'utf8'), rel(f));
  const allow = new Set(['on', 'off', 'wide', 'collapsed', 'hide', 'demo', 'num', 'nowrap']);
  const miss = [...used.keys()].filter(c => !defined.has(c) && !allow.has(c));
  if (miss.length) fail('CSS 冇定義但畫面用到嘅 class', miss.slice(0, 12).map(c => `${c}（${used.get(c)}）`).join('、'));
}

/* ---------- 6. 安全／死規矩 ---------- */
const secretish = /(APIKEY|API_KEY|SUPER_KEY|apikey)\s*[:=]\s*['"][A-Za-z0-9_\-]{12,}['"]/;
// 只查瀏覽器會收到嘅嘢（assets/** ＋ root *.html）；scripts/、dev-server.mjs 係 Node 側
const frontFacing = [...jsFiles, ...cssFiles, ...htmlFiles].filter(f => {
  const r = rel(f);
  return r.startsWith('assets/') || (!r.includes('/') && r.endsWith('.html'));
});
for (const f of frontFacing) {
  const src = readFileSync(f, 'utf8');
  if (secretish.test(src)) fail(`可能寫死咗金鑰：${rel(f)}`);
  if (/https?:\/\/(localhost|127\.0\.0\.1)/.test(src)) fail(`寫死 localhost：${rel(f)}`);
  if (/\b(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,})\b/.test(src)) fail(`疑似 token：${rel(f)}`);
}
// QR 唔可以帶 key
for (const f of jsFiles.filter(f => f.includes('views/') || f.endsWith('.html'))) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/qrSvg\(([^,)]+)/g)) {
    if (/key|apikey|APIKEY|token\b/i.test(m[1]) && !/inviteUrl|location\.href|shareUrl|url/i.test(m[1])) fail(`QR 可能帶咗 key：${rel(f)}`, m[1].slice(0, 60));
  }
}
// 死規矩：唔可以有 callback endpoint／定時器 提示
//  例外：`// lint-allow: timer` 標明用途嘅**單一**定時器（現時只有 auth.js 嘅 session 靜默續期）——
//  前端唔應該做自動化，但 session 到期係一定要自己排程，唔可以靠用戶記住。
const forbidden = [/setInterval\s*\(/, /new\s+Trigger\s*\(/, /onEdit\s*\(/];
const allowTimer = src => {
  const lines = src.split('\n').filter((l, i, a) => !(a[i - 1] || '').includes('lint-allow: timer') && !l.includes('lint-allow: timer'));
  return lines.join('\n');
};
for (const f of jsFiles.filter(f => f.includes('assets/js'))) {
  const raw = readFileSync(f, 'utf8');
  const src = allowTimer(raw);
  for (const re of forbidden) if (re.test(src)) fail(`前端唔應該出現定時器／觸發器：${rel(f)}`, String(re));
}

/* ---------- 7. 體積治理 ---------- */
let total = 0, biggest = ['', 0];
for (const f of [...jsFiles, ...cssFiles, ...htmlFiles, ...all.filter(f => f.includes('assets/vendor'))]) {
  const s = statSync(f).size;
  total += s;
  if (s > biggest[1]) biggest = [rel(f), s];
  if (s > 1.5 * 1024 * 1024) fail(`單檔過大（>1.5MB）：${rel(f)}`, (s / 1024).toFixed(0) + ' KB');
}
if (total > 5 * 1024 * 1024) fail('總體積超過 5MB', (total / 1024 / 1024).toFixed(2) + ' MB');

/* ---------- 清理臨時檔 ---------- */
for (const t of tmpFiles) { try { unlinkSync(t); } catch {} }

/* ---------- 報告 ---------- */
const counts = {
  檔案: new Set([...jsFiles, ...htmlFiles, ...cssFiles]).size,
  模組: registry.MODULES.length,
  路由: routes.length,
  內聯腳本: htmlInline.size
};
console.log(`\n旅系統 lint — ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
console.log(`體積：${(total / 1024).toFixed(0)} KB（最大：${biggest[0]} ${(biggest[1] / 1024).toFixed(0)} KB）`);
for (const n of notes) console.log(`  · ${n}`);
if (fails.length) {
  console.log(`\n✗ ${fails.length} 個問題：`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('\n✓ 全部檢查通過\n');

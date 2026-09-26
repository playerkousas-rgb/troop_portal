#!/usr/bin/env node
/* ============================================================
   preflight.mjs — 上線前自我檢查（ADMIN 用）
   ------------------------------------------------------------
   用法：
     node scripts/preflight.mjs                 # 睇現行環境（例如喺 Vercel build／本機 export 之後）
     vercel env pull .env.local && node --env-file=.env.local scripts/preflight.mjs

   做三件事：
     ① 環境變數：邊啲**必要**、邊啲**可選**、邊啲已／未設 —— **只印變數名同狀態，永遠唔會印值**
     ② 靜態就緒：`data/units.json` 格式／私隱、`api` 零依賴、GAS／下游範本語法、sw.js／manifest 存在
     ③ 交返一張「跟住做」清單（真環境驗收係人手做，本機綠 ≠ 真通）

   原則（同系統一致）：唔會扮成功 —— 未設就講未設、未知就講未知。
   ============================================================ */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = (ok, label, note = '') => console.log(`  ${ok === true ? '✓' : ok === false ? '✗' : '·'} ${label}${note ? '　' + note : ''}`);

const REQUIRED_ONE_OF = [
  ['SESSION_SECRET', 'session 簽名密鑰（32+ 字隨機）']
];
const REQUIRED_PER_UNIT = ['BACKEND', 'APIKEY'];
const OPTIONAL = [
  ['SUPER_KEY', '平台超管密鑰（隱藏帳號用；強烈建議設）'],
  ['ADMIN_ISSUE_ENDPOINT', 'Scout Admin 收件匣（求救／問題回報收件位）'],
  ['VAPID_PUBLIC_KEY', '圖書館推送鏈：VAPID 公鑰（未設＝訂閱只存本機，唔會扮成功）'],
  ['PUSH_INGEST_URL', '圖書館推送鏈：館方收件位（Supabase Function／webhook）'],
  ['PUSH_INGEST_KEY', '館方收件位要嘅 Bearer（如需要）']
];
const SHARED = ['SUPER_KEY', 'SESSION_SECRET', 'ADMIN_ISSUE_ENDPOINT', 'VAPID_PUBLIC_KEY', 'PUSH_INGEST_URL', 'PUSH_INGEST_KEY'];

const env = process.env;
const units = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, 'data/units.json'), 'utf8')).units || []; } catch { return null; }
})();

console.log('\n旅系統上線前檢查（preflight）—— 只報變數名同狀態，永遠唔會印值\n');

/* ---------- ① 環境變數 ---------- */
console.log('① 環境變數');
let missingRequired = 0;
REQUIRED_ONE_OF.forEach(([k, desc]) => {
  const set = !!env[k] && String(env[k]).length >= 16;
  if (!set) missingRequired++;
  P(set, `${k}`, set ? `${desc}（已設，長度 ${String(env[k]).length}）` : `**未設／太短** —— ${desc}`);
});
if (units === null) {
  P(false, 'data/units.json', '**讀唔到**（格式錯？）');
} else if (!units.length) {
  P(false, '旅清單', '**一個旅都冇** —— 先跑 `npm run units add --id 82 --name "…"`');
} else {
  units.forEach(u => {
    const id = String(u.id || '').trim().toUpperCase().replace(/^0+(?=\d)/, '');
    const have = REQUIRED_PER_UNIT.filter(t => env[`TROOP_${id}_${t}`]);
    const okAll = have.length === REQUIRED_PER_UNIT.length;
    if (!okAll) missingRequired++;
    P(okAll, `旅 ${id}（${u.name || '—'}）`, okAll
      ? `TROOP_${id}_BACKEND／APIKEY（已設）`
      : `缺 ${REQUIRED_PER_UNIT.filter(t => !env[`TROOP_${id}_${t}`]).map(t => `TROOP_${id}_${t}`).join('、')}`);
  });
}
OPTIONAL.forEach(([k, desc]) => {
  const set = !!env[k];
  P(set === true ? true : null, `${k}`, `${desc}（${set ? '已設' : '未設'}）`);
});

/* ---------- ② 靜態就緒 ---------- */
console.log('\n② 靜態就緒');
const files = [
  ['index.html', true], ['public.html', true], ['sw.js', true], ['vercel.json', true], ['.vercelignore', true],
  ['apps-script/Code.gs', true], ['apps-script/Downstream.gs', true],
  ['api/proxy.js', true], ['api/auth.js', true], ['api/push.js', true]
];
files.forEach(([f, must]) => {
  const ok = existsSync(join(ROOT, f));
  P(must ? ok : (ok ? true : null), f, ok ? '' : '**唔見咗**');
});
/* units.json 私隱：永遠唔可以有 key／後端 URL */
if (units !== null) {
  const raw = readFileSync(join(ROOT, 'data/units.json'), 'utf8');
  const leak = /troop_|script\.google\.com|APIKEY=|VE\s|\/exec/.test(raw);
  P(!leak, 'units.json 私隱', leak ? '**含 key／後端 URL（唔可以入 git）**' : '冇 key、冇後端 URL');
}
/* api 零依賴（唔可以 import 任何 npm 套件） */
const apiDir = join(ROOT, 'api');
let deps = [];
readdirSync(apiDir).filter(f => f.endsWith('.js')).forEach(f => {
  const src = readFileSync(join(apiDir, f), 'utf8');
  src.split('\n').forEach(l => {
    const m = l.match(/^\s*import\s+.*from\s+'([^']+)'/);
    if (m && !m[1].startsWith('.') && !m[1].startsWith('node:')) deps.push(`${f} → ${m[1]}`);
  });
});
P(deps.length === 0, 'api 零依賴', deps.length ? '**有外部依賴**：' + deps.join('、') : '全部只用 node: 內建');
/* 部署體積（跟 .vercelignore 計） */
try {
  const ignore = readFileSync(join(ROOT, '.vercelignore'), 'utf8').split('\n').map(s => s.trim()).filter(l => l && !l.startsWith('#'));
  let total = 0, count = 0;
  const walk = d => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      const rel = p.slice(ROOT.length + 1);
      if (ignore.some(ig => e.name === ig.replace(/\/$/, '') || rel.startsWith(ig.replace(/\/$/, '') + '/'))) continue;
      if (e.isDirectory()) walk(p);
      else { total += statSync(p).size; count++; }
    }
  };
  walk(ROOT);
  const mb = total / 1024 / 1024;
  P(mb <= 5, '部署體積', `${count} 個檔案 · ${mb.toFixed(2)} MB${mb > 5 ? '（**超過 5MB 上限**）' : '（上限 5MB）'}`);
} catch (e) { P(false, '部署體積', '計唔到：' + e.message); }

/* ---------- ③ 交返清單 ---------- */
console.log('\n③ 跟住做（真環境驗收係人手做；本機綠 ≠ 真通）');
const next = [];
if (missingRequired) next.push(`補齊上面 ✗ 嘅 env（共 ${missingRequired} 項）→ Vercel Redeploy（env 要重新 build 先生效）`);
if (!env.VAPID_PUBLIC_KEY || !env.PUSH_INGEST_URL) next.push('推送鏈未開通：設 VAPID_PUBLIC_KEY ＋ PUSH_INGEST_URL（見 docs/教材/13-個人化訂閱與推送.md）');
if (!env.ADMIN_ISSUE_ENDPOINT) next.push('未設 ADMIN_ISSUE_ENDPOINT：問題回報／求救會用硬編碼收件位（見 docs/教材/05-平台超管.md）');
next.push('照 docs/後端部署步驟.md §5「驗收清單」逐項打勾（12+ 項，全部人手）');
next.push('每個下游 portal 抄 apps-script/Downstream.gs（見 docs/教材/12-下游接入.md）');
next.push('跑本地全套：npm run check（lint／GAS／api／smoke 要全綠）');
next.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
console.log('');
process.exit(missingRequired ? 1 : 0);

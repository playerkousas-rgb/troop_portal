#!/usr/bin/env node
/* ============================================================
   units.mjs — 平台 registry 工具（`data/units.json` ＋ Vercel env 清單）
   ------------------------------------------------------------
   BUILD §7 嘅 admin 流程：「核對（ping/status）→ units.json 加公開 entry ＋ Vercel env → Redeploy → 通知」。
   呢支就係嗰步嘅工具（唔使手改 JSON，減少打錯旅 ID）。

   用法：
     node scripts/units.mjs list
     node scripts/units.mjs add --id 82 --name "第八十二旅" --district 香港 --branches 5
     node scripts/units.mjs rm  --id 82
     node scripts/units.mjs env --id 82            # 印 Vercel env（值要你自己填，唔會入 git）
     node scripts/units.mjs check                  # 驗格式（旅 ID／重複／必填）
   ============================================================ */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'data/units.json');

const read = () => JSON.parse(readFileSync(FILE, 'utf8'));
const write = o => writeFileSync(FILE, JSON.stringify(o, null, 2) + '\n');
const arg = (name, def = '') => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
/** 旅 ID：1–4 位數字（前面可以補零）；儲存一律用唔補零嘅短格式 */
export const normUnit = v => String(v || '').trim().toUpperCase().replace(/^0+(?=\d)/, '');
export function checkUnit(u, all = []) {
  const errs = [];
  if (!/^[0-9A-Z]{1,4}$/.test(normUnit(u.id))) errs.push(`旅 ID 唔啱：${u.id}（要 1–4 位數字／大寫字母）`);
  if (!u.name) errs.push('要旅名');
  if (all.filter(x => normUnit(x.id) === normUnit(u.id)).length > 1) errs.push(`旅 ID 重複：${u.id}`);
  if (u.branches !== undefined && (!Number.isInteger(Number(u.branches)) || Number(u.branches) < 0)) errs.push('branches 要係 0 或以上整數');
  return errs;
}
export function envLines(unit) {
  const id = normUnit(unit);
  return [
    `TROOP_${id}_BACKEND=https://script.google.com/macros/s/（貼你嘅部署 ID）/exec`,
    `TROOP_${id}_APIKEY=troop_（GAS 選單「🔑 顯示 BACKEND／APIKEY」）`,
    `# 另外全平台共用（唔關旅 ID 事）：SESSION_SECRET／SUPER_KEY／SHARE_SECRET`,
    `# 可選：ADMIN_ISSUE_ENDPOINT（Scout Admin 收件箱；唔設＝用預設）`
  ];
}

const cmd = process.argv[2] || 'list';
const file = read();

if (cmd === 'list') {
  console.log(`data/units.json — ${file.units.length} 個旅`);
  file.units.forEach(u => console.log(`  ${String(u.id).padEnd(4)} ${u.name}${u.district ? '（' + u.district + '）' : ''} · ${u.branches ?? '?'} 個支部`));
  console.log('\n⚠️ BACKEND／APIKEY 永遠唔會入呢個檔（住 Vercel env）：node scripts/units.mjs env --id <旅ID>');
} else if (cmd === 'add' || cmd === 'update') {
  const u = { id: normUnit(arg('id')), name: arg('name'), nameEn: arg('nameen', ''), district: arg('district', ''), branches: arg('branches') ? Number(arg('branches')) : undefined };
  const others = file.units.filter(x => normUnit(x.id) !== u.id);
  const errs = checkUnit(u, [...others, u]);
  if (errs.length) { console.error('✗ ' + errs.join('\n✗ ')); process.exit(1); }
  const merged = { ...(cmd === 'update' ? (file.units.find(x => normUnit(x.id) === u.id) || {}) : {}), ...Object.fromEntries(Object.entries(u).filter(([, v]) => v !== undefined)) };
  write({ ...file, units: [...others, merged].sort((a, b) => normUnit(a.id).localeCompare(normUnit(b.id), undefined, { numeric: true })) });
  console.log(`✓ ${cmd === 'add' ? '加咗' : '更新咗'}：${merged.id} ${merged.name}`);
  console.log('\n跟住：');
  console.log(envLines(u.id).map(l => '  ' + l).join('\n'));
  console.log('  → Vercel Redeploy → 通知申請人（清單見 docs/教材/08-開旅-checklist.md）');
} else if (cmd === 'rm') {
  const id = normUnit(arg('id'));
  const left = file.units.filter(x => normUnit(x.id) !== id);
  if (left.length === file.units.length) { console.error('✗ 搵唔到：' + id); process.exit(1); }
  write({ ...file, units: left });
  console.log(`✓ 移除咗 ${id}（記住：Vercel env 要自己清；旅 SHEET 唔會郁）`);
} else if (cmd === 'env') {
  const id = normUnit(arg('id'));
  if (!id) { console.error('✗ 要 --id'); process.exit(1); }
  console.log(envLines(id).join('\n'));
} else if (cmd === 'check') {
  let bad = 0;
  file.units.forEach(u => { const e = checkUnit(u, file.units); if (e.length) { bad++; console.log(`✗ ${u.id}: ${e.join('；')}`); } });
  /* 死規矩：**每個旅嘅 entry** 永遠唔可以出現敏感值（note 欄可以講「唔好放 key」） */
  const dump = JSON.stringify(file.units);
  ['troop_', 'APIKEY', 'BACKEND', '/exec', 'SESSION_SECRET', 'SUPER_KEY'].forEach(k => {
    if (dump.includes(k)) { bad++; console.log(`✗ data/units.json 出現疑似敏感字：${k}`); }
  });
  console.log(bad ? `\n✗ ${bad} 個問題` : `\n✓ ${file.units.length} 個旅，格式同私隱檢查都過（冇 key／URL 入咗檔）`);
  if (bad) process.exit(1);
} else {
  console.error('用法：list | add | update | rm | env | check（--id --name --district --branches）');
  process.exit(1);
}

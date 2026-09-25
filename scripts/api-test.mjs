#!/usr/bin/env node
/* ============================================================
   api-test.mjs — 驗 `/api/*`（Vercel functions）嘅核心邏輯
   ------------------------------------------------------------
   重點：PBKDF2 ≥100k、timing-safe、session（HS256）防篡改／過期、
        票據（AES-GCM）防重放／綁旅／60 秒、proxy 白名單／apikey 唔外洩、
        downstreams 只回公開欄位、units 診斷只列變數名。
   真部署之後仍然要喺 Vercel 上人手試一次真登入。
   ============================================================ */
import { createHash } from 'node:crypto';

let pass = 0; const fails = [];
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fails.push({ name, e }); console.log('  ✗ ' + name + '\n      ' + e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assert failed'); };
const eq = (a, b, m) => assert(a === b, `${m || 'eq'}（got ${JSON.stringify(a)}，want ${JSON.stringify(b)}）`);

const auth = await import('../api/auth.js');
const superApi = await import('../api/super.js');
const proxy = await import('../api/proxy.js');
const downs = await import('../api/downstreams.js');
const unitsApi = await import('../api/units.js');

console.log('\n旅 /api 測試（本機；真 Vercel 上仍要人手試一次真登入）');

/* ① 密碼：PBKDF2 ≥100k ＋ timing-safe */
t('密碼：PBKDF2-SHA256 100,000 次 ＋ per-user salt（同一個密碼兩次 hash 唔同）', () => {
  const a = auth.hashPassword('demo1234');
  const b = auth.hashPassword('demo1234');
  eq(a.algo, 'pbkdf2-sha256'); eq(a.iter, 100000);
  eq(a.hash.length, 64, 'hash 要 32 bytes hex');
  assert(a.salt !== b.salt && a.hash !== b.hash, 'salt 要每次唔同');
  assert(auth.verifyPassword('demo1234', a) === true, '正確密碼要驗到');
  assert(auth.verifyPassword('demo12345', a) === false, '錯密碼要驗唔到');
  assert(auth.verifyPassword('demo1234', { ...a, hash: 'x'.repeat(64) }) === false, '亂 hash 要唔爆又要唔通');
});
t('密碼：唔會用弱算法（原始碼層面釘死）', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../api/auth.js', import.meta.url), 'utf8');
  assert(/pbkdf2Sync/.test(src) && /timingSafeEqual/.test(src), '要 pbkdf2 ＋ timing-safe');
  assert(!/createHash\('sha256'\)\.update\(password/.test(src), '唔可以用單次 SHA-256 做密碼');
  assert(!/password\s*===\s*/.test(src), '唔可以直接比對明文');
});

/* ② session */
t('session：HS256 簽名；改 payload／換 secret／過期一律唔通', () => {
  const tok = auth.signSession({ email: 'a@b.c', role: 'chief', unit: '82' }, 'S1');
  const ok = auth.verifySession(tok, 'S1');
  assert(ok && ok.email === 'a@b.c', '正常 token 要通');
  assert(auth.verifySession(tok, 'S2') === null, '換 secret 要唔通');
  const [h, p, s] = tok.split('.');
  const tampered = h + '.' + Buffer.from(JSON.stringify({ email: 'hacker@x.y', role: 'chief', unit: '82', exp: Date.now() + 99999 })).toString('base64url') + '.' + s;
  assert(auth.verifySession(tampered, 'S1') === null, '改 payload 要唔通');
  const expired = auth.signSession({ email: 'a@b.c' }, 'S1', -1000);
  assert(auth.verifySession(expired, 'S1') === null, '過期要唔通');
  assert(auth.verifySession('x.y.z', 'S1') === null, '亂 token 要唔通');
});

/* ③ 票據（中央登入） */
t('票據：AES-256-GCM；60 秒、綁旅、一次性（重放即拒）', () => {
  const key = 'super-key-test';
  const seen = new Map();
  const tk = superApi.makeTicket({ unit: '82', email: 'chief@demo.hk', role: 'chief', exp: Date.now() + 60000, nonce: 'n1' }, key);
  const r1 = superApi.openTicket(tk, key, { unit: '82', seen });
  assert(r1.ok && r1.data.email === 'chief@demo.hk', '正常票據要通：' + JSON.stringify(r1));
  const r2 = superApi.openTicket(tk, key, { unit: '82', seen });
  assert(r2.ok === false && /用過/.test(r2.error), '重放要拒');
  const tk2 = superApi.makeTicket({ unit: '82', email: 'a@b.c', exp: Date.now() + 60000, nonce: 'n2' }, key);
  const r3 = superApi.openTicket(tk2, key, { unit: '99', seen });
  assert(r3.ok === false && /綁定旅/.test(r3.error), '換旅要拒');
  const tk3 = superApi.makeTicket({ unit: '82', email: 'a@b.c', exp: Date.now() - 1000, nonce: 'n3' }, key);
  const r4 = superApi.openTicket(tk3, key, { unit: '82', seen });
  assert(r4.ok === false && /過期/.test(r4.error), '過期要拒');
  const r5 = superApi.openTicket(tk, 'wrong-key', { unit: '82', seen: new Map() });
  assert(r5.ok === false, '換 key 要拒（簽章）');
  const r6 = superApi.openTicket('v1.a.b.c', key, { unit: '82', seen: new Map() });
  assert(r6.ok === false, '亂票據要拒');
});

/* ④ 問題回報合約（前端／後端一套） */
t('問題回報：proxy 同前端同一套白名單（8 欄、severity fallback）', () => {
  const p = proxy.buildIssuePayload({ title: ' t ', desc: ' d ', severity: '亂', troopId: '82', name: 'n', contact: 'c' });
  eq(Object.keys(p).sort().join(','), 'contact,desc,name,severity,sourceApp,title,troopId,type');
  eq(p.severity, '高'); eq(p.sourceApp, 'troop_portal'); eq(p.type, 'issue');
});

/* ⑤ proxy：GAS 白名單 + 唔外洩 apikey */
t('proxy：GAS action 白名單存在；唔喺白名單／未設定 env → 誠實失敗', () => {
  assert(proxy.GAS_WHITELIST.includes('load') && proxy.GAS_WHITELIST.includes('saveTables'), '白名單唔齊');
  assert(!proxy.GAS_WHITELIST.includes('exportAll') && !proxy.GAS_WHITELIST.includes('importAll'), 'exportAll／importAll 唔應該開放俾前端');
  assert(!proxy.GAS_WHITELIST.includes('login'), 'login 屬 /api/auth，唔應該經 proxy');
});
t('proxy：apikey 只喺 server 側（原始碼掃描）', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../api/proxy.js', import.meta.url), 'utf8');
  assert(/process\.env\[`TROOP_\$\{unit\}_APIKEY`\]/.test(src), 'apikey 應該只由 env 讀');
  assert(!/apikey\s*[:=]\s*['"][A-Za-z0-9_-]{12,}['"]/.test(src), '唔應該有寫死 apikey');
  assert(/must_change_pw/.test(src), 'mustChangePw 要傳去前端（403）');
});

/* ⑥ downstreams：只回公開欄位 */
t('downstreams：URL／KEY／purpose 一律唔會出現喺回應', () => {
  const out = downs.publicParts([{ id: 'vs0082', name: '深資', url: 'https://x/exec', key: 'troop_secret', purpose: 'vsbadge-troop-sig-v1', api: 'v1', linked: true }]);
  const dump = JSON.stringify(out);
  assert(!dump.includes('/exec') && !dump.includes('troop_secret') && !dump.includes('purpose') && !dump.includes('vsbadge'), '外洩：' + dump);
  eq(out[0].name, '深資'); eq(out[0].linked, true);
});

/* ⑦ units：診斷只列變數名（冇值） */
t('units：公開清單 + 診斷只列變數名（永遠冇值）', () => {
  process.env.TROOP_82_BACKEND = 'https://script.google.com/macros/s/FAKE/exec';
  process.env.TROOP_82_APIKEY = 'troop_supersecret_should_not_leak';
  const file = unitsApi.loadUnits(process.cwd());
  const fakeRes = () => ({ setHeader() {}, end(b) { this.body = JSON.parse(b); } });
  const r = fakeRes();
  unitsApi.default({ method: 'GET', url: '/api/units?diag=1' }, r);
  const dump = JSON.stringify(r.body);
  assert(!dump.includes('troop_supersecret_should_not_leak'), '診斷外洩 apikey 值');
  assert(dump.includes('TROOP_82_BACKEND'), '診斷要列變數名');
  const unit = file.units[0];
  assert(unit && unit.id === '82', 'data/units.json 要有一條旅');
});

/* ⑧ 冇明文密碼落 log／錯誤訊息 */
t('唔會把密碼寫入回應或 log（原始碼掃描）', async () => {
  const fs = await import('node:fs');
  ['../api/auth.js', '../api/proxy.js', '../api/super.js', '../apps-script/Code.gs'].forEach(f => {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    assert(!/console\.log\([^)]*password/i.test(src), f + ' 疑似 log 密碼');
    assert(!/JSON\.stringify\(\s*\{[^}]*password\s*:/.test(src), f + ' 疑似回應帶密碼');
  });
});

console.log('');
if (fails.length) {
  console.log(`✗ 旅 /api 測試唔過：${pass}/${pass + fails.length}\n`);
  fails.forEach(f => console.log(`  ✗ ${f.name}\n     ${f.e.message}`));
  process.exit(1);
}
console.log(`✓ 旅 /api 測試全部通過（${pass} 項）`);

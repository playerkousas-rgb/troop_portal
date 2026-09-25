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
t('proxy：破壞性 action 只有旅長做得（deleteRow／saveDbPart／purgeTombstones）', () => {
  ['deleteRow', 'saveDbPart', 'purgeTombstones'].forEach(a => assert(proxy.CHIEF_ONLY.includes(a), `${a} 應該係旅長專用`));
  ['testDownstream', 'openAccountForDownstream'].forEach(a => assert(proxy.LEADER_ACTIONS.includes(a), `${a} 應該係旅長／教練員`));
  ['resetPassword', 'deleteUser', 'setUserStatus', 'upsertUser'].forEach(a => assert(proxy.CHIEF_ONLY.includes(a), `${a} 應該係旅長專用`));
  assert(proxy.GAS_WHITELIST.includes('getTombstones') && !proxy.GAS_WHITELIST.includes('exportAll'), '墓碑讀得、匯出唔可以經前端');
});
t('proxy：匿名可寫面（免 session）＋唔准帶內部欄位', () => {
  ['saveRescue', 'noticeSignup', 'borrowApply', 'financeApply', 'progressApply', 'accountApply'].forEach(a => {
    assert(proxy.ANON_GAS.includes(a), `${a} 應該係匿名可寫面（BUILD §3）`);
  });
  assert(!proxy.ANON_GAS.includes('saveTables') && !proxy.ANON_GAS.includes('decideApplication'), '內部寫入／批核唔可以匿名');
  ['state', 'decidedBy', 'perms', 'role', 'hash', 'apikey'].forEach(k => {
    assert(proxy.ANON_FORBID.includes(k), `匿名路徑要擋住欄位：${k}`);
  });
});
t('session：靜默刷新（滑動 30 分鐘、上限 8 小時、改 cookie 都冇用）', async () => {
  const secret = 'test-secret-' + 'x'.repeat(20);
  process.env.SESSION_SECRET = secret;
  const call = async (cookie, body) => {
    let out = null, headers = null;
    const res = { setHeader(k, v) { headers = { ...(headers || {}), [k]: v }; }, statusCode: 0, end(t) { out = JSON.parse(t); } };
    await auth.default({ method: 'POST', url: '/api/auth', headers: { cookie }, body }, res);
    return { code: res.statusCode, body: out, headers };
  };
  const mk = (extra = {}) => auth.signSession({ email: 'a@b.c', role: 'chief', unit: '82', pv: 1, born: Date.now(), ...extra }, secret);
  /* 有效 session → 換一張新飛，exp 要延長，同埋要帶住 born（唔可以無限續） */
  const tok = mk();
  const r1 = await call(`troop_session=${tok}`, { action: 'refresh' });
  eq(r1.code, 200, '有效 session 應該續到');
  assert(r1.body.data.exp > Date.now() + 20 * 60 * 1000, '新 exp 要接近 30 分鐘');
  assert(String(r1.headers['Set-Cookie']).includes('troop_exp='), '要一齊發讀得嘅 troop_exp（前端排程）');
  assert(String(r1.headers['Set-Cookie']).includes('HttpOnly'), '真飛要 HttpOnly');
  const born = JSON.parse(Buffer.from(r1.headers['Set-Cookie'][0].split('.')[1], 'base64url').toString('utf8')).born;
  assert(born && Math.abs(born - Date.now()) < 5000, 'born 要保留落去（8 小時上限靠佢）');
  /* 8 小時上限：扮一個 born 喺 8 小時前嘅飛 → 唔可以續，要重新登入 */
  const oldTok = mk({ born: Date.now() - 9 * 60 * 60 * 1000 });
  const r2 = await call(`troop_session=${oldTok}`, { action: 'refresh' });
  eq(r2.code, 401, '過咗 8 小時唔可以再續');
  eq(r2.body.code, 'reauth_required', '要明確叫重新登入（前端會提示）');
  assert(String(r2.headers['Set-Cookie']).includes('Max-Age=0'), '要清 cookie');
  /* 過期／亂改嘅飛 → 401，唔會續 */
  const expired = auth.signSession({ email: 'a@b.c', role: 'chief', unit: '82', pv: 1, born: Date.now() - 1000 }, secret, -1000);
  eq((await call(`troop_session=${expired}`, { action: 'refresh' })).code, 401, '過期飛唔可以續');
  eq((await call(`troop_session=${tok.slice(0, -3)}abc`, { action: 'refresh' })).code, 401, '改過簽名唔可以續');
  eq((await call('', { action: 'refresh' })).code, 401, '冇飛唔可以續');
  /* 前端：自動續期 ＋ 401 一次重試 */
  const fs = await import('node:fs');
  const fe = fs.readFileSync(new URL('../assets/js/lib/auth.js', import.meta.url), 'utf8');
  assert(/export function startSilentRefresh/.test(fe) && /export async function refreshSession/.test(fe), '前端要有靜默刷新');
  assert(/troop_exp/.test(fe) && !/troop_session=\(\[\^;\.\]\+/.test(fe), '前端讀 troop_exp，唔應該硬讀 HttpOnly 飛');
  const api = fs.readFileSync(new URL('../assets/js/lib/api.js', import.meta.url), 'utf8');
  assert(/no_session/.test(api) && /retryOnce/.test(api), '收到 401 應該續期一次再重試');
  const mainSrc = fs.readFileSync(new URL('../assets/js/main.js', import.meta.url), 'utf8');
  assert(/startSilentRefresh/.test(mainSrc), 'boot 要開始自動續期');
});

t('proxy：匿名可寫面真係入得閘（唔會跌去 501「未實作」）', async () => {
  /* ★ 呢個係回歸測試：ANON_GAS 加咗但路由閘冇跟 → 匿名請求會收到 501 UI 先行。
     呢度用真 handler 行一次（本機冇 env ＝ 應該係 503 not_configured，唔係 501）。 */
  const call = async (payload) => {
    let out = null;
    const res = { setHeader() { }, statusCode: 0, end(t) { out = JSON.parse(t); } };
    await proxy.default({ method: 'POST', url: '/api/proxy', headers: {}, body: payload }, res);
    return { code: res.statusCode, body: out };
  };
  const ok = await call({ action: 'accountApply', unit: '82', payload: { name: 'T', ymis: 'YMIS-9', consent: true } });
  eq(ok.code, 503, '匿名可寫面要行到去 env 檢查（未設＝503 not_configured）');
  eq(ok.body.code, 'not_configured', '唔可以係 501 uiPhase');
  assert(!ok.body.uiPhase, '唔應該再見到「UI 先行未實作」');
  const leak = await call({ action: 'accountApply', unit: '82', payload: { state: 'approved' } });
  eq(leak.code, 403, '匿名帶內部欄位要 403');
  eq(leak.body.code, 'anon_forbidden', '要回 anon_forbidden');
  const notAnon = await call({ action: 'deleteUser', unit: '82', payload: {} });
  eq(notAnon.code, 401, '白名單以外免登入＝401');
  eq(notAnon.body.code, 'no_session', '要回 no_session');
  /* 六支匿名 action 全部都要過到 session 閘（唔止一支） */
  for (const a of proxy.ANON_GAS) {
    const r = await call({ action: a, unit: '82', payload: { ref: 'x', name: 'T' } });
    assert(r.code !== 501, `${a} 匿名唔應該被當「未實作（UI 先行）」：${r.code}`);   // 503 not_configured／504 連唔到／200 都算過咗閘
  }
});

t('proxy：申請批核／申請模式嘅權限（批核＝領袖、改政策＝旅長）', () => {
  assert(proxy.LEADER_ACTIONS.includes('decideApplication'), '批核應該旅長／教練員都做得');
  assert(proxy.CHIEF_ONLY.includes('setApplyMode'), '改開戶申請模式應該只旅長做得');
  assert(proxy.GAS_WHITELIST.includes('decideApplication') && proxy.GAS_WHITELIST.includes('getApplyMode'), '批核／查模式要入白名單');
  assert(!proxy.GAS_WHITELIST.includes('accountApply'), '自助申請唔應該經 proxy（免登入路徑自己經 GAS 匿名面）');
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

/* ⑨ 公開分享連結（P1） */
const shareApi = await import('../api/share.js');
t('分享連結：通告／活動先簽得；改一個字即驗唔到；過期即失效；最長 90 日', () => {
  const secret = 'share-secret-test';
  const r = shareApi.signShare({ kind: 'notice', unit: '82', id: 'n-1', to: 'sc0082' }, secret);
  assert(r.ok && r.token.includes('.'), '簽唔到：' + JSON.stringify(r));
  const v = shareApi.verifyShare(r.token, secret);
  assert(v.ok && v.payload.id === 'n-1' && v.payload.kind === 'notice', '驗唔到：' + JSON.stringify(v));
  eq(shareApi.verifyShare(r.token, 'other-secret').ok, false, '換 key 應該唔通');
  const [p1, sig] = r.token.split('.');
  eq(shareApi.verifyShare(p1 + 'x.' + sig, secret).ok, false, '改 payload 應該唔通');
  eq(shareApi.verifyShare(p1 + '.' + sig.slice(0, -2) + 'aa', secret).ok, false, '改簽名應該唔通');
  const expired = shareApi.signShare({ kind: 'notice', unit: '82', id: 'n-1', exp: Date.now() - 1000 }, secret);
  assert(shareApi.verifyShare(expired.token, secret).ok === false, '過期竟然通');
  const bad = shareApi.signShare({ kind: 'photo', unit: '82', id: 'x' }, secret);
  assert(bad.ok === false && /notice／calendar/.test(bad.error), '種類白名單冇擋（物資／相簿唔開放）');
  const long = shareApi.signShare({ kind: 'calendar', unit: '82', id: 'e-1', exp: Date.now() + 365 * 24 * 3600 * 1000 }, secret);
  assert(long.payload.exp - Date.now() <= shareApi.MAX_TTL_MS + 1000, '最長 90 日冇封頂');
  assert(!shareApi.pageFor('calendar', long.payload).includes('notice'), '活動連結唔應該去通告頁');
  assert(!/key|apikey/i.test(shareApi.pageFor('notice', long.payload)), 'URL 唔應該帶 key');
});
t('分享連結：冇 SHARE_SECRET／SESSION_SECRET ＝ fail closed', () => {
  const r = shareApi.signShare({ kind: 'notice', unit: '82', id: 'n-1' }, '');
  assert(r.ok === false && /未設定/.test(r.error), '冇密鑰竟然簽得出');
});

/* ⑩ 成員入口導流（P1）＋唔做帳號枚舉 */
const me = await import('../api/member-entry.js');
t('成員入口：接駁好＋綠燈＋測過＝M1 一次登入；否則 M3；搵唔到＝none（老實講）', () => {
  eq(me.routeForDownstream({ linked: true, status: 'green', tested: true }), 'one-stop');
  eq(me.routeForDownstream({ linked: true, status: 'green', tested: false }), 'two-stop', '未測過連線唔應該當 M1');
  eq(me.routeForDownstream({ linked: true, status: 'amber', tested: true }), 'two-stop');
  eq(me.routeForDownstream({}), 'two-stop');
});
t('成員入口：原始碼掃描 —— 唔准回答「email 有冇戶口」（唔做枚舉）', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../api/member-entry.js', import.meta.url), 'utf8');
  assert(/唔會.*帳號枚舉/.test(src), '要寫明唔做枚舉');
  assert(!/authUser/.test(src), 'member-entry 唔應該查帳號（authUser 會曝露存在性）');
  assert(!/found:\s*true/.test(src), '唔應該回「搵到呢個人」');
});

/* ⑪ 能力註冊表（P1） */
const regApi = await import('../api/registry.js');
t('註冊表：閂咗＝一律唔得；custom＝只限名單；all＝人人得（閂＝隱藏唔刪）', () => {
  const rows = [
    { id: 'notices', mode: 'all' },
    { id: 'finance', mode: 'off' },
    { id: 'inventory', mode: 'custom', branches: ['sc0082', 'VS0082'] }
  ];
  const m = regApi.moduleState(rows);
  eq(m.notices.mode, 'all'); eq(m.finance.mode, 'off');
  assert(regApi.allowedFor(m.notices, 'cs0082') === true, 'all 應該人人得');
  assert(regApi.allowedFor(m.finance, 'cs0082') === false, 'off 應該一律唔得');
  assert(regApi.allowedFor(m.inventory, 'sc0082') === true, 'custom 名單內要用得');
  assert(regApi.allowedFor(m.inventory, 'VS0082') === true, '名單比對要唔分大小寫');
  assert(regApi.allowedFor(m.inventory, 'cs0082') === false, 'custom 名單外要唔得');
  assert(regApi.allowedFor(null, 'sc0082') === false, '冇紀錄＝當冇開');
});

/* ⑫ 旅聚合／分層 cache（P1） */
const troopApi = await import('../api/troop.js');
t('旅聚合：分層 cache ＝ 5／30 分鐘；強制刷新繞過 cache；cache 唔會串旅', () => {
  eq(troopApi.CACHE_TIERS.fast, 5); eq(troopApi.CACHE_TIERS.slow, 30);
  eq(troopApi.tierOf('旅通告'), 'fast'); eq(troopApi.tierOf('物資整合'), 'slow');
  eq(troopApi.tierOf('財務整合'), 'slow'); eq(troopApi.tierOf('旅行事曆'), 'fast');
  troopApi.cachePut('82', '旅通告', [{ id: 'n-1' }], 1000);
  assert(troopApi.cacheGet('82', '旅通告', { now: 1000 + 4 * 60 * 1000 }) !== null, '5 分鐘內應該命中');
  assert(troopApi.cacheGet('82', '旅通告', { now: 1000 + 6 * 60 * 1000 }) === null, '過 5 分鐘應該要重拉');
  assert(troopApi.cacheGet('82', '旅通告', { fresh: true, now: 1000 }) === null, '強制刷新要繞過 cache');
  troopApi.cachePut('82', '物資整合', [{ id: 'i-1' }], 1000);
  assert(troopApi.cacheGet('82', '物資整合', { now: 1000 + 29 * 60 * 1000 }) !== null, '30 分鐘 tier 唔應該咁快過期');
  assert(troopApi.cacheGet('83', '旅通告', { now: 1500 }) === null, '唔可以串到第二個旅');
  troopApi.cacheClear('82');
  assert(troopApi.cacheGet('82', '物資整合', { now: 1500 }) === null, 'cacheClear 要清乾淨');
});
t('旅聚合：唔會回 URL／KEY（對下游只讀 registry）', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../api/troop.js', import.meta.url), 'utf8');
  assert(/_URL|_KEY/.test(src) === false, 'troop.js 唔應該接觸 DOWNSTREAM_*_URL／_KEY');
  const pulled = await troopApi.pullTables('99', { gas: async () => ({ ok: false, code: 'not_configured', msg: 'x' }) }, { tables: ['旅通告'], fresh: true });
  assert(pulled.ok === false && pulled.code === 'not_configured', '未設定 env 要誠實失敗');
});

console.log('');
if (fails.length) {
  console.log(`✗ 旅 /api 測試唔過：${pass}/${pass + fails.length}\n`);
  fails.forEach(f => console.log(`  ✗ ${f.name}\n     ${f.e.message}`));
  process.exit(1);
}
console.log(`✓ 旅 /api 測試全部通過（${pass} 項）`);

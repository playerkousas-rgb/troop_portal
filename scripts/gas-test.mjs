#!/usr/bin/env node
/* ============================================================
   gas-test.mjs — 喺 Node 度跑 `apps-script/Code.gs`（假 Apps Script 環境）
   ------------------------------------------------------------
   點解要咁做：Code.gs 唔可以喺 CI 上真 GAS 跑；但佢嘅**邏輯**（sig 驗簽、
   逐表寫自證、審計 hash 鏈、白名單、hash 唔外洩、DOWNSTREAM_* 唔外洩、
   帳號下限、mustChangePw 閘、限流、防算式注入）全部可以喺本機釘死。
   真 GAS 部署後仍然要人手跑一次「測試連線」對真實下游。
   ============================================================ */
import { readFileSync } from 'node:fs';
import { createHmac, createHash, randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'apps-script/Code.gs'), 'utf8');

let pass = 0; const fails = [];
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fails.push({ name, e }); console.log('  ✗ ' + name + '\n      ' + e.message); } };
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assert failed'); };
const eq = (a, b, msg) => assert(a === b, `${msg || 'eq'}（got ${JSON.stringify(a)}，want ${JSON.stringify(b)}）`);

/* ---------------- 假 Apps Script 環境 ---------------- */
function makeRange(sh, r, c, nr, nc) {
  return {
    getValues() {
      const out = [];
      for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(sh.cell(r + i, c + j)); out.push(row); }
      return out;
    },
    getValue() { return sh.cell(r, c); },
    setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => sh.setCell(r + i, c + j, v))); return this; },
    clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh.setCell(r + i, c + j, ''); return this; }
  };
}
class FakeSheet {
  constructor(name) { this.name = name; this.grid = []; }
  cell(r, c) { const row = this.grid[r - 1] || []; return row[c - 1] === undefined ? '' : row[c - 1]; }
  setCell(r, c, v) { while (this.grid.length < r) this.grid.push([]); const row = this.grid[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v === null || v === undefined ? '' : v; }
  getLastRow() { let last = 0; this.grid.forEach((row, i) => { if (row.some(v => v !== '' && v !== undefined)) last = i + 1; }); return last; }
  getLastColumn() { let last = 0; this.grid.forEach(row => { row.forEach((v, j) => { if (v !== '' && v !== undefined) last = Math.max(last, j + 1); }); }); return last; }
  getRange(r, c, nr = 1, nc = 1) { return makeRange(this, r, c, nr, nc); }
  appendRow(vals) { const r = this.getLastRow() + 1; vals.forEach((v, j) => this.setCell(r, j + 1, v)); }
  setFrozenRows() { return this; }
}
class FakeSpreadsheet {
  constructor() { this.sheets = new Map(); }
  getName() { return '假旅 SHEET（測試）'; }
  getSheetByName(n) { return this.sheets.get(n) || null; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets.set(n, s); return s; }
}
const b64 = buf => Buffer.from(buf).toString('base64');
function makeSandbox({ fetchImpl } = {}) {
  const spread = new FakeSpreadsheet();
  const props = new Map();
  const cache = new Map();
  const requests = [];
  const sandbox = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => spread, getUi: () => ({ alert() {}, prompt: () => ({ getResponseText: () => '' }), createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (props.has(k) ? props.get(k) : null), getProperties: () => Object.fromEntries(props), setProperty: (k, v) => { props.set(k, String(v)); return this; }, setProperties: o => { Object.entries(o).forEach(([k, v]) => props.set(k, String(v))); return this; }, deleteProperty: k => { props.delete(k); return this; } }) },
    CacheService: { getScriptCache: () => ({ get: k => (cache.has(k) ? cache.get(k) : null), put: (k, v) => { cache.set(k, v); }, remove: k => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
      computeDigest: (alg, str) => Array.from(createHash('sha256').update(String(str), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      computeHmacSha256Signature: (msg, key) => Array.from(createHmac('sha256', String(key)).update(String(msg), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      getUuid: () => randomUUID(),
      newBlob: (data, type, name) => ({ data, type, name }),
      base64Encode: s => b64(s),
      formatDate: () => '2026-01-01'
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        requests.push({ url, opts });
        if (fetchImpl) { const r = fetchImpl(url, opts, requests); if (r) return r; }
        return { getResponseCode: () => 404, getContentText: () => JSON.stringify({ success: false, error: 'no stub for ' + url }) };
      }
    },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/FAKE/exec' }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'admin@example.hk' }) },
    MailApp: { sendEmail() {} },
    Logger: { log() {} },
    DriveApp: { Access: { PRIVATE: 'PRIVATE' }, Permission: { NONE: 'NONE' }, createFile: () => ({ setSharing() {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: txt => ({ _t: txt, setMimeType() { return this; }, getContent() { return this._t; } })
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'Code.gs' });
  return { G: sandbox, props, cache, requests, spread };
}

/* ---------------- 測試開始 ---------------- */
console.log('\n旅 GAS 測試（假 Apps Script 環境；真 GAS 上線後仍要人手測一次連線）');

/* ① 初始化：分頁／APIKEY／種入旅長 */
t('初始化：建立所有分頁 ＋ 自動生成 APIKEY（唔落 Sheet）', () => {
  const { G, props, spread } = makeSandbox();
  const r = G.initializeSheets();
  assert(r.ok && r.tabs.length >= 20, '分頁唔夠');
  const key = props.get('API_KEY');
  assert(/^troop_[0-9a-f]{32}$/.test(key), 'APIKEY 格式唔啱：' + key);
  /* ABCD 唔可以落 Sheet */
  let dump = '';
  spread.sheets.forEach(s => { s.grid.forEach(row => row.forEach(v => { dump += String(v); })); });
  assert(!dump.includes(key), 'APIKEY 落咗 Sheet（大忌）');
});

t('種入第一個旅長：只發一次性 setup token，唔會寫明文密碼', () => {
  const { G, spread } = makeSandbox();
  G.initializeSheets();
  const r = G.seedFirstChief('chief@demo.hk', '陳大文');
  assert(r.ok && r.token && r.token.length === 12, 'token 唔啱');
  const user = G.readTable_('旅員')[0];
  eq(user.source_email === undefined ? user.email : user.email, 'chief@demo.hk');
  eq(user.status, 'pending_hash', '未落 hash 之前唔應該係 active');
  let dump = ''; spread.sheets.forEach(s => s.grid.forEach(row => row.forEach(v => { dump += String(v); })));
  assert(!/demo1234|password|密碼/.test(dump), '唔應該有明文密碼痕跡');
});

/* ② apikey 驗身 + 白名單 */
const call = (G, body, params = {}) => JSON.parse(G.doPost({ postData: { contents: JSON.stringify(body) }, parameter: params }).getContent());
t('驗身：錯 apikey 一律拒；正確 apikey 先入得', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  const bad = call(G, { action: 'dbInfo', apikey: 'troop_wrong' });
  assert(bad.success === false && bad.code === 'bad_key', '錯 key 竟然入得');
  const good = call(G, { action: 'dbInfo', apikey: key });
  assert(good.success === true && good.data.tables.length > 0, '啱 key 都入唔到');
});
t('白名單：冇呢個 action → 拒，並列出可用 action', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const r = call(G, { action: 'dropDatabase', apikey: props.get('API_KEY') });
  assert(r.success === false && r.code === 'unknown_action' && r.allowed.includes('saveTables'), '未知 action 竟然唔拒');
});
t('永不接受：login／apply／logout／cancelLogRequest 一律拒（即使有 apikey）', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  ['apply', 'logout', 'cancelLogRequest'].forEach(a => {
    const r = call(G, { action: a, apikey: props.get('API_KEY') });
    assert(r.success === false && r.code === 'never_accept', a + ' 竟然接受');
  });
  const lg = call(G, { action: 'login', email: 'x@y.z', apikey: props.get('API_KEY') });
  assert(lg.success === false && lg.code === 'use_api_auth', 'login 應該老實叫你去 /api/auth');
});
t('敏感 action 只可以由 server（apikey）：sig 通道做唔到 exportAll', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const sig = G.signOutgoing_('exportAll', { action: 'exportAll' }, G.LINK_SIG_PURPOSE, props.get('API_KEY'));
  const r = call(G, { action: 'exportAll', ...sig });
  assert(r.success === false && r.code === 'server_only', '上游竟然 exportAll 到');
});

/* ③ 逐表寫 + 自證 */
t('逐表寫：saveTables → 讀返自證 confirmed:true ＋ 舊行清走唔會漏', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  const rows = [{ id: 'b-1', name: '深資童軍團' }, { id: 'b-2', name: '童軍團' }];
  const r = call(G, { action: 'saveTables', apikey: key, data: { 支部: rows } });
  assert(r.success && r.data.confirmed === true && r.data.wrote['支部'] === 2, '自證唔過：' + JSON.stringify(r.data));
  const back = call(G, { action: 'load', apikey: key, table: '支部' });
  eq(back.data.length, 2, '讀返行數');
  /* 再寫一次（換內容）→ 舊行要清走 */
  const r2 = call(G, { action: 'saveTables', apikey: key, data: { 支部: [{ id: 'b-9', name: '樂行童軍團' }] } });
  assert(r2.data.confirmed === true, '第二次自證唔過');
  const back2 = call(G, { action: 'load', apikey: key, table: '支部' });
  eq(back2.data.length, 1, '舊行冇清走');
  eq(back2.data[0].name, '樂行童軍團', '內容唔啱');
});
t('逐表寫：一個表失敗唔會拖死其他表，並如實回 fails', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const r = call(G, { action: 'saveTables', apikey: props.get('API_KEY'), data: { 支部: [{ id: 'x' }], 唔存在嘅表: [{ a: 1 }] } });
  assert(r.data.wrote['支部'] === 1 && r.data.fails.some(f => f.includes('白名單')), '失敗表冇如實回報');
});

/* ④ 審計 hash 鏈 */
t('審計：prev_hash 鏈接得上；改一行即刻驗到（防篡改）', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  G.audit_('陳大文', '測試', 't1', 'd1', 'api');
  G.audit_('陳大文', '測試', 't2', 'd2', 'api');
  G.audit_('陳大文', '測試', 't3', 'd3', 'api');
  const ok = G.verifyAuditChain_();
  assert(ok.ok && ok.rows === 3, '鏈唔通：' + JSON.stringify(ok));
  /* 篡改中間一行 */
  const sh = G.ss_().getSheetByName('審計紀錄');
  sh.setCell(3, 9, '改過嘅內容');
  const bad = G.verifyAuditChain_();
  assert(bad.ok === false, '改咗都驗唔到（大問題）');
});
t('讀取永不外洩：hash／salt／apiKey 一律剝走', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  const h = 'a'.repeat(64);
  call(G, { action: 'saveTables', apikey: key, data: { 旅員: [{ id: 'u-1', email: 'a@b.c', hash: h, salt: 'salt12345', role: 'chief' }] } });
  const r = call(G, { action: 'load', apikey: key, table: '旅員' });
  assert(r.data[0].hash === undefined && r.data[0].salt === undefined, '一般讀取竟然見到 hash');
  const secret = call(G, { action: 'load', apikey: key, table: '旅員', withSecrets: true });
  eq(secret.data[0].hash, h, 'server 側（apikey）應該讀到 hash（/api/auth 要驗）');
});

/* ⑤ registry 唔外洩 */
t('registry：DOWNSTREAM_* 只回公開部分（永不含 URL／KEY／purpose）', () => {
  const { G } = makeSandbox(); G.initializeSheets();
  G.registerDownstream({ id: 'vs0082', url: 'https://script.google.com/macros/s/AAA/exec', key: 'troop_secretkey_123', name: '82旅 深資童軍團', purpose: 'vsbadge-troop-sig-v1' });
  const r = call(G, { action: 'getDownstreams' });
  const dump = JSON.stringify(r);
  assert(!dump.includes('troop_secretkey_123'), 'KEY 外洩');
  assert(!dump.includes('/exec') && !dump.includes('vsbadge-troop-sig-v1'), 'URL／purpose 外洩');
  eq(r.data[0].name, '82旅 深資童軍團', '顯示名唔啱');
  const bad = G.registerDownstream({ id: 'x', url: 'https://evil.example.com/exec', key: 'k' });
  assert(bad.ok === false, '唔係 script.google.com 嘅 URL 竟然收');
});

/* ⑥ sig 驗簽（雙通道、時窗、nonce、防篡改） */
t('sig：正確簽名通過；改 body／過期／重放／錯 purpose 一律拒', () => {
  const { G } = makeSandbox(); G.initializeSheets();
  const mk = () => {
    const body = { action: 'load', table: '支部' };
    const sig = G.signOutgoing_('load', body, G.LINK_SIG_PURPOSE, G.apiKey_());
    return { ...body, ...sig };
  };
  const ok1 = call(G, mk());
  assert(ok1.success === true, '正確簽名唔通：' + JSON.stringify(ok1));
  /* 重放（同一 nonce） */
  const same = mk(); const a = call(G, same); const b = call(G, same);
  assert(a.success === true && b.success === false && /nonce/.test(b.error), '重放竟然通得（nonce 冇消耗）');
  /* 改 body */
  const c = mk(); c.table = '旅員'; c.action = 'load';
  assert(call(G, c).success === false, '改咗 body 都通（digest 冇綁 body）');
  /* 過期 */
  const d = mk(); d.sig_ts = Date.now() - 10 * 60 * 1000;
  assert(call(G, d).success === false && /時間戳/.test(call(G, d).error), '過期簽名竟然通');
  /* 錯 purpose */
  const e = mk();
  assert(call(G, { ...e, sig: createHmac('sha256', 'wrong').update('x').digest('hex') }).success === false, '亂簽竟然通');
});
t('sig：唔收 GET 帶 sig；一律要 POST', () => {
  const { G } = makeSandbox(); G.initializeSheets();
  const r = JSON.parse(G.doGet({ parameter: { sig: 'x'.repeat(64), action: 'load' } }).getContent());
  assert(r.success === true && r.data.note.includes('只收 POST'), 'GET 應該只回健康檢查');
  const dump = JSON.stringify(r);
  assert(!dump.includes('"rows"') && !dump.includes('users') && !dump.includes('旅員'), 'GET 唔應該回任何資料');
});

/* ⑦ 限流 + mustChangePw 閘 + 帳號下限 */
t('限流：同 IP 錯 5 次就鎖（15 分鐘）', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  for (let i = 0; i < 5; i++) call(G, { action: 'dbInfo', apikey: 'troop_wrong' }, { ip: '1.2.3.4' });
  const locked = call(G, { action: 'dbInfo', apikey: key }, { ip: '1.2.3.4' });
  assert(locked.success === false && locked.code === 'rate_limited', '鎖唔到：' + JSON.stringify(locked));
  const other = call(G, { action: 'dbInfo', apikey: key }, { ip: '9.9.9.9' });
  assert(other.success === true, '唔應該連其他 IP 都鎖');
});
t('mustChangePw 閘：未改密碼之前唔可以做嘢（改密碼／讀 status 例外）', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  const h = 'b'.repeat(64);
  call(G, { action: 'saveTables', apikey: key, data: { 旅員: [{ id: 'u-1', email: 'new@demo.hk', role: 'member', hash: h, salt: 'salt12345', status: 'active', mustChangePw: true }] } });
  const blocked = call(G, { action: 'saveTables', apikey: key, asUser: 'new@demo.hk', data: { 支部: [{ id: 'x' }] } });
  assert(blocked.success === false && blocked.code === 'must_change_pw', '未改密碼竟然寫得入');
  const allowed = call(G, { action: 'status', apikey: key, asUser: 'new@demo.hk' });
  assert(allowed.success === true, 'status 應該照得');
});
t('帳號下限：刪／停用最後一個旅長會被擋（每個 leaf 至少 1 個領袖戶）', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  const h = 'c'.repeat(64);
  call(G, { action: 'saveTables', apikey: key, data: { 旅員: [{ id: 'u-1', email: 'chief@demo.hk', role: 'chief', status: 'active', hash: h, salt: 'salt12345' }] } });
  const del = call(G, { action: 'deleteUser', apikey: key, id: 'u-1' });
  assert(del.success === false && del.code === 'keep_one', '刪到最後一個旅長（大忌）');
  /* 加第二個 → 刪得 */
  call(G, { action: 'saveTable', apikey: key, table: '旅員', rows: [
    { id: 'u-1', email: 'chief@demo.hk', role: 'chief', status: 'active', hash: h, salt: 'salt12345' },
    { id: 'u-2', email: 'chief2@demo.hk', role: 'chief', status: 'active', hash: h, salt: 'salt12345' }
  ] });
  const del2 = call(G, { action: 'deleteUser', apikey: key, id: 'u-1' });
  assert(del2.success === true, '有第二個旅長應該刪得：' + JSON.stringify(del2));
});

/* ⑧ 中央登入票據（回打固定端點） */
t('中央登入：帶 super_ticket → 回打 /api/super 驗票（一次性）；冇票 → 老實叫你去 /api/auth', () => {
  const stubFetch = (url, opts) => {
    if (url.includes('/api/super')) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ success: true, data: { email: 'chief@demo.hk', unit: '0082' } }) };
    return null;
  };
  const { G, props } = makeSandbox({ fetchImpl: stubFetch });
  G.initializeSheets();
  call(G, { action: 'saveTable', apikey: props.get('API_KEY'), table: '旅員', rows: [{ id: 'u-1', email: 'chief@demo.hk', role: 'chief', status: 'active', hash: 'd'.repeat(64), salt: 'salt12345' }] });
  const r = call(G, { action: 'login', super_ticket: 'TICKET-1' });
  assert(r.success === true && r.data.via === 'super', '票據登入失敗：' + JSON.stringify(r));
  const replay = call(G, { action: 'login', super_ticket: 'TICKET-1' });
  assert(replay.success === false && /用過/.test(replay.error), '票據可以重放（大問題）');
  const plain = call(G, { action: 'login', email: 'chief@demo.hk', password: 'x' });
  assert(plain.success === false && plain.code === 'use_api_auth', '明文密碼竟然收');
});
t('GAS 唔會自己 hash／驗密碼（原始碼層面釘死）', () => {
  assert(!/makePasswordHash_/.test(SRC), 'GAS 唔應該自己 hash 密碼');
  assert(/PBKDF2/.test(SRC) && /\/api\/auth/.test(SRC), '要寫明 hash 喺 /api/auth 做');
  assert(!/password\s*===\s*/.test(SRC), 'GAS 唔應該比對明文密碼');
});

/* ⑨ 防死鎖 / 白名單守護 / 零回打 */
t('sig 出站：apikey 唔落 query；下游 URL 一定要 /exec', () => {
  const { G, props, requests } = makeSandbox();
  G.initializeSheets();
  G.registerDownstream({ id: 'vs0082', url: 'https://script.google.com/macros/s/AAA/exec', key: 'troop_downstreamkey_1', name: '深資' });
  G.callDownstream('vs0082', 'getLinkState', {});
  const req = requests[0];
  eq(req.url, 'https://script.google.com/macros/s/AAA/exec', '要打下游 /exec');
  assert(!/apikey/.test(req.url), 'apikey 唔應該出現喺 URL');
  const body = JSON.parse(req.opts.payload);
  assert(body.sig && body.sig_ts && body.sig_nonce, '出站要帶 sig 三件');
  assert(!body.apikey && !body.key, '出站 body 唔應該帶自己嘅 key');
});
t('零回打：Code.gs 掃 callback／postMessage／newTrigger／onEdit 零命中', () => {
  ['callback', 'postMessage', 'newTrigger', 'onEdit'].forEach(w => assert(!SRC.includes(w), '唔應該出現：' + w));
  assert(!/UrlFetchApp\.fetch\([^)]*\)[\s\S]{0,80}?（下游主動回打）/.test(SRC), '下游唔應該回打');
});
t('防算式注入：標籤消毒只留 0-9A-Za-z_.@-', () => {
  const { G } = makeSandbox();
  eq(G.sanitizeLabel_('=IMPORTRANGE("x","y")'), 'IMPORTRANGExy', '算式注入消毒唔啱');
  eq(G.sanitizeLabel_('+1+1'), '11', '加號冇濾');
});

/* ⑩ 匯出／匯入 */
t('匯出：帶 sha256 指紋、剝走敏感欄；匯入保留舊 hash（唔重算）', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  const h = 'e'.repeat(64);
  call(G, { action: 'saveTable', apikey: key, table: '旅員', rows: [{ id: 'u-1', email: 'a@b.c', role: 'chief', hash: h, salt: 'salt12345' }] });
  const ex = call(G, { action: 'exportAll', apikey: key });
  assert(ex.data.meta.sha256, '冇指紋');
  const imp = call(G, { action: 'importAll', apikey: key, payload: { data: { 旅員: [{ id: 'u-2', email: 'n@b.c', role: 'member', hash: h, salt: 'salt12345' }] } } });
  assert(imp.success === true && imp.data.added === 1, '匯入失敗：' + JSON.stringify(imp));
  const users = C(G, key, 'load', { table: '旅員', withSecrets: true });
  assert(users.find(u => u.email === 'n@b.c').hash === h, '匯入冇保留舊 hash');
});
function C(G, key, action, extra) { return call(G, { action, apikey: key, ...(extra || {}) }).data; }

/* ⑪ dbInfo / 狀態 */
t('後端實況：表數／行數／鏈狀態如實報（唔報喜唔報憂）', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const info = C(G, props.get('API_KEY'), 'dbInfo');
  assert(info.tables.length >= 20 && typeof info.rows === 'number', 'dbInfo 唔齊');
  assert(info.chain && info.chain.ok === true, '鏈應該係好嘅');
  assert(info.properties.downstreams === 0 && info.properties.apiKey === true, '屬性統計唔啱');
});

/* 收尾 */
console.log('');
if (fails.length) {
  console.log(`✗ 旅 GAS 測試唔過：${pass}/${pass + fails.length}\n`);
  fails.forEach(f => console.log(`  ✗ ${f.name}\n     ${f.e.message}`));
  process.exit(1);
}
console.log(`✓ 旅 GAS 測試全部通過（${pass} 項）`);

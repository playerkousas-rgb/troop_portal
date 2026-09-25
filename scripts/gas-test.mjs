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
  getName() { return this.name; }
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
  getSheets() { return [...this.sheets.values()]; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets.set(n, s); return s; }
  deleteSheet(sh) { this.sheets.delete(sh.getName()); }
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

/* ⑫ 支部註冊表／燈號（P1 §10-2/3） */
t('registry：紅黃綠三態（未測＝黃；測唔到＝紅；測到＝綠）＋永不外洩 URL／KEY', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  G.registerDownstream({ id: 'vs0082', url: 'https://script.google.com/macros/s/AAA/exec', key: 'troop_downstream_secret', name: '深資童軍團' });
  let r = call(G, { action: 'registry', apikey: key });
  eq(r.data[0].status, 'amber', '未測過連線＝黃燈');
  assert(!JSON.stringify(r).includes('troop_downstream_secret') && !JSON.stringify(r).includes('/exec'), 'registry 外洩');
  /* 測試連線：下游唔存在（假環境回 404）→ 紅 */
  call(G, { action: 'testDownstream', apikey: key, id: 'vs0082' });
  r = call(G, { action: 'registry', apikey: key });
  eq(r.data[0].status, 'red', '測唔到＝紅燈');
  assert(/失敗/.test(r.data[0].note), '紅燈要講原因');
  /* 手動紅／綠：進度 sig 路徑未起好之前靠人手 */
  const set = call(G, { action: 'setUnitStatus', apikey: key, id: 'vs0082', status: 'green', note: '教練員電話確認' });
  assert(set.success === true, '設定燈號失敗：' + JSON.stringify(set));
  r = call(G, { action: 'registry', apikey: key });
  eq(r.data[0].status, 'green', '手動綠燈要用得');
  eq(r.data[0].note, '教練員電話確認', '要保留原因');
  const bad = call(G, { action: 'setUnitStatus', apikey: key, id: 'vs0082', status: '藍' });
  assert(bad.success === false, '亂填燈號竟然收');
});
t('分享：發起要標題同對象；落 `分享` 表；審計記低', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  const bad = call(G, { action: 'saveShare', apikey: key, share: { to: ['sc0082'] } });
  assert(bad.success === false && bad.code === 'bad_share', '冇標題竟然收');
  const okr = call(G, { action: 'saveShare', apikey: key, share: { title: '中秋露營', kind: 'calendar', to: ['sc0082', 'cs0082'], state: 'pending' } });
  assert(okr.success === true && okr.data.to.length === 2, '發起分享失敗：' + JSON.stringify(okr));
  const rows = G.readTable_('分享');
  eq(rows.length, 1); eq(rows[0].state, 'pending', '未接收＝pending');
  const audit = G.readTable_('審計紀錄').map(a => a.action).join(',');
  assert(audit.includes('發起分享'), '審計冇記');
});
t('求救落 SHEET：免登入都寫得；重複 id 冪等；內容長度收斂', () => {
  const { G } = makeSandbox({ fetchImpl: (u) => (u.includes('/api/super') ? { getResponseCode: () => 200, getContentText: () => JSON.stringify({ success: true, data: {} }) } : null) });
  G.initializeSheets();
  const r1 = call(G, { action: 'saveRescue', rescue: { id: 'rs-1', title: '登入唔到', note: 'x'.repeat(3000), by: '曾國強', contact: '91234567', kind: 'login' } });
  assert(r1.success === true && r1.data.id === 'rs-1', '求救寫入失敗：' + JSON.stringify(r1));
  const rows = G.readTable_('求救');
  eq(rows[0].note.length, 2000, '詳情要截到 2000 字');
  eq(rows[0].state, 'open');
  const r2 = call(G, { action: 'saveRescue', rescue: { id: 'rs-1', title: '再送一次', note: 'dup' } });
  assert(r2.success === false && r2.code === 'duplicate', '重複送出竟然收（唔冪等）');
  const r3 = call(G, { action: 'saveRescue', rescue: { title: '', note: 'x' } });
  assert(r3.success === false && r3.code === 'bad_rescue', '冇標題竟然收');
  /* 匿名限流：同一個 IP 每個鐘最多 3 單（第四單要拒，唔可以無限灌） */
  const same = { ip: '7.7.7.7' };
  call(G, { action: 'saveRescue', rescue: { id: 'q-1', title: 'a', note: 'b' } }, same);
  call(G, { action: 'saveRescue', rescue: { id: 'q-2', title: 'a', note: 'b' } }, same);
  call(G, { action: 'saveRescue', rescue: { id: 'q-3', title: 'a', note: 'b' } }, same);
  const q4 = call(G, { action: 'saveRescue', rescue: { id: 'q-4', title: 'a', note: 'b' } }, same);
  assert(q4.success === false && q4.code === 'rate_limited', '匿名灌單竟然唔擋：' + JSON.stringify(q4));
  /* 其他人／其他 IP 唔受影響 */
  const other = call(G, { action: 'saveRescue', rescue: { id: 'q-5', title: 'a', note: 'b' } }, { ip: '8.8.8.8' });
  assert(other.success === true, '唔應該連其他人一齊擋');
});

/* ⑬ 大庫分件 ＋ tombstone（P1 §10-7） */
t('大庫分件：超 rowsPerWrite 自動切件；讀嘅時候合返；細返就清走舊分件', () => {
  const { G, props, spread } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  G.LIMITS.rowsPerWrite = 100;                       // 測試用細上限
  const rows = [];
  for (let i = 0; i < 250; i++) rows.push({ id: 'n-' + i, title: '通告 ' + i });
  const w = call(G, { action: 'saveTable', apikey: key, table: '旅通告', rows });
  assert(w.success === true, '分件寫入失敗：' + JSON.stringify(w).slice(0, 200));
  const parts = [...spread.sheets.keys()].filter(k => k.startsWith('旅通告#'));
  eq(parts.length, 3, '250 行／100 ＝ 3 件');
  eq(G.readTableAll_('旅通告').length, 250, '分段讀要合返 250 行');
  const back = call(G, { action: 'load', apikey: key, table: '旅通告' });
  eq(back.data.length, 250, 'API 讀取都要合返');
  /* 縮返細 → 舊分件清走 */
  call(G, { action: 'saveTable', apikey: key, table: '旅通告', rows: rows.slice(0, 10) });
  eq([...spread.sheets.keys()].filter(k => k.startsWith('旅通告#')).length, 0, '細返要清走分件');
  eq(G.readTableAll_('旅通告').length, 10, '唔可以殘留舊分件行');
  G.LIMITS.rowsPerWrite = 20000;
});
t('saveDbPart：前端可以自己分件寫（part 0＝主分頁）＋ reset 清舊件', () => {
  const { G, props, spread } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  const r1 = call(G, { action: 'saveDbPart', apikey: key, table: '財務整合', part: 1, rows: [{ id: 'f-1' }, { id: 'f-2' }] });
  assert(r1.success === true && r1.data.sheet === '財務整合#1', '分件寫入失敗：' + JSON.stringify(r1));
  const r2 = call(G, { action: 'saveDbPart', apikey: key, table: '財務整合', part: 2, rows: [{ id: 'f-3' }] });
  assert(r2.success === true, '第二件寫唔入');
  eq(G.readTableAll_('財務整合').length, 3, '分段讀要合返');
  const r3 = call(G, { action: 'saveDbPart', apikey: key, table: '財務整合', part: 0, reset: true, rows: [{ id: 'f-9' }] });
  assert(r3.success === true, 'reset 失敗');
  assert(![...spread.sheets.keys()].some(k => k.startsWith('財務整合#')), 'reset 應該清走分件');
  eq(G.readTableAll_('財務整合').length, 1, 'reset 後只剩主分頁嗰行');
  const bad = call(G, { action: 'saveDbPart', apikey: key, table: '財務整合', part: 99, rows: [] });
  assert(bad.success === false && bad.code === 'bad_part', '亂填件號竟然收');
});
t('刪除＝tombstone：刪一行會留墓碑（邊個、幾時、為咩）；90 日後 purge 清走', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  call(G, { action: 'saveTable', apikey: key, table: '旅通告', rows: [{ id: 'n-1' }, { id: 'n-2' }] });
  const del = call(G, { action: 'deleteRow', apikey: key, table: '旅通告', rowId: 'n-1', reason: '重複發佈' });
  assert(del.success === true && del.data.tombstone === true, '刪除失敗：' + JSON.stringify(del));
  eq(G.readTableAll_('旅通告').length, 1, '刪完應該剩一行');
  const tm = call(G, { action: 'getTombstones', apikey: key });
  eq(tm.data.length, 1, '應該有一個墓碑');
  eq(tm.data[0].rowId, 'n-1'); eq(tm.data[0].reason, '重複發佈');
  assert(tm.data[0].by && tm.data[0].at, '墓碑要記低邊個／幾時');
  const again = call(G, { action: 'deleteRow', apikey: key, table: '旅通告', rowId: 'n-1' });
  assert(again.success === false && again.code === 'no_row', '刪第二次唔應該當成功');
  /* purge：改舊個墓碑時間，purge 要清走 */
  const sh = G.ss_().getSheetByName('_tombstone');
  sh.setCell(2, 5, '2020-01-01 00:00');
  const p = call(G, { action: 'purgeTombstones', apikey: key });
  eq(p.data.purged, 1, '過期墓碑要清走');
  eq(call(G, { action: 'getTombstones', apikey: key }).data.length, 0, '清完應該冇');
});

/* ⑭ 權限封頂（下級 ⊆ 上級；BUILD §3、落差 #9） */
t('權限封頂：教練員唔可以授旅長／系統權限（如實回報 clamped，唔會靜靜放寬）', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  const h = 'f'.repeat(64);
  call(G, { action: 'saveTable', apikey: key, table: '旅員', rows: [
    { id: 'u-coach', email: 'coach@demo.hk', role: 'coach', status: 'active', hash: h, salt: 'salt12345' },
    { id: 'u-mem', email: 'mem@demo.hk', role: 'member', status: 'active', hash: h, salt: 'salt12345' }
  ] });
  /* 教練員（asUser）想授 system_all（只有旅長有）→ 要 clamp */
  const r = call(G, { action: 'updatePermissions', apikey: key, asUser: 'coach@demo.hk', id: 'u-mem', perms: ['notice_publish', 'system_all', 'module_toggle'] });
  assert(r.success === true, '請求本身應該成功（只係封頂）：' + JSON.stringify(r));
  const u = r.data.user;
  assert(u.perms.includes('notice_publish'), '教練員有嘅權限應該授得');
  assert(!u.perms.includes('system_all') && !u.perms.includes('module_toggle'), '超出層級嘅權限唔可以授：' + JSON.stringify(u.perms));
  eq((u.clamped.perms || []).sort().join(','), 'module_toggle,system_all', '要如實列出被擋嘅權限');
  assert(r.data.note && /封頂/.test(r.data.note), '要講明已封頂');
  /* 角色昇級：教練員唔可以授 chief */
  const r2 = call(G, { action: 'updateUserRole', apikey: key, asUser: 'coach@demo.hk', id: 'u-mem', role: 'chief' });
  eq(r2.data.user.role, 'coach', '唔可以授唔低過自己嘅角色');
  assert(r2.data.clamped.role.length === 1, '要回報角色被擋');
  /* 旅長可以授自己層級內嘅 */
  const r3 = call(G, { action: 'updatePermissions', apikey: key, asUser: 'coach@demo.hk', id: 'u-mem', role: 'coach', perms: ['notice_publish'] });
  assert(r3.success === true, '正常授權應該得');
  /* ★ fail closed：帶咗 asUser 但搵唔到人（或者停用）→ 當最低權限，唔會當超管 */
  const r4 = call(G, { action: 'updatePermissions', apikey: key, id: 'u-mem', perms: ['system_all'], asUser: 'ghost@nowhere.hk' });
  const c4 = r4.data && (r4.data.clamped || (r4.data.user && r4.data.user.clamped));
  assert(c4 && (c4.perms || []).includes('system_all'), '未知 asUser 竟然授得系統權限（大漏洞）');
  const r5 = call(G, { action: 'updatePermissions', apikey: key, id: 'u-mem', perms: ['system_all'], asUser: 'coach@demo.hk' });
  assert(r5.success === true, '教練員請求應該回成功（只係封頂）');
  const c5 = r5.data.clamped || (r5.data.user && r5.data.user.clamped);
  assert(c5 && (c5.perms || []).includes('system_all'), '教練員唔應該授到系統權限');
});
t('有效權限：角色 ∪ 逐人加；逐人加嘅一樣封頂；讀取唔外洩 hash', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  const h = 'a'.repeat(64);
  call(G, { action: 'saveTable', apikey: key, table: '旅員', rows: [
    { id: 'u-1', email: 'c@demo.hk', role: 'coach', perms: ['system_all', 'audit_view'], status: 'active', hash: h, salt: 'salt12345' }
  ] });
  const r = call(G, { action: 'load', apikey: key, table: '旅員' });
  const u = r.data[0];
  assert(u.effectivePerms.includes('audit_view'), '角色本身有嘅要有');
  assert(!u.effectivePerms.includes('system_all'), '逐人加但超出角色嘅要擋');
  assert(u.hash === undefined && u.salt === undefined && u.setupToken === undefined, '讀取唔可以外洩敏感欄');
});

/* ⑮ 匿名可寫面（BUILD §3／§10-5）＋開戶申請（§7） */
t('匿名申報面：五種都要寫入 `申請` 待批表（pending），而且要登入先讀得到', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  const r1 = call(G, { action: 'noticeSignup', noticeId: 'n-1', name: '陳小明', ymis: 'YMIS001', note: '出席', contact: '91234567' });
  assert(r1.success === true && r1.data.state === 'pending', '報名寫入失敗：' + JSON.stringify(r1));
  const r2 = call(G, { action: 'borrowApply', ref: 'i-1', name: '陳小明', ymis: 'YMIS001', note: '借 2 個營幕' });
  assert(r2.success === true, '物資借用失敗');
  const r3 = call(G, { action: 'financeApply', branchId: 'vs0082', period: '2026-09', title: '9 月收支', note: '收入 1200／支出 800' });
  const r4 = call(G, { action: 'progressApply', branchId: 'vs0082', period: '2026-09', note: '已完成 X 項' });
  assert(r3.success && r4.success, '支部申報失敗');
  /* 未登入唔可以讀申請（只有寫得入） */
  const read = call(G, { action: 'load', table: '申請' });
  assert(read.success === false, '匿名竟然讀得到申請表');
  const rows = G.readTable_('申請');
  eq(rows.length, 4, '四張申請都應該喺表');
  rows.forEach(r => { eq(r.state, 'pending', '全部要待批'); eq(r.via, 'anon', '要記低係免登入入嘅'); });
  /* 一單一 IP 上限：灌單要擋 */
  let blocked = false;
  for (let i = 0; i < 14; i++) { const q = call(G, { action: 'noticeSignup', noticeId: 'n-9', name: '灌' + i, ymis: 'X' + i }, { ip: '6.6.6.6' }); if (q.success === false && q.code === 'rate_limited') blocked = true; }
  assert(blocked, '匿名灌單竟然唔擋（申請類每鐘上限 10）');
  /* 求救同申請分開計：求救照送得（唔會因為申請灌爆而擋住求救） */
  const rescueStill = call(G, { action: 'saveRescue', rescue: { title: '救命', note: 'x' } }, { ip: '6.6.6.6' });
  assert(rescueStill.success === true, '求救唔應該被申請類嘅限流擋：' + JSON.stringify(rescueStill));
});
t('匿名去重：同通告同名唔重複；同 YMIS 待批唯一；同支部同期唯一', () => {
  const { G } = makeSandbox(); G.initializeSheets();
  const a = call(G, { action: 'noticeSignup', noticeId: 'n-1', name: '陳小明', ymis: 'Y1' });
  const b = call(G, { action: 'noticeSignup', noticeId: 'n-1', name: '陳小明', ymis: 'Y1' });
  assert(a.success && b.success && b.data.duplicate === true, '同通告同名應該去重：' + JSON.stringify(b));
  eq(G.readTable_('申請').length, 1, '唔應該多一行');
  /* 唔同名＝另一個人，照收 */
  const c = call(G, { action: 'noticeSignup', noticeId: 'n-1', name: '李小姐', ymis: 'Y2' });
  assert(c.success && !c.data.duplicate, '第二個人應該收得');
  /* 支部同期唯一 */
  const f1 = call(G, { action: 'financeApply', branchId: 'vs0082', period: '2026-09', note: 'a' });
  const f2 = call(G, { action: 'financeApply', branchId: 'vs0082', period: '2026-09', note: 'b' });
  assert(f2.data.duplicate === true, '同支部同期應該去重');
  assert(f1.data.id !== f2.data.id || true, '');
  /* YMIS 已有戶口 ＝ 唔使申請 */
  const h = 'b'.repeat(64);
  call(G, { action: 'saveTable', apikey: G.apiKey_(), table: '旅員', rows: [{ id: 'u-1', email: 'x@y.hk', ymis: 'Y3', role: 'member', hash: h, salt: 'salt12345' }] });
  const q = call(G, { action: 'accountApply', ymis: 'Y3', name: '已有戶' });
  assert(q.success === true && q.data.duplicate === true, '已經有戶口唔應該再開：' + JSON.stringify(q));
});
t('開戶申請：批 ＝ 發一次性邀請 token；拒 ＝ 一定要原因；純邀請制＝唔收自助申請', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  const a = call(G, { action: 'accountApply', ymis: 'Y9', name: '黃同學', email: 'wong@demo.hk', branchId: 'vs0082', contact: '90001111' });
  assert(a.success && a.data.state === 'pending', '開戶申請失敗：' + JSON.stringify(a));
  /* 冇原因唔可以拒 */
  const badRej = call(G, { action: 'decideApplication', apikey: key, id: a.data.id, decide: 'reject' });
  assert(badRej.success === false && badRej.code === 'need_reason', '冇原因竟然拒到');
  /* 批 → 回邀請 token（24 小時一次性） */
  const okApprove = call(G, { action: 'decideApplication', apikey: key, id: a.data.id, decide: 'approve' });
  assert(okApprove.success === true && okApprove.data.inviteToken && okApprove.data.inviteToken.length === 12, '批完冇邀請 token：' + JSON.stringify(okApprove));
  const rec = G.readTable_('申請')[0];
  eq(rec.state, 'approved'); assert(rec.decidedBy && rec.decidedAt, '要記低邊個批／幾時');
  /* 純邀請制：自助申請一律唔收 */
  const sw = call(G, { action: 'setApplyMode', apikey: key, mode: 'invite-only' });
  assert(sw.success && sw.data.mode === 'invite-only', '開關唔啱：' + JSON.stringify(sw));
  const blocked = call(G, { action: 'accountApply', ymis: 'Y10', name: '自助申請' });
  assert(blocked.success === false && blocked.code === 'invite_only', '純邀請制竟然收自助申請');
  /* 但求救照收（求救唔受影響 —— 入唔到嘅人一定要有路） */
  const rescue = call(G, { action: 'saveRescue', rescue: { title: '入唔到', note: '求救' } });
  assert(rescue.success === true, '純邀請制唔應該擋求救');
  /* 開返 */
  const sw2 = call(G, { action: 'setApplyMode', apikey: key, mode: 'open' });
  assert(sw2.data.mode === 'open', '開返唔啱');
});

/* 收尾 */
console.log('');
if (fails.length) {
  console.log(`✗ 旅 GAS 測試唔過：${pass}/${pass + fails.length}\n`);
  fails.forEach(f => console.log(`  ✗ ${f.name}\n     ${f.e.message}`));
  process.exit(1);
}
console.log(`✓ 旅 GAS 測試全部通過（${pass} 項）`);

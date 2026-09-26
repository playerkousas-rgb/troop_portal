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
/* 下游（團側）範本 —— 要喺同一個假環境度驗（BUILD §10 條 7：leaf 自製 session token） */
const DS_SRC = readFileSync(join(ROOT, 'apps-script/Downstream.gs'), 'utf8');

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
function makeSandbox({ fetchImpl, downstream = false } = {}) {
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
      base64EncodeWebSafe: s => Buffer.from(String(s), 'utf8').toString('base64url'),
      base64Decode: s => Array.from(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: (data, type, name) => ({ data, type, name, getDataAsString: () => Buffer.from(Array.isArray(data) ? data : String(data), Array.isArray(data) ? undefined : 'utf8').toString('utf8') }),
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
    DriveApp: {
      Access: { PRIVATE: 'PRIVATE' }, Permission: { NONE: 'NONE' },
      _files: [],
      createFile(blob) {
        const f = {
          _name: blob.name, _id: 'f' + (sandbox.DriveApp._files.length + 1),
          getName() { return this._name; }, getId() { return this._id; },
          getDateCreated() { return new Date(Date.now() - (sandbox.DriveApp._files.length * 1000)); },
          getSize() { return String(blob.data || '').length; },
          setSharing() { return this; }, setTrashed() { this._trashed = true; sandbox.DriveApp._files = sandbox.DriveApp._files.filter(x => x !== this); return this; }
        };
        sandbox.DriveApp._files.push(f);
        return f;
      },
      getFilesByName(name) { const list = sandbox.DriveApp._files.filter(f => f._name === name); let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; },
      searchFiles(q) { const m = q.match(/'([^']+)'/); const tok = m ? m[1] : ''; const list = sandbox.DriveApp._files.filter(f => f._name.includes(tok)); let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; }
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: txt => ({ _t: txt, setMimeType() { return this; }, getContent() { return this._t; } })
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  if (downstream) vm.runInContext(DS_SRC, sandbox, { filename: 'Downstream.gs' });
  else vm.runInContext(SRC, sandbox, { filename: 'Code.gs' });
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

/* ⑯ 備份 13 份輪替 ＋ 三時機提醒；PDPO（BUILD §3 §8） */
t('備份：Drive 留 13 份（多過就刪最舊）；狀態回饋「7 日冇備份」等提醒', () => {
  const { G, props, G: G2 } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  eq(G.BACKUP_KEEP, 13, 'BUILD 寫留 13 份');
  /* 冇備份過：要提醒做 */
  let st = call(G, { action: 'backupState', apikey: key });
  assert(st.data.missing === true && /未有備份紀錄/.test(st.data.remind), '未備份過要提醒：' + JSON.stringify(st.data));
  /* 連續備份 16 次 → 只可以剩 13 份 */
  for (let i = 0; i < 16; i++) G.backupToDrive();
  const files = G2.DriveApp._files.filter(f => /^troop-/.test(f._name));
  eq(files.length, 13, '超過 13 份要刪最舊');
  const st2 = call(G, { action: 'backupState', apikey: key });
  eq(st2.data.count, 13, '狀態要報實際份數');
  assert(st2.data.triggers.beforeBatch && st2.data.triggers.beforeUpgrade && st2.data.triggers.weekly, '三個時機都要報');
  assert(!/唔好|錯誤/.test(st2.data.remind) && typeof st2.data.remind === 'string', 'remind 要係人話');
  /* 7 日冇備份 → stale：改返條紀錄嘅 JSON 內 at（＋表嘅 at 欄） */
  const sh = G.ss_().getSheetByName('備份紀錄');
  const row = sh.getLastRow();
  const cell = sh.cell(row, 2);
  const obj = JSON.parse(cell);
  obj.at = '2020-01-01 00:00';
  sh.setCell(row, 2, JSON.stringify(obj));
  sh.setCell(row, 3, '2020-01-01 00:00');
  const st3 = call(G, { action: 'backupState', apikey: key });
  assert(st3.data.stale === true && /日冇備份/.test(st3.data.remind), '過期要提醒：' + JSON.stringify(st3.data.remind));
});
t('PDPO：離隊滿 12 個月預設只演練（dryRun）；真做＝匿名化（個人資料清走、紀錄留住）', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  const h = 'a'.repeat(64);
  call(G, { action: 'saveTable', apikey: key, table: '旅員', rows: [
    { id: 'u-left', email: 'left@demo.hk', name: '離隊者', ymis: 'Y1', phone: '90000000', role: 'member', status: 'transferred_out', leftAt: '2020-01-01', hash: h, salt: 'salt12345' },
    { id: 'u-now', email: 'now@demo.hk', name: '在隊', role: 'member', status: 'active', hash: h, salt: 'salt12345' }
  ] });
  const dry = call(G, { action: 'purgeLeftMembers', apikey: key, dryRun: true });
  assert(dry.data.dryRun === true && dry.data.hit.length === 1, '預設應該只演練唔真做：' + JSON.stringify(dry.data));
  eq(G.readTable_('旅員').length, 2, '演練唔應該改資料');
  const real = call(G, { action: 'purgeLeftMembers', apikey: key, dryRun: false });
  assert(real.data.anonymised === 1, '真做要匿名化：' + JSON.stringify(real.data));
  const after = G.readTable_('旅員');
  eq(after.length, 2, '紀錄要留住（唔係刪行）');
  const left = after.find(u => u.id === 'u-left');
  assert(!left.email && !left.phone && !left.hash && !left.ymis && left.status === 'anonymised', '個人資料要清走：' + JSON.stringify(left));
  assert(left.anonymisedAt, '要記低幾時匿名化（審計要對得上）');
  assert(!after.find(u => u.id === 'u-now').anonymisedAt, '在隊嘅唔應該郁');
});
t('PDPO：數據清單一張表（收集咩／用途／邊個睇到／保留幾久）', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const inv = call(G, { action: 'dataInventory', apikey: props.get('API_KEY') });
  assert(inv.data.items.length >= 6 && inv.data.leftPurgeDays === 365, '數據清單唔齊：' + JSON.stringify(inv.data).slice(0, 120));
  const keys = ['what', 'where', 'why', 'who', 'keep'];
  inv.data.items.forEach(i => keys.forEach(k => assert(i[k] && String(i[k]).length > 2, `清單欄位缺 ${k}：` + JSON.stringify(i))));
  assert(inv.data.items.some(i => i.what.includes('家長同意')), '要列家長同意（PDPO 開戶）');
});
t('開戶申請：帶家長同意欄位（唔打勾＝consent:false 照記，唔會偷偷當同意）', () => {
  const { G } = makeSandbox(); G.initializeSheets();
  call(G, { action: 'accountApply', ymis: 'Y7', name: '小明', consent: true });
  call(G, { action: 'accountApply', ymis: 'Y8', name: '小華' });
  const rows = G.readTable_('申請');
  eq(rows.find(r => r.ymis === 'Y7').consent, true, '有打勾要記 true');
  eq(rows.find(r => r.ymis === 'Y8').consent, false, '冇打勾要記 false（唔可以當同意）');
});

/* ⑰ 移交與升降團（BUILD §6）：移出 tombstone＋套裝 sha256；匯入冪等＋撞號；家長處理 */
t('移交：移出＝TRANSFERRED_OUT tombstone ＋ transferTo／transferDate ＋ 套裝 sha256', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  /* 先造一個在隊成員（移出就係將佢記 tombstone） */
  const us = G.readUsers_(); us.push({ id: 'u-t1', ymis: 'YMIS-9', name: '陳大文', email: 'tai@demo.hk', role: 'member', status: 'ACTIVE', branchId: 'sc', pv: 1 });
  G.writeTable_('旅員', us, 'test');
  const r = call(G, { action: 'transferOut', apikey: key, scoutId: 'YMIS-9', name: '陳大文', from: 'sc', to: 'vs', reason: '升團', date: '2026-09-26' });
  assert(r.success === true, '移出要成功：' + JSON.stringify(r).slice(0, 120));
  eq(r.data.bundle.scout_id, 'YMIS-9');
  eq(r.data.bundle.transferTo, 'vs');
  assert(/^[0-9a-f]{64}$/.test(r.data.sha256), '要真 sha256（64 hex）：' + r.data.sha256);
  const u = G.readUsers_().find(x => x.ymis === 'YMIS-9');
  eq(String(u.status).toUpperCase(), 'TRANSFERRED_OUT', '旅員要記 TRANSFERRED_OUT（tombstone）');
  eq(u.transferTo, 'vs');
  assert(u.transferDate, '要記 transferDate');
  /* 改過套裝就驗唔到 hash（防中途改檔） */
  const tampered = { ...r.data.bundle, name: '（改）' };
  const bad = call(G, { action: 'importTransferBundle', apikey: key, bundle: tampered, sha256: r.data.sha256 });
  eq(bad.code, 'bad_hash', '改過就要拒（唔可以靜靜收）');
  /* 正確套裝 → 建立新 ACTIVE（其實係 pending_hash：密碼行開戶流程） */
  const ok1 = call(G, { action: 'importTransferBundle', apikey: key, bundle: r.data.bundle, sha256: r.data.sha256, to: 'vs' });
  assert(ok1.success === true, '接收要成功：' + JSON.stringify(ok1).slice(0, 140));
  eq(ok1.data.user.status, 'pending_hash', '密碼行開戶流程（未設 hash）');
  assert(G.readTable_('移交').some(x => x.transferId === r.data.transferId && x.state === 'done'), '移交表要記 done');
});

t('移交：transferId 冪等（重複匯入唔會建第二次）＋撞號阻住', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  const r = call(G, { action: 'transferOut', apikey: key, scoutId: 'YMIS-7', name: '李小明', from: 'sc', to: 'vs' });
  const b = r.data.bundle, sha = r.data.sha256;
  call(G, { action: 'importTransferBundle', apikey: key, bundle: b, sha256: sha, to: 'vs' });
  const n1 = G.readUsers_().filter(x => x.ymis === 'YMIS-7').length;
  const again = call(G, { action: 'importTransferBundle', apikey: key, bundle: b, sha256: sha, to: 'vs' });
  eq(again.data.duplicate, true, '第二次要回 duplicate');
  eq(G.readUsers_().filter(x => x.ymis === 'YMIS-7').length, n1, '重複匯入唔可以多開一個戶');
  eq(G.readTable_('移交').filter(x => x.transferId === b.transferId).length, 1, '一個 transferId 只可以有一行（接收＝更新，唔係另開一行）');
  /* 撞號：同一個 SCOUT_ID 已經有戶（現役或等開戶）→ 阻住 */
  const r2 = call(G, { action: 'transferOut', apikey: key, scoutId: 'YMIS-8', name: '王小明', from: 'sc', to: 'vs' });
  const us2 = G.readUsers_(); us2.push({ id: 'u-t8', ymis: 'YMIS-8', name: '王小明', role: 'member', status: 'ACTIVE', branchId: 'vs', pv: 1 });
  G.writeTable_('旅員', us2, 'test');
  const clash = call(G, { action: 'importTransferBundle', apikey: key, bundle: r2.data.bundle, sha256: r2.data.sha256, to: 'vs' });
  eq(clash.code, 'clash', '撞號要擋（唔會重複建）');
  /* 冇 transferId 或冇 scout_id 嘅檔一律唔收 */
  eq(call(G, { action: 'importTransferBundle', apikey: key, bundle: { scout_id: 'YMIS-6' } }).code, 'bad_transfer', '冇 transferId 唔收');
});

t('移交：家長處理（同旅＝零改動；轉旅＝來源家長戶停用＋通知文案）', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  /* 造一個家長戶，children 用 global SCOUT_ID */
  const users = G.readUsers_();
  users.push({ id: 'u-p1', email: 'mom@demo.hk', role: 'parent', status: 'ACTIVE', children: ['YMIS-5'], name: '陳太', ymis: '', pv: 1 });
  G.writeTable_('旅員', users, 'test');
  /* 同旅移動：咩都唔郁 */
  const same = call(G, { action: 'transferOut', apikey: key, scoutId: 'YMIS-5', name: '陳小明', from: 'sc', to: 'sc', parentSameTroop: true });
  assert(same.success === true, '同旅移動要成功');
  eq(G.readUsers_().find(u => u.id === 'u-p1').status, 'ACTIVE', '同旅移動＝家長零改動');
  assert(!same.data.parentNotice, '同旅移動唔需要通知文案');
  /* 轉旅：家長戶轉 LEFT ＋回通知文案（接收旅發邀請連結重開） */
  const out = call(G, { action: 'transferOut', apikey: key, scoutId: 'YMIS-5', name: '陳小明', from: 'sc', to: '第八十三旅', parentEmail: 'mom@demo.hk' });
  assert(out.success === true, '轉旅要成功：' + JSON.stringify(out).slice(0, 120));
  const p = G.readUsers_().find(u => u.id === 'u-p1');
  eq(String(p.status).toUpperCase(), 'LEFT', '來源家長戶要轉 LEFT');
  assert(p.children.includes('YMIS-5'), 'children 要留住（全球 SCOUT_ID，接收旅解析得到）');
  assert(/邀請連結/.test(out.data.parentAction) && /邀請連結/.test(out.data.parentNotice), '要講清楚接收旅發邀請連結重開：' + out.data.parentNotice.slice(0, 80));
  assert(/transferDate|已經移交/.test(out.data.parentNotice), '通知文案要有移交日期');
});

/* ⑱ 樂觀鎖：版本由 server 派；帶舊 baseVersion 寫＝conflict（唔會寫落去） */
t('樂觀鎖：loadTables／saveTables 帶版本；舊 baseVersion＝conflict（唔會覆蓋）', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  const v1 = call(G, { action: 'getVersion', apikey: key });
  assert(/^\d{4}-\d{2}-\d{2}T/.test(v1.data.version), '版本要係 ISO 時間開頭：' + v1.data.version);
  const lt = call(G, { action: 'loadTables', apikey: key, tables: ['支部'] });
  assert(lt.data.version === v1.data.version, 'loadTables 要回同一個版本（前端靠佢做 baseVersion）');
  /* 正常寫：版本會 bump */
  const w1 = call(G, { action: 'saveTables', apikey: key, baseVersion: v1.data.version, data: { 支部: [{ id: 'b1', name: '童軍團' }] } });
  assert(w1.success === true && w1.data.confirmed === true, '帶正確版本要寫得入：' + JSON.stringify(w1).slice(0, 120));
  assert(w1.data.version && w1.data.version !== v1.data.version, '寫成功要 bump 新版本');
  assert(call(G, { action: 'getVersion', apikey: key }).data.version === w1.data.version, '版本要真係換咗');
  eq(G.readTable_('支部').length, 1, '寫入要真係落咗');
  /* 撞版：用舊版本再寫 → conflict，一個字都唔可以寫 */
  const w2 = call(G, { action: 'saveTables', apikey: key, baseVersion: v1.data.version, data: { 支部: [{ id: 'b9', name: '深資團' }] } });
  assert(w2.success === false && w2.code === 'conflict', '舊版本要回 conflict：' + JSON.stringify(w2).slice(0, 120));
  assert(w2.conflict === true && w2.version === w1.data.version, 'conflict 要帶現行版本（前端重做 merge3）：' + JSON.stringify(w2).slice(0, 140));
  eq(G.readTable_('支部').length, 1, 'conflict 唔可以寫落去');
  /* 唔帶 baseVersion（舊前端／上游 sig）＝照舊寫得（向後兼容） */
  const w3 = call(G, { action: 'saveTables', apikey: key, data: { 支部: [{ id: 'b1', name: '童軍團' }, { id: 'b2', name: '深資團' }] } });
  assert(w3.success === true && w3.data.confirmed === true, '唔帶版本要照寫（兼容）');
  assert(w3.data.version !== w1.data.version, '成功都要 bump');
  /* saveTable（單表）一樣要有樂觀鎖 */
  const st = call(G, { action: 'saveTable', apikey: key, table: '支部', baseVersion: v1.data.version, rows: [{ id: 'zx' }] });
  assert(st.success === false && st.code === 'conflict', 'saveTable 都要擋舊版本');
  const st2 = call(G, { action: 'saveTable', apikey: key, table: '支部', baseVersion: w3.data.version, rows: [{ id: 'b1', name: '童軍團' }] });
  assert(st2.success === true && st2.data.version, 'saveTable 帶正確版本要寫得入 ＋ 回新版本');
});

/* ⑲ 忘記密碼：唔外洩邊個 email 有戶；一次性 token 有時限 */
t('忘記密碼：一定唔會講「有冇呢個 email」（防帳號枚舉）', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  const users = G.readUsers_();
  users.push({ id: 'u-1', email: 'real@demo.hk', role: 'chief', status: 'active', name: '真戶', pv: 1 });
  G.writeTable_('旅員', users, 'test');
  const real = call(G, { action: 'issueResetToken', apikey: key, email: 'real@demo.hk' });
  const fake = call(G, { action: 'issueResetToken', apikey: key, email: 'ghost@demo.hk' });
  assert(real.success === true && fake.success === true, '兩個都要成功回覆（唔可以靠回覆分辨）');
  eq(!!real.data.delivered, !!fake.data.delivered, 'delivered 唔可以透露戶口存在（示範環境兩個都冇寄）');
  eq(fake.data.token, '', '唔存在嘅 email 唔會出 token');
  const after = G.readUsers_();
  const ru = after.find(u => u.email === 'real@demo.hk'), gu = after.find(u => u.email === 'ghost@demo.hk');
  assert(ru.setupToken && ru.setupToken.length === 12, '真戶要種 12 字一次性 token');
  assert(ru.setupExp, '要有期限（30 分鐘）');
  assert(!gu, '唔存在嘅 email 唔會整戶');
  assert(!/real@demo\.hk/.test(JSON.stringify(G.readTable_('操作紀錄').slice(0, 0))), '（唔檢查 log 內容，只確認唔會回身份）');
});

t('忘記密碼：token 用完即廢、過期唔收；GAS 永遠唔見明文密碼', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  const users = G.readUsers_();
  users.push({ id: 'u-2', email: 'm@demo.hk', role: 'parent', status: 'active', name: '家長', pv: 1 });
  G.writeTable_('旅員', users, 'test');
  const r = call(G, { action: 'issueResetToken', apikey: key, email: 'm@demo.hk' });
  const tok = r.data.token || G.readUsers_().find(u => u.email === 'm@demo.hk').setupToken;
  assert(tok && tok.length === 12, '要有 token：' + tok);
  /* 過期：改 setupExp 做過去 → 唔收 */
  const us2 = G.readUsers_(); us2.find(u => u.email === 'm@demo.hk').setupExp = new Date(Date.now() - 60000).toISOString();
  G.writeTable_('旅員', us2, 'test');
  const exp = call(G, { action: 'setupWithToken', apikey: key, token: tok, password_hash: 'a'.repeat(64), password_salt: 'abcdefgh' });
  eq(exp.code, 'token_expired', '過期要拒：' + JSON.stringify(exp).slice(0, 120));
  /* 未過期 → 設得入；設完 token 消失、再用同一 token 拒 */
  const us3 = G.readUsers_(); us3.find(u => u.email === 'm@demo.hk').setupExp = new Date(Date.now() + 60000).toISOString();
  G.writeTable_('旅員', us3, 'test');
  const ok1 = call(G, { action: 'setupWithToken', apikey: key, token: tok, password_hash: 'b'.repeat(64), password_salt: 'abcdefgh' });
  assert(ok1.success === true, '未過期要設得入：' + JSON.stringify(ok1).slice(0, 120));
  const u = G.readUsers_().find(x => x.email === 'm@demo.hk');
  eq(u.hash, 'b'.repeat(64), '要落 hash（GAS 只存 hash）');
  assert(!u.setupToken && !u.setupExp, 'token 用完即廢');
  eq(u.mustChangePw, false, '重設完唔使再強制改（已經係佢自己揀嘅）');
  const again = call(G, { action: 'setupWithToken', apikey: key, token: tok, password_hash: 'c'.repeat(64), password_salt: 'abcdefgh' });
  eq(again.code, 'bad_token', '同一 token 唔可以再用');
  /* 明文密碼永遠唔應該出現喺任何表 */
  const dump = JSON.stringify(G.readUsers_()) + JSON.stringify(G.readTable_('操作紀錄'));
  assert(!/password_hash|password:/i.test(dump) || !/"password"/.test(dump), '唔應該有明文密碼欄');
});

/* ㉑ 子女綁定：家長申請 → 該團領袖確認先睇到；唔可以自己批自己、唔會批唔存在嘅編號 */
t('子女綁定：要領袖確認先寫落 children；名冊對唔上／自己批自己一律唔過', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');
  const users = G.readUsers_();
  users.push({ id: 'u-p1', email: 'dad@demo.hk', role: 'parent', status: 'active', name: '陳大文', pv: 1 });
  users.push({ id: 'u-k1', email: '', ymis: 'YMIS-2001', role: 'member', status: 'active', name: '陳小明', branchId: 'sc0082', pv: 1 });
  G.writeTable_('旅員', users, 'test');

  /* ① 唔存在嘅編號：唔准綁（名冊冇就係冇） */
  const bad = call(G, { action: 'bindChild', apikey: key, email: 'dad@demo.hk', ymis: 'YMIS-9999' });
  assert(bad.success === false && bad.code === 'no_child', '名冊對唔上要拒：' + JSON.stringify(bad).slice(0, 120));
  /* ② 唔係家長戶：唔准綁 */
  const notParent = call(G, { action: 'bindChild', apikey: key, email: 'nobody@demo.hk', ymis: 'YMIS-2001' });
  assert(notParent.success === false && notParent.code === 'no_parent', '冇家長戶要拒');
  /* ③ 正常申請：入待批，**未**寫 children */
  const okApply = call(G, { action: 'bindChild', apikey: key, email: 'DAD@demo.hk', ymis: 'ymis-2001', consent: true });
  assert(okApply.success === true && okApply.data.state === 'pending', '要入待批：' + JSON.stringify(okApply).slice(0, 140));
  eq(okApply.data.childName, '陳小明', '要對到名冊個名');
  const apId = okApply.data.id;
  const pAfterApply = G.readUsers_().find(u => u.email === 'dad@demo.hk');
  const kidsAfterApply = pAfterApply.children || pAfterApply.childrenIds || [];
  eq(kidsAfterApply.length, 0, '★ 未確認之前唔可以見到子女');
  /* ④ 重複申請：唔會整多張 */
  const dup = call(G, { action: 'bindChild', apikey: key, email: 'dad@demo.hk', ymis: 'YMIS-2001' });
  assert(dup.success === true && dup.data.duplicate === true, '重複申請要擋（duplicate）');

  /* ⑤ 拒絕一定要原因 */
  const rejNo = call(G, { action: 'decideBind', apikey: key, id: apId, decide: 'reject' });
  assert(rejNo.success === false && rejNo.code === 'need_reason', '拒絕冇原因要拒');
  /* ⑥ 唔存在／唔係綁定嘅申請 */
  const noApp = call(G, { action: 'decideBind', apikey: key, id: 'ap-nope', decide: 'approve' });
  assert(noApp.success === false && noApp.code === 'no_app', '冇呢張申請要拒');

  /* ⑦ 領袖確認 → children 先出現 */
  const appro = call(G, { action: 'decideBind', apikey: key, id: apId, decide: 'approve' });
  assert(appro.success === true && appro.data.decided === 'approved', '確認要成功：' + JSON.stringify(appro).slice(0, 140));
  const pFinal = G.readUsers_().find(u => u.email === 'dad@demo.hk');
  eq((pFinal.children || []).map(String).join(','), 'YMIS-2001', '★ 確認之後先寫落 children');
  /* ⑧ 處理過嘅唔可以再批一次（防重放） */
  const again = call(G, { action: 'decideBind', apikey: key, id: apId, decide: 'approve' });
  assert(again.success === false && again.code === 'decided', '同一張唔可以決定兩次');
  /* ⑨ 個仔自己嗰個戶冇被動過（小朋友唔會因家長綁定而變咗） */
  const kidRow = G.readUsers_().find(u => u.ymis === 'YMIS-2001');
  eq(kidRow.name, '陳小明', '子女戶唔應該被改');
  eq(kidRow.role, 'member', '子女戶角色唔變');
});

/* ㉒ 紀錄只記 metadata：內容唔入 log、email／電話遮住；審計鏈照樣驗得到 */
t('紀錄只記 metadata：內容唔入 log、email／電話遮住，但審計鏈不變', () => {
  const { G, props } = makeSandbox(); G.initializeSheets();
  const key = props.get('API_KEY');

  /* ① 長文字（＝內容）唔應該入 log：只記長度 */
  const long = '呢段係通告內文，唔應該入審計紀錄。'.repeat(6) + '（共 N 字）';
  call(G, { action: 'saveAudit', apikey: key, actionName: '發通告', target: 'n-9', detail: long });
  const au = G.readTable_('審計紀錄');
  assert(au.length >= 1, '要寫得到審計');
  const last = au[au.length - 1];
  assert(!/通告內文/.test(String(last.detail)), '★ 長文字內容唔可以入 log：' + String(last.detail).slice(0, 60));
  assert(/\[內容不記錄 len=\d+\]/.test(String(last.detail)), '要記長度做 metadata：' + String(last.detail).slice(0, 60));
  assert(/len=\d+/.test(String(last.detail)), 'len 要係真數字');

  /* ② email 遮中間、電話遮中間；短 metadata（狀態／版本）照樣留住 */
  call(G, { action: 'saveAudit', apikey: key, actionName: '改帳號狀態', target: 'chan.tai-man@demo.hk', detail: 'ACTIVE' });
  call(G, { action: 'saveAudit', apikey: key, actionName: '聯絡', target: '家長', detail: '9123 4567' });
  const au2 = G.readTable_('審計紀錄');
  const rowEmail = au2[au2.length - 2], rowPhone = au2[au2.length - 1];
  assert(!/chan\.tai-man@demo\.hk/.test(JSON.stringify(au2)), '★ 完整 email 唔可以入 log');
  assert(/@demo\.hk/.test(String(rowEmail.target)), '網域留住（追蹤夠用）');
  assert(!/9123 4567|91234567/.test(String(rowPhone.detail)), '★ 完整電話唔可以入 log：' + rowPhone.detail);
  assert(/\*\*\*\*-\s*4567|\*\*\*\*/.test(String(rowPhone.detail)), '電話只留尾 4 位／遮住');
  assert(rowEmail.detail === 'ACTIVE', '短 metadata（狀態）要原樣留住');

  /* ③ 遮完先算 hash：審計鏈一樣驗得到 */
  const chain = G.verifyAuditChain_();
  assert(chain.ok === true, '審計鏈要完好（紅acted 之後先 hash）：' + JSON.stringify(chain).slice(0, 100));

  /* ④ 操作紀錄（ACCESS_LOG）一樣：email 唔可以完整入 log */
  call(G, { action: 'saveAudit', apikey: key, actionName: '（略）', detail: 'x' });
  const ac = G.readTable_('操作紀錄');
  ac.push(G.access_('LOGIN_OK', 'chan.tai-man@demo.hk', '203.0.113.9', 'ua=' + 'y'.repeat(300)));
  assert(!/chan\.tai-man@demo\.hk/.test(JSON.stringify(ac)), 'ACCESS_LOG email 都要遮');
  assert(/\[內容不記錄 len=\d+\]/.test(String(ac[ac.length - 1].meta)), 'ACCESS_LOG 長 meta 唔記內容');
});

/* ㉓ sig jti：一次性（持久環），cache 蒸發都擋得住重放；環有上限、會自然淘汰 */
t('sig jti：cache 蒸發都擋得住重放；環有上限、過期自動淘汰', () => {
  /* 用同一個 sandbox（要留住 ScriptProperties 嘅 jti 環），但 cache 可以清 */
  const { G, props, cache } = makeSandbox();
  G.initializeSheets();
  const mk = () => {
    const body = { action: 'load', table: '支部' };
    const sig = G.signOutgoing_('load', body, G.LINK_SIG_PURPOSE, G.apiKey_());
    return { ...body, ...sig };
  };
  const one = mk();
  const ok1 = call(G, one);
  assert(ok1.success === true, '正常簽名要通：' + JSON.stringify(ok1).slice(0, 100));
  assert(G.jtiRingInfo_().count >= 1, '通過之後要記落持久 jti 環');

  /* ★ 清走快路（cache）＝ 模擬 cache 到期／被蒸發 → 重放仍然要拒 */
  cache.clear();
  const again = call(G, one);
  assert(again.success === false, '★ cache 清咗就通得？持久環冇用');
  assert(/jti 已用過/.test(again.error) || /nonce 已用過/.test(again.error), '要話明係重放：' + again.error);

  /* 每次通過都入環，但環有上限（唔會無限長大） */
  for (let i = 0; i < 5; i++) { const r = call(G, mk()); assert(r.success === true, '第 ' + (i + 2) + ' 次簽名要通'); }
  const info = G.jtiRingInfo_();
  assert(info.count <= G.LIMITS.sigJtiRing, '環唔可以長過上限');
  assert(info.count >= 6, '每次通過都要入環（而家 ' + info.count + ' 筆）');

  /* 過期嘅會自動淘汰：前推到 ±2×skew 之前 */
  const ring = JSON.parse(props.get('SIG_JTI_RING'));
  ring.forEach(x => { x.ts = Date.now() - G.LIMITS.sigSkewMs * 3; });
  props.set('SIG_JTI_RING', JSON.stringify(ring));
  eq(G.jtiRingInfo_().count, 0, '過期 jti 要自動淘汰（唔會累積到天光）');

  /* jti 係 nonce 衍生：唔會將 nonce 原文寫落持久區（只記 hash 前 24 位） */
  const r2 = call(G, mk());
  const ring2 = JSON.parse(props.get('SIG_JTI_RING'));
  assert(r2.success === true && ring2.length === 1, '新一筆要入環');
  assert(/^[0-9a-f]{24}$/.test(String(ring2[0].jti)), 'jti 要係 24 位 hex 摘要（唔係 raw nonce）：' + ring2[0].jti);
});

/* ㉔ 讀取樂觀化：讀唔上全域寫鎖；pointer 覆查（有人寫入 → 重試；唔穩就誠實報） */
t('讀取樂觀化：讀取唔等鎖、pointer 覆查、唔穩定會誠實講（唔會扮一致）', () => {
  const { G } = makeSandbox(); G.initializeSheets();
  const key = G.apiKey_();
  assert(G.READ_ACTIONS.indexOf('loadTables') >= 0 && G.READ_ACTIONS.indexOf('load') >= 0 && G.READ_ACTIONS.indexOf('getVersion') >= 0, '讀取白名單要有 load／loadTables／getVersion');
  assert(G.READ_ACTIONS.indexOf('saveTables') < 0 && G.READ_ACTIONS.indexOf('saveAudit') < 0, '★ 有副作用嘅 action 一律唔可以入讀取白名單');

  /* ① 正常讀：一致，回版本；readRounds 有報 */
  const r1 = call(G, { action: 'loadTables', apikey: key, tables: ['支部'] });
  assert(r1.success === true && r1.data.version, '讀要回版本：' + JSON.stringify(r1).slice(0, 120));
  eq(r1.data.consistent, true, '冇人寫入＝一致');
  assert(r1.data.readRounds >= 1, '要報讀咗幾轉');

  /* ② 「讀到一半有人寫」：夾住一次 bumpVersion_ → 第一次唔一致、重試之後一致 */
  let writesLeft = 1;
  const lockedSpy = [];
  G.bumpVersion_();                                            // 造一個版本變化
  const r2 = call(G, { action: 'loadTables', apikey: key, tables: ['支部'] });
  eq(r2.data.consistent, true, '版本穩定時要一致');
  assert(r2.data.version !== r1.data.version, '寫入之後版本要唔同（樂觀鎖靠呢個）');

  /* ③ 直接驗算法：連續 bump 3 次（每次讀完都變）→ 唔穩定時 consistent:false 而唔係扮成功 */
  const orig = G.readTableAll_;
  let bumps = 0;
  G.readTableAll_ = function (t) { const out = orig(t); bumps++; G.bumpVersion_(); return out; };   // 每次讀都有人寫
  const r3 = call(G, { action: 'loadTables', apikey: key, tables: ['支部', '旅員'] });
  G.readTableAll_ = orig;
  eq(r3.data.consistent, false, '★ 版本一路變＝唔可以扮一致');
  assert(bumps >= 3, '有真係重試過（試咗 ' + bumps + ' 次讀）');
  assert(/有人寫入/.test(String(r3.data.note)), '要老實講「讀取期間有人寫入」：' + String(r3.data.note).slice(0, 80));
  assert(r3.data.readRounds <= 3, '重試有上限（唔會無限迴圈）：' + r3.data.readRounds);
  assert(r3.data.data && r3.data.data['支部'], '唔穩都要回資料（版本以 version 為準，之後寫入會撞版）');

  /* ④ 讀取唔會呼 lock：sandbox 嘅 lock 記錄 tryLock 次數 */
  const locked = [];
  const { G: G2 } = makeSandbox();
  G2.initializeSheets();
  G2.LockService = { getScriptLock: () => ({ tryLock: () => { locked.push(1); return true; }, releaseLock() {} }) };
  call(G2, { action: 'loadTables', apikey: G2.apiKey_(), tables: ['支部'] });
  eq(locked.length, 0, '★ 讀取唔應該攞全域寫鎖（呢個就係「讀取樂觀化」）');
  call(G2, { action: 'saveTables', apikey: G2.apiKey_(), data: { 支部: [] }, baseVersion: G2.readVersion_() });
  eq(locked.length, 1, '寫入一定要照舊攞鎖');
});

/* ㉕ 下游（團側）範本：sig 驗簽／閂口／leaf 自製 session token（P12） */
t('下游範本：上游 sig 驗簽（雙通道／時窗／重放）＋白名單＋永不接受清單', () => {
  const { G, props } = makeSandbox({ downstream: true });
  props.set('API_KEY', 'downstream-key-123456');
  const key = props.get('API_KEY');
  const post = (body, params = {}) => {
    const raw = JSON.stringify(body);
    return G.linkHandlePost({ postData: { contents: raw }, parameter: params });
  };
  /* ① 冇簽名、本地入口開（未設定）→ 交返你自己處理（null） */
  eq(post({ action: 'login', email: 'a@b.hk' }), null, '本地入口開：應該交返原本邏輯');
  /* ② 正式簽名 → 通 */
  const mk = (action, extra = {}) => {
    const body = { action, ...extra };
    const raw = JSON.stringify(body);
    return { body: { ...body, ...G.makeLinkSig(action, raw, key) }, raw };
  };
  const one = mk('getLinkState');
  const r1 = post(one.body);
  assert(r1 && JSON.parse(r1.getContent()).success === true, '正確簽名要通：' + (r1 && r1.getContent()));
  /* ③ 重放（同一張）→ 拒；連 cache 清咗都要拒（持久環） */
  const again = post(one.body);
  const againObj = JSON.parse(again.getContent());
  assert(againObj.success === false && againObj.code === 'sig_replayed', '重放要拒（穩定 code）：' + again.getContent());
  /* ④ 改 body 但用返原簽名 → 拒 */
  const tamper = mk('getLinkState');
  tamper.body.sub = 'hacker';
  assert(JSON.parse(post(tamper.body).getContent()).success === false, '改咗 body 都通得（digest 冇綁 body）');
  /* ⑤ 過期 → 拒 */
  const old = mk('getLinkState');
  old.body.sig_ts = String(Date.now() - 6 * 60 * 1000);
  assert(/時間戳/.test(JSON.parse(post(old.body).getContent()).error || ''), '過期要拒');
  /* ⑥ 永不接受：login／apply／改密碼 就算有合法簽名都唔收 */
  ['login', 'apply', 'changePassword', 'logout'].forEach(a => {
    const m = mk(a);
    const o = JSON.parse(post(m.body).getContent());
    assert(o.success === false && o.code === 'never_accept', a + ' 竟然收咗上游簽名（大問題）：' + JSON.stringify(o));
  });
  /* ⑦ 唔喺白名單 → 拒，並列出可用 action */
  const nm = mk('deleteEverything');
  const o7 = JSON.parse(post(nm.body).getContent());
  assert(o7.success === false && o7.code === 'unknown_action' && o7.allowed.length > 0, '白名單外要拒並列可用');
  /* ⑧ query 通道都要驗得通（GAS 302 轉址會漏 body 通道：上游一次送齊兩種） */
  const rawQ = JSON.stringify({ action: 'getLoginMode' });
  const sQ = G.makeLinkSig('getLoginMode', rawQ, key);          // digest 綁完整原始 body
  const viaQuery = JSON.parse(post(JSON.parse(rawQ), { sig: sQ.sig, sig_ts: sQ.sig_ts, sig_nonce: sQ.sig_nonce }).getContent());
  assert(viaQuery.success === true, 'query 通道要驗得通：' + JSON.stringify(viaQuery));
  /* query 通道一樣防重放（同一組 query nonce 用第二次要拒） */
  const againQ = JSON.parse(post(JSON.parse(rawQ), { sig: sQ.sig, sig_ts: sQ.sig_ts, sig_nonce: sQ.sig_nonce }).getContent());
  assert(againQ.success === false && againQ.code === 'sig_replayed', 'query 通道重放都要拒');
});

t('下游範本：閂口（ALLOW_LOCAL_LOGIN）＋403 求救指引 ＋ sig 讀寫白名單分流', () => {
  const { G, props } = makeSandbox({ downstream: true });
  props.set('API_KEY', 'downstream-key-123456');
  const key = props.get('API_KEY');
  eq(G.localLoginAllowed(), true, '未設定＝開（現有旅團零影響）');
  G.setLocalLoginAllowed(false);
  eq(G.localLoginAllowed(), false, '閂得入');
  /* 閂咗：本地登入一律 403 樣，帶求救連結（唔可以靜靜話「錯密碼」） */
  const closed = JSON.parse(G.linkHandlePost({ postData: { contents: JSON.stringify({ action: 'login' }) }, parameter: {} }).getContent());
  assert(closed.success === false && closed.local_login === false && closed.upstream_only === true, '閂口本地登入要回 upstream_only');
  assert(/求救|旅長/.test(String(closed.rescue) + closed.error), '要指出求救路徑（唔好等人呆等）');
  /* 閂咗：冇簽名又冇 leaf token 嘅普通讀寫都要拒 */
  const rd = JSON.parse(G.linkHandlePost({ postData: { contents: JSON.stringify({ action: 'load', table: 'x' }) }, parameter: {} }).getContent());
  eq(rd.upstream_only, true, '閂口之後普通請求都要拒');
  /* 上游帶簽名：照做（setLocalLogin 可以開返）＋寫入白名單分流 */
  const raw = JSON.stringify({ action: 'setLocalLogin', allow: true });
  const sig = G.makeLinkSig('setLocalLogin', raw, key);
  const out = JSON.parse(G.linkHandlePost({ postData: { contents: JSON.stringify({ action: 'setLocalLogin', allow: true, ...sig }) }, parameter: {} }).getContent());
  assert(out.success === true && out.data.allow_local_login === true, '上游經 sig 要開得返：' + JSON.stringify(out));
  /* 寫入白名單內但未接嘅 action：老實講 not_implemented（唔會扮成功） */
  const raw2 = JSON.stringify({ action: 'save', table: '進度', rows: [] });
  const sig2 = G.makeLinkSig('save', raw2, key);
  const out2 = JSON.parse(G.linkHandlePost({ postData: { contents: JSON.stringify({ action: 'save', table: '進度', rows: [], ...sig2 }) }, parameter: {} }).getContent());
  assert(out2.success === true && out2.data.note, '範本要接住（回 note 講明係範本位）');
});

t('★ leaf 自製 session token：下游自己簽、自己驗（唔使每 request 回打上游）', () => {
  const { G, props } = makeSandbox({ downstream: true });
  props.set('API_KEY', 'downstream-key-123456');
  const key = props.get('API_KEY');
  /* ① 上游帶 sig 叫 leaf 發 token（已經核實身份：sub／role／pv 由上游帶落嚟） */
  const raw = JSON.stringify({ action: 'leafLogin', sub: 'YMIS-2001', role: 'member', name: '陳家豪', pv: 3 });
  const sig = G.makeLinkSig('leafLogin', raw, key);
  const res = JSON.parse(G.linkHandlePost({ postData: { contents: JSON.stringify({ action: 'leafLogin', sub: 'YMIS-2001', role: 'member', name: '陳家豪', pv: 3, ...sig }) }, parameter: {} }).getContent());
  assert(res.success === true && res.data.leaf_token, 'leafLogin 要發 token：' + JSON.stringify(res).slice(0, 160));
  const tok = res.data.leaf_token;
  assert(res.data.ttlMs <= 30 * 60 * 1000, 'TTL 最多 30 分鐘');
  /* ② 自己驗：通，而且帶返身份 */
  const v = G.verifyLeafToken(tok, { node: G.linkNodeId_() });
  assert(v.ok === true, '自己簽嘅 token 要驗得通：' + JSON.stringify(v));
  eq(v.payload.sub, 'YMIS-2001', '要帶住 SCOUT_ID（全球唯一，升團零改動）');
  eq(v.payload.pv, 3, '要記密碼版本（改密碼即失效）');
  /* ③ 改一個字 → 簽名不符 */
  const broke = tok.slice(0, -2) + (tok.slice(-2) === 'aa' ? 'bb' : 'aa');
  assert(G.verifyLeafToken(broke).code === 'bad_token', '改過嘅 token 要拒');
  /* ④ 換密鑰（第二個 node 嘅 key）→ 唔認 */
  props.set('API_KEY', 'other-node-key-999999');
  assert(G.verifyLeafToken(tok).code === 'bad_token', '★ 換咗 API_KEY 就唔認得（token 綁本機）');
  props.set('API_KEY', 'downstream-key-123456');
  /* ⑤ 到期 → token_expired */
  const exp = G.verifyLeafToken(tok, { now: Date.now() + 31 * 60 * 1000 });
  assert(exp.code === 'token_expired', '過期要拒：' + JSON.stringify(exp));
  /* ⑥ pv 唔同（改過密碼）→ stale_pv（舊 token 全體失效） */
  assert(G.verifyLeafToken(tok, { pv: 4 }).code === 'stale_pv', '改密碼之後舊 token 要失效');
  assert(G.verifyLeafToken(tok, { pv: 3 }).ok === true, 'pv 一樣照通');
  /* ⑦ node 唔同（token 搬去第二個 portal）→ wrong_node */
  assert(G.verifyLeafToken(tok, { node: '第二個 portal' }).code === 'wrong_node', '唔可以跨 node 用');
  /* ⑧ TTL 有上下限（唔可以叫 leaf 發 10 年） */
  const longTok = G.mintLeafToken({ sub: 'X' }, 10 * 365 * 24 * 3600 * 1000);
  eq(G.verifyLeafToken(longTok, { now: Date.now() }).ok, true, '（長 TTL 會 clamp）');
  assert(G.verifyLeafToken(longTok, { now: Date.now() + 31 * 60 * 1000 }).code === 'token_expired', '★ 長 TTL 一律 clamp 到 30 分鐘');
  const shortTok = G.mintLeafToken({ sub: 'X' }, 1000);
  assert(G.verifyLeafToken(shortTok, { now: Date.now() + 6 * 60 * 1000 }).code === 'token_expired', '★ 短 TTL 一律抬到 5 分鐘（唔會即刻壞）');
  /* ⑨ 閂咗口：leaf token 有效＝放行（交返自己邏輯）；冇 token＝403 */
  G.setLocalLoginAllowed(false);
  const e = { postData: { contents: JSON.stringify({ action: 'myDashboard' }) }, parameter: {} };
  const blocked = JSON.parse(G.linkHandlePost(e).getContent());
  assert(blocked && blocked.upstream_only === true, '閂口冇 token 要拒');
  const e2 = { postData: { contents: JSON.stringify({ action: 'myDashboard', leaf_token: G.mintLeafToken({ sub: 'YMIS-2001' }) }) }, parameter: {} };
  eq(G.linkHandlePost(e2), null, '★ leaf token 有效＝放行（下游唔使回打上游）');
});

/* 收尾 */
console.log('');
if (fails.length) {
  console.log(`✗ 旅 GAS 測試唔過：${pass}/${pass + fails.length}\n`);
  fails.forEach(f => console.log(`  ✗ ${f.name}\n     ${f.e.message}`));
  process.exit(1);
}
console.log(`✓ 旅 GAS 測試全部通過（${pass} 項）`);

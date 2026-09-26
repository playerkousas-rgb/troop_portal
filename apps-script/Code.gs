/* ============================================================================
   旅系統 · Code.gs（旅 SHEET 後端 · P0）
   ----------------------------------------------------------------------------
   呢份係「旅」自己嘅 Apps Script：一個節點同時可以係上游（對自己下游）同
   下游（對自己上游）。

   單一來源：**呢個檔就係來源**（手寫、貼上 GAS 就直接跑；冇生成器、冇 build step）。
   守護：`scripts/gas-test.mjs`（Node 假 Apps Script 環境）釘死下面所有鐵律；
        唔好為咗「生成器」多開一個來源 —— §4.1 講嘅「單一來源」＝呢一份，唔係兩份要同步。

   對齊：建構計劃 §4（sig／registry／白名單）、§5（逐表寫）、§6.3（action）、
        §6.6（問題回報唔經呢支 GAS → 由 Vercel /api/proxy 送）。
   鐵律：
     · ABCD（SUPER_KEY／BACKEND／NAME／APIKEY）**一律唔寫入任何 Sheet**
     · registry 只住 ScriptProperties（唔建 TROOP_OPS、唔喺 Sheet）
     · 逐表寫：只寫有改嘅表、先寫新後刪舊、寫完即刻讀返自證（confirmed）
     · 讀取回應**永不含** password_hash／salt／apiKey／/exec／DOWNSTREAM_*
     · 一律 POST；sig 只喺 POST body／query 出現，唔收 GET 帶 sig
     · 下游永遠唔主動回打上游（全倉掃「回調類 API」零命中；本檔連字眼都唔會出現）
   ============================================================================ */

/* ------------------------------ 常數 -------------------------------------- */
var APP = { name: '旅系統', version: 'v0.2.0-gas-p0' };

/** 下游 sig 用途（本 repo 一條；readme §12 ①） */
var LINK_SIG_PURPOSE = 'troopportal-troop-sig-v1';

/** 中央登入票據驗證端點（寫死一行；建構計劃 §4.6 ①） */
var SUPER_VERIFY_URL = 'https://troop-portal.vercel.app/api/super';

/** 每次寫入上限（B／D 唔落 Sheet，所以只係防呆） */
var LIMITS = { body: 900 * 1024, rowsPerWrite: 20000, importRows: 2000, loginFails: 5, lockMs: 15 * 60 * 1000, sigSkewMs: 5 * 60 * 1000, anonWrites: 3, anonWindowSec: 3600, sigJtiRing: 200, maxParts: 40 };

/** 匿名可寫面（BUILD §3／§10-5）：**只可以 append、有數量上限、寫入待批表**；其他一律要 apikey／sig
    通告報名（同通告同人去重）／物資借用／收支申報／進度申報／開戶申請／求救 */
var ANON_WRITE_ACTIONS = ['saveRescue', 'noticeSignup', 'borrowApply', 'financeApply', 'progressApply', 'accountApply'];
/** 匿名申報類要落 `申請` 待批表嘅種類（求救另有自己一張表） */
var ANON_APPLY_KINDS = { signup: 'signup', borrow: 'borrow', finance: 'finance', progress: 'progress', account: 'account' };
var ANON_MAX_ROWS = { title: 120, note: 2000, name: 60, contact: 80, ymis: 20 };

/** 匿名寫入限流：求救（急，但唔可以灌）同一般申請分開計（CacheService；超額＝誠實拒） */
var ANON_QUOTA = { rescue: 3, apply: 10 };        // 每 IP 每個鐘
function anonQuotaOk_(ip, family) {
  var fam = family === 'rescue' ? 'rescue' : 'apply';
  var max = ANON_QUOTA[fam];
  var k = 'anonw_' + fam + '_' + ip, n = Number(cache_().get(k) || 0);
  if (n >= max) return { ok: false, used: n, max: max, family: fam };
  cache_().put(k, String(n + 1), LIMITS.anonWindowSec);
  return { ok: true, used: n + 1, max: max, family: fam };
}

/** 泛用表（每個一張分頁；每行 = 一筆 JSON，header 固定） */
var TABLES = [
  '旅員', '支部', '模組開關', '財務整合', '物資整合', '旅通告', '旅行事曆', '公開資料',
  '分享', '求救', '邀請', '申請', '移交', '教材', '進度摘要', '備份紀錄', '設定值'
];

/** append-only 紀錄（固定欄位；24 個月後 purge） */
var LOGS = {
  '審計紀錄': ['id', 'at', 'actor', 'role', 'identity', 'branchId', 'action', 'target', 'detail', 'via', 'prev_hash', 'hash'],
  '操作紀錄': ['id', 'at', 'kind', 'email', 'ip', 'meta'],
  '同步紀錄': ['id', 'at', 'mode', 'tables', 'version', 'confirmed', 'ms']
};

var TABLE_HEADER = ['id', 'json', 'at', 'by'];

/** 讀 action 白名單（上游可以讀下游；本 GAS 亦用嚟自證） */
var READ_ACTIONS = ['load', 'loadTables', 'getLoginMode', 'getLinkState', 'getSummary', 'getMembers', 'getConfig',
  'getAllUsers', 'getNotices', 'getFinance', 'getInventory', 'getCalendar', 'getPublicProfile', 'getApplications', 'getAuditLog'];

/** 寫 action 白名單（上游可以寫下游） */
/* ★ 讀取樂觀化（BUILD §10 條 7）：**讀唔使等全域寫鎖**。
   白名單以外嘅 action 一律照舊上鎖（保守：唔會靜靜放行有副作用嘅嘢）。
   讀取用「pointer 覆查」代替上鎖：讀 version → 讀資料 → 再讀 version，
   兩次一樣＝讀到嘅一定係同一版；唔一樣就重試，仍然唔穩就誠實回報
   `consistent:false`（前端有樂觀鎖＋backoff 兜住）。 */
var READ_ACTIONS = ['status', 'dbInfo', 'load', 'loadTables', 'getVersion'];

var WRITE_ACTIONS = ['save', 'saveTable', 'saveTables', 'upsertUser', 'importUsers', 'addMember', 'bulkAddUsers',
  'resetPassword', 'updateUserProfile', 'setUserStatus', 'deleteUser', 'updateUserRole', 'updatePermissions',
  'saveNotice', 'saveFinanceEntry', 'setLocalLogin', 'setGate'];

/** 永不接受（即使有 sig）—— 呢啲永遠只可以由該單位自己嘅登入流程做 */
var NEVER_ACCEPT = ['apply', 'logout', 'updateConfig', 'requestLogRecord', 'cancelLogRequest'];

/** 本 GAS 對外 action（前端只會經 Vercel /api/proxy 打呢啲） */
var ACTIONS = ['status', 'dbInfo', 'load', 'loadTables', 'saveTables', 'saveTable', 'authUser', 'login', 'superLogin',
  /* 上游（平台／旅）讀寫 action（＝ READ_ACTIONS／WRITE_ACTIONS 對本機嘅版本） */
  'getLinkState', 'getLoginMode', 'getAllUsers', 'getMembers', 'getNotices', 'getFinance', 'getInventory',
  'getCalendar', 'getPublicProfile', 'getApplications', 'getConfig', 'getSummary', 'getAuditLog',
  'save', 'importUsers', 'upsertUser', 'addMember', 'bulkAddUsers', 'updateUserProfile', 'updateUserRole',
  'updatePermissions', 'resetPassword', 'setUserStatus', 'deleteUser', 'saveNotice', 'saveFinanceEntry',
  'registry', 'setUnitStatus', 'saveShare', 'saveRescue',
  'changePassword', 'createInvite', 'redeemInvite', 'listInvites', 'revokeInvite',
  'getDownstreams', 'registerDownstream', 'testDownstream', 'updateDownstream', 'removeDownstream', 'setDownstreamApi',
  'setLocalLogin', 'openAccountForDownstream', 'listModules', 'setModule', 'exportAll', 'importAll',
  'saveAudit', 'logAccess', 'getAuditLog', 'getAccessLog', 'purgeOldLogs', 'backupToDrive', 'setupWithToken',
  'registry', 'setUnitStatus', 'saveShare', 'saveRescue', 'deleteRow', 'getTombstones', 'saveDbPart', 'purgeTombstones',
  'noticeSignup', 'borrowApply', 'financeApply', 'progressApply', 'accountApply', 'decideApplication', 'setApplyMode', 'getApplyMode',
  'backupState', 'purgeLeftMembers', 'dataInventory', 'getVersion', 'issueResetToken',
  /* P4：移交與升降團（BUILD §6） */
  'transferOut', 'importTransferBundle',
  /* P6b：家長子女綁定（要該團領袖確認先睇到） */
  'bindChild', 'decideBind'];

/** 需要 apikey（＝server 側）嘅敏感 action */
var SERVER_ONLY = ['authUser', 'dbInfo', 'exportAll', 'importAll', 'backupToDrive', 'purgeOldLogs', 'issueResetToken'];

/* --------------------------- 小工具 -------------------------------------- */
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function props_() { return PropertiesService.getScriptProperties(); }
/* --------------------------- 資料版本（樂觀鎖 · BUILD §3 §10 條 7） ----------------------
   版本由 **server** 派（唔係前端自己作）：格式＝ISO 時間 + 隨機尾數（同一秒都分得開）。
   寫入帶 baseVersion：唔等於現行版本＝有人搶先寫 → 回 conflict（唔會寫落去）。
   讀（load／loadTables）會回 version；前端用佢做下次寫入嘅 baseVersion。 */
function readVersion_() {
  var v = props_().getProperty('DB_VERSION');
  if (!v) { v = makeVersion_(); props_().setProperty('DB_VERSION', v); }
  return v;
}
function makeVersion_() {
  return new Date().toISOString().replace('Z', '') + '-' + Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
}
/** 寫入前檢查：有帶 baseVersion 而對唔上＝conflict（回報現行版本俾前端重做 merge3） */
function versionCheck_(baseVersion) {
  var cur = readVersion_();
  if (baseVersion && String(baseVersion) !== cur) return { ok: false, cur: cur };
  return { ok: true, cur: cur };
}
function bumpVersion_() {
  var v = makeVersion_(); props_().setProperty('DB_VERSION', v); return v;
}
function cache_() { return CacheService.getScriptCache(); }
function now_() { return new Date(); }
function stamp_(d) {
  d = d || now_();
  var p = function (n) { return ('0' + n).slice(-2); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
/** 解析 `YYYY-MM-DD HH:mm`（我哋自己 stamp_ 嘅格式）→ 毫秒；解析唔到回 NaN（唔會當「好舊」而誤清） */
function parseStamp_(s) {
  var t = String(s || '').trim();
  if (!t) return NaN;
  var ms = Date.parse(t.replace(' ', 'T'));                 // 2026-09-26T10:30（本地時間）
  if (isFinite(ms)) return ms;
  ms = Date.parse(t.replace(/\//g, '-'));                   // 容忍 2026/09/26 10:30
  return ms;
}
function uid_(prefix) { return (prefix || 'x') + '-' + new Date().getTime().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
function sha256Hex_(s) { return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)); }
function bytesToHex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) { var v = (bytes[i] + 256) % 256; out += ('0' + v.toString(16)).slice(-2); }
  return out;
}
/** 標籤消毒：只留 0-9A-Za-z_.@-（防儲存格算式注入） */
function sanitizeLabel_(v) { return String(v == null ? '' : v).replace(/[^0-9A-Za-z_.@-]/g, '').slice(0, 64); }
function isHex64_(s) { return typeof s === 'string' && /^[0-9a-f]{64}$/.test(s); }
function normId_(v) { var s = String(v == null ? '' : v).trim().toUpperCase(); var m = s.match(/^(\d+)([A-Z]*)$/); return m ? m[1].replace(/^0+(?=\d)/, '') : s; }
function truthy_(v) { return v === true || v === 'true' || v === 1 || v === '1'; }
function json_(obj) { return JSON.stringify(obj); }
function parseJson_(s, fallback) { try { return JSON.parse(s); } catch (e) { return fallback === undefined ? null : fallback; } }

/* --------------------------- 回應格式 ------------------------------------ */
function ok_(data, note) { var o = { success: true, data: data === undefined ? null : data, at: stamp_() }; if (note) o.note = note; return o; }
function err_(code, msg, extra) { var o = { success: false, error: msg, code: code || 'error', at: stamp_() }; if (extra) { for (var k in extra) o[k] = extra[k]; } return o; }
function out_(res, obj) { res.setContentType('application/json').setHeader('X-Frame-Options', 'DENY'); return res; }

/* --------------------------- 選單 ---------------------------------------- */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('🔗 旅系統')
    .addItem('① 初始化（建分頁＋種入第一個旅長）', 'menuInitialize')
    .addItem('② 🔑 顯示 BACKEND／APIKEY（交 ADMIN）', 'menuShowKeys')
    .addItem('③ 🔎 本機 sig 用途字串', 'menuShowPurpose')
    .addSeparator()
    .addItem('➕ 登記下游（URL＋KEY＋NAME）', 'menuRegisterDownstream')
    .addItem('📡 測試下游連線（sig）', 'menuTestDownstream')
    .addItem('✏️ 改顯示名／改 API 版本', 'menuUpdateDownstream')
    .addItem('🚪 下游直接入口（閂口／開啟）', 'menuToggleGate')
    .addItem('👤 為下游開戶', 'menuOpenAccount')
    .addItem('🗑 移除下游', 'menuRemoveDownstream')
    .addSeparator()
    .addItem('🧾 後端實況（dbInfo）', 'menuDbInfo')
    .addItem('📤 匯出 JSON（含 hash）', 'menuExport')
    .addItem('💾 備份去 Drive（私密）', 'menuBackup')
    .addItem('🧹 清理 24 個月前紀錄', 'menuPurge')
    .addToUi();
}

function menuInitialize() { var r = initializeSheets(); SpreadsheetApp.getUi().alert(r.msg || json_(r)); }
function menuShowKeys() {
  var p = props_();
  var url = ScriptApp.getService().getUrl();
  var key = p.getProperty('API_KEY') || '（未生成 —— 先執行一次 setupApiKey）';
  SpreadsheetApp.getUi().alert('BACKEND（B）:\n' + url + '\n\nAPIKEY（D，只交 ADMIN，唔好落前端）:\n' + key + '\n\n同時放去平台 registry 嘅 Vercel env（TROOP_<旅ID>_BACKEND／_APIKEY）。');
}
function menuShowPurpose() { SpreadsheetApp.getUi().alert('本機 sig 用途字串（purpose）：\n' + LINK_SIG_PURPOSE + '\n\n上游（平台／旅）登記下游時會照抄呢一句；填錯＝測試連線會即刻報「簽名不符」。'); }
function menuDbInfo() { SpreadsheetApp.getUi().alert(json_(dbInfo())); }
function menuExport() { SpreadsheetApp.getUi().alert(JSON.stringify(exportAll()).slice(0, 4000)); }
function menuBackup() { var r = backupToDrive(); SpreadsheetApp.getUi().alert(r.msg || json_(r)); }
function menuPurge() { var r = purgeOldLogs(); SpreadsheetApp.getUi().alert(r.msg || json_(r)); }

function menuRegisterDownstream() {
  var ui = SpreadsheetApp.getUi();
  var id = ui.prompt('下游 id（英數／底線／連字號，最長 32）').getResponseText();
  var url = ui.prompt('下游 /exec URL（必須 https://script.google.com/macros/s/…/exec）').getResponseText();
  var key = ui.prompt('下游 SHEET KEY（D）').getResponseText();
  var name = ui.prompt('顯示名（例：82旅 童軍團）').getResponseText();
  var purpose = ui.prompt('sig 用途字串（唔知就照本機嗰條）', ui.ButtonSet.OK_CANCEL, LINK_SIG_PURPOSE).getResponseText();
  var r = registerDownstream({ id: id, url: url, key: key, name: name, purpose: purpose });
  ui.alert(r.ok ? '已登記' : ('失敗：' + r.msg));
}
function menuTestDownstream() {
  var ui = SpreadsheetApp.getUi();
  var id = ui.prompt('要測試邊個下游 id').getResponseText();
  var r = testDownstream(id);
  ui.alert(r.ok ? ('通 ✅ ' + (r.msg || '')) : ('唔通 ❌ ' + r.msg));
}
function menuUpdateDownstream() {
  var ui = SpreadsheetApp.getUi();
  var id = ui.prompt('下游 id').getResponseText();
  var name = ui.prompt('新顯示名（留空＝唔改）').getResponseText();
  var api = ui.prompt('該下游 action set 版本（例 v1；留空＝唔改）').getResponseText();
  ui.alert(json_(updateDownstream({ id: id, name: name, api: api })));
}
function menuToggleGate() {
  var ui = SpreadsheetApp.getUi();
  var id = ui.prompt('下游 id').getResponseText();
  var want = ui.prompt('閂定開？（填 close ＝閂「支部系統自己登入」；開 ＝open）').getResponseText();
  var r = setLocalLogin({ id: id, gate: /close|閂/i.test(want) ? 'sig-only' : 'open' });
  ui.alert(r.ok ? '已處理（下游回覆：' + json_(r.data) + '）' : ('失敗：' + r.msg));
}
function menuOpenAccount() {
  var ui = SpreadsheetApp.getUi();
  ui.alert('開戶一律喺旅系統網站做（密碼 hash 由 /api/auth 用 PBKDF2 ≥100k 算，GAS 唔經手明文密碼）：\n\n旅系統 → 用戶與身份 → 邀請／開戶（可以揀「順便為下游開戶」，兩邊同一個 hash）。');
}
function menuRemoveDownstream() {
  var ui = SpreadsheetApp.getUi();
  var id = ui.prompt('要移除邊個下游 id').getResponseText();
  ui.alert(json_(removeDownstream(id)));
}

/* --------------------------- 初始化 -------------------------------------- */
function setupApiKey() {
  var p = props_();
  if (p.getProperty('API_KEY')) return p.getProperty('API_KEY');
  var key = 'troop_' + Utilities.getUuid().replace(/-/g, '');
  p.setProperty('API_KEY', key);
  try { MailApp.sendEmail(p.getProperty('ADMIN_EMAIL') || Session.getEffectiveUser().getEmail(), '旅系統 APIKEY（只交 ADMIN）', 'APIKEY: ' + key + '\nBACKEND: ' + ScriptApp.getService().getUrl()); } catch (e) { Logger.log('email fail: ' + e); }
  return key;
}

function ensureSheet_(name, header) {
  var sh = ss_().getSheetByName(name);
  if (!sh) sh = ss_().insertSheet(name);
  if (sh.getLastRow() === 0 && header && header.length) sh.appendRow(header);
  if (!header || !header.length) { /* 無 header 類型 */ }
  sh.setFrozenRows(1);
  return sh;
}

/** 建立所有分頁；回 { ok, msg, tabs } */
function initializeSheets() {
  var made = [];
  TABLES.forEach(function (t) { ensureSheet_(t, TABLE_HEADER); made.push(t); });
  Object.keys(LOGS).forEach(function (t) { ensureSheet_(t, LOGS[t]); made.push(t); });
  ensureSheet_('資料表', ['table', 'json', 'at', 'rows']);           // 兼容 VS v2.12 嘅通用段
  setupApiKey();
  return { ok: true, msg: '已建立 ' + made.length + ' 個分頁。跟住：\n① 揀「🔗 旅系統 → ① 初始化」再做一次種入旅長\n② 「🔑 顯示 BACKEND／APIKEY」交 ADMIN 放入 Vercel env', tabs: made };
}

/** 種入第一個旅長（唔經邀請連結）：只發一次性 setup token；
    密碼由 /api/auth 設定（PBKDF2 ≥100k 喺 Node 算）—— GAS 永遠唔會經手明文密碼。 */
function seedFirstChief(email, name) {
  var token = randomPw_().toUpperCase();
  var u = upsertUser_({ email: email, name: name || '旅長', role: 'chief', status: 'pending_hash', mustChangePw: true, setupToken: token, at: stamp_() }, '種入第一個旅長');
  var rows = readUsers_(); var rec = rows.filter(function (x) { return x.id === u.id; })[0];
  if (rec) { rec.setupToken = token; rec.setupAt = stamp_(); writeTable_('旅員', rows, 'setup'); }
  return { ok: true, email: email, token: token, needHash: true };
}
function randomPw_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); }

/* --------------------------- 忘記密碼（BUILD §3：email 一次性連結） ---------------------
   流程：用戶喺登入頁填 email → /api/auth → 呢支（server-only）：
     ① 一定唔會講「有冇呢個 email」（防帳號枚舉）—— 回 sent:true 就算
     ② 有嘅話：種一個一次性 setupToken（30 分鐘）＋寄一封帶連結嘅信
     ③ 冇設定 APP_URL 或者寄唔到 → 照回 token 俾領袖人手傳（唔會扮寄咗）
   之後：用戶撳連結 → 入新密碼 → /api/auth 算 PBKDF2 → setupWithToken 落 hash（GAS 永遠唔見明文） */
function issueResetToken(body) {
  if (CTX.mode !== 'server') return err_('server_only', '要 server 側做');
  var email = String(body.email || '').trim();
  if (!email) return err_('bad_email', '要 email');
  var ttlMin = Math.max(5, Math.min(120, Number(body.ttlMin || 30)));
  var rows = readUsers_();
  var i = rows.map(function (r) { return String(r.email || '').toLowerCase(); }).indexOf(email.toLowerCase());
  /* 防枚舉：搵唔到都回同一個形狀（sent:true），但唔會種 token、唔會寄信 */
  if (i < 0) { access_('PWRESET', email, CTX.ip, 'no_user（唔會外洩邊個 email 有戶）'); return ok_({ sent: true, delivered: false, token: '', expMin: ttlMin }); }
  if (String(rows[i].status || '') !== 'active' && String(rows[i].status || '') !== 'pending_hash') {
    access_('PWRESET', email, CTX.ip, 'status=' + rows[i].status);
    return ok_({ sent: true, delivered: false, token: '', expMin: ttlMin });   // 形狀要同「有戶」一樣（防枚舉）
  }
  var token = randomPw_().toUpperCase();
  rows[i].setupToken = token;
  rows[i].setupAt = stamp_();
  rows[i].setupExp = new Date(Date.now() + ttlMin * 60000).toISOString();
  rows[i].mustChangePw = true;
  var w = writeTable_('旅員', rows, 'reset');
  if (!w.ok) return err_('write_fail', w.msg);
  var base = String(props_().getProperty('APP_URL') || '').replace(/\/+$/, '');
  var link = base ? (base + '/index.html?step=setup&u=' + unitId_() + '&t=' + token + '&e=' + encodeURIComponent(email)) : '';
  var delivered = false, note = '';
  if (link) {
    try {
      MailApp.sendEmail({
        to: email,
        subject: '【' + unitId_() + ' 旅系統】重設密碼連結（' + ttlMin + ' 分鐘內有效）',
        body: '你好，\n\n有人（可能係你）要求重設旅系統密碼。\n\n撳呢條一次性連結設定新密碼：\n' + link
          + '\n\n連結 ' + ttlMin + ' 分鐘內有效、用完即廢。如果唔係你要求，可以唔理呢封信（你嘅密碼唔會變）。\n\n'
          + '提提你：任何職員都唔會問你密碼。'
      });
      delivered = true;
    } catch (e) { note = '寄唔到信（' + String(e.message || e) + '）—— 請旅長人手傳連結'; }
  } else { note = '未設定 APP_URL（ScriptProperties）—— 請旅長人手傳連結'; }
  audit_('（reset）', '發出重設密碼連結', email, (delivered ? '已寄出' : '未寄出') + '｜' + ttlMin + ' 分鐘', 'api');
  return ok_({ sent: true, delivered: delivered, token: delivered ? '' : token, expMin: ttlMin, note: note });
}

/* --------------------------- 密碼 ---------------------------------------- */
/* ⚠⚠ 鐵律：**呢支 GAS 永遠唔會自己 hash 或驗密碼。**
   · 驗密碼：`/api/auth`（Node · PBKDF2-SHA256 ≥100k · timing-safe）
   · 產生 hash：同樣 `/api/auth`，之後用 `changePassword`／`upsertUser` 交 hash 落嚟
   · GAS 只負責**存**（hash／salt／iter／pv）同**唔外洩**（讀取一律剝走）
   · 冇 hash 嘅帳號一律 `status:'pending_hash'`（等 server 落 hash 先入得）—— 唔會靜靜當佢入得 */
function validHashPair_(hash, salt) { return isHex64_(String(hash || '')) && String(salt || '').length >= 8; }

/* --------------------------- 泛用表讀寫 ---------------------------------- */
/** 分件命名：`旅通告` → `旅通告#1`、`旅通告#2`…（大庫分件；讀嘅時候自動合返） */
function partName_(name, i) { return name + '#' + i; }
function partSheets_(name) {
  var out = [], all = ss_().getSheets(), base = name + '#';
  all.forEach(function (sh) { if (sh.getName().indexOf(base) === 0) out.push(sh.getName()); });
  return out.sort(function (a, b) { return Number(a.slice(base.length)) - Number(b.slice(base.length)); });
}
/** 分段讀：主分頁 ＋ 所有分件（順序）；分件係 #1、#2… */
function readTableAll_(name) { return partSheets_(name).reduce(function (acc, p) { return acc.concat(readTable_(p)); }, readTable_(name)); }
/** 唔再需要分件：清空 ＋ 刪走分頁（唔留一堆空分頁） */
function dropParts_(name) {
  var gone = 0;
  partSheets_(name).forEach(function (pn) {
    var sh = ss_().getSheetByName(pn);
    if (!sh) return;
    try { ss_().deleteSheet(sh); gone++; } catch (e) { try { writeTable_(pn, [], actor_()); gone++; } catch (e2) { Logger.log('drop part fail: ' + e2); } }
  });
  return gone;
}
/** 切件（寫入同回滾共用同一套切法，唔會前後唔一致） */
function chunksOf_(rows) {
  var out = [];
  for (var i = 0; i < rows.length; i += LIMITS.rowsPerWrite) out.push(rows.slice(i, i + LIMITS.rowsPerWrite));
  return out.length ? out : [[]];
}
/** 刪走某個分件（刪唔到就清空，唔留垃圾） */
function dropPartSheet_(pn, by) {
  var sh = ss_().getSheetByName(pn);
  if (!sh) return true;
  try { ss_().deleteSheet(sh); return true; } catch (e) { try { writeTable_(pn, [], by); return true; } catch (e2) { return false; } }
}
/** 回滾：寫返寫入前嘅樣（分件數同舊 snapshot 對齊，多咗嘅分件清走） */
function restoreShard_(name, rows, by) {
  var chunks = chunksOf_(rows), ok = true;
  for (var i = 0; i < chunks.length; i++) {
    var w = (rows.length <= LIMITS.rowsPerWrite)
      ? writeTable_(name, chunks[0], by)                       // 舊資料本身唔夠大：寫返主分頁
      : writeTable_(partName_(name, i + 1), chunks[i], by);
    if (!w.ok) ok = false;
  }
  if (rows.length > LIMITS.rowsPerWrite) { var w0 = writeTable_(name, [], by); if (!w0.ok) ok = false; }
  /* 今次寫多咗嘅分件：刪走（舊 snapshot 冇咁多件） */
  partSheets_(name).forEach(function (pn) {
    if (Number(pn.slice((name + '#').length)) > chunks.length) { if (!dropPartSheet_(pn, by)) ok = false; }
  });
  return { ok: ok, msg: ok ? '已回滾到寫入前（資料冇變）' : '⚠️ 回滾都失敗 —— 請即刻由備份匯入' };
}
/**
 * 大庫寫入（db shard）：超上限就自動切件（每件 ≤rowsPerWrite）。
 * ★ 三個保障：
 *   ① 件數上限（LIMITS.maxParts）—— 超出＝誠實拒，**唔會寫一半**
 *   ② 寫入前後各 bump 版本一次 —— 讀者嘅 pointer 覆查一定偵測到「寫緊」（唔會讀到一半）
 *   ③ 有分件寫唔入＝**回滾**返寫入前嘅樣（唔會留一半新一半舊俾人讀出假資料）
 */
function writeSharded_(name, rows, by) {
  if (rows.length <= LIMITS.rowsPerWrite) {
    dropParts_(name);                                                      // 縮返細：清走＋刪走舊分件
    return writeTable_(name, rows, by);
  }
  var chunks = chunksOf_(rows);
  if (chunks.length > (LIMITS.maxParts || 40)) {
    return { ok: false, rows: rows.length, parts: [], chunks: chunks.length, refused: true,
      msg: '要分 ' + chunks.length + ' 件（上限 ' + (LIMITS.maxParts || 40) + '）—— 請先歸檔舊資料（匯出 → purge），今次一個字都冇寫' };
  }
  bumpVersion_();                                                          // ② 寫入前（write-ahead）
  var snapshot = readTableAll_(name);                                      // ③ 回滾用
  var rep = { ok: true, rows: rows.length, parts: [], snapshotRows: snapshot.length, versionBumps: 1 };
  for (var j = 0; j < chunks.length; j++) {
    var w = writeTable_(partName_(name, j + 1), chunks[j], by);
    rep.parts.push({ part: j + 1, ok: w.ok, rows: chunks[j].length, msg: w.msg });
    if (!w.ok) { rep.ok = false; break; }
  }
  if (rep.ok) { var w0 = writeTable_(name, [], by); if (!w0.ok) { rep.ok = false; rep.msg = w0.msg; } }   // 主分頁清空（真相＝分件）
  if (!rep.ok) {
    var rb = restoreShard_(name, snapshot, by);
    rep.rolledBack = rb.ok; rep.rollbackMsg = rb.msg;
    if (!rb.ok) access_('SHARD_ROLLBACK_FAIL', '', CTX.ip, name + '：' + rb.msg);
    rep.msg = '有分件寫唔入 —— ' + rb.msg;
    return rep;
  }
  bumpVersion_();                                                          // ② 寫完（write-behind）
  rep.versionBumps = 2;
  rep.msg = '已分 ' + chunks.length + ' 件寫入（版本前後各 bump 一次：讀者唔會讀到一半）';
  return rep;
}

function readTable_(name) {
  var sh = ss_().getSheetByName(name) || ensureSheet_(name, TABLE_HEADER);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var values = sh.getRange(2, 1, last - 1, header.length).getValues();
  if (header.join(',') === TABLE_HEADER.join(',')) {
    return values.filter(function (r) { return r[0]; }).map(function (r) {
      var o = parseJson_(r[1], {}); o.__id = String(r[0]); o.__at = String(r[2] || ''); o.__by = String(r[3] || ''); return o;
    });
  }
  /* append-only 紀錄：回物件 */
  return values.map(function (r) { var o = {}; header.forEach(function (h, i) { o[h] = r[i]; }); return o; });
}

/** 逐表寫：先寫新後刪舊，寫完即刻讀返自證 */
function writeTable_(name, rows, by) {
  var sh = ss_().getSheetByName(name) || ensureSheet_(name, TABLE_HEADER);
  var header = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  var generic = header.join(',') === TABLE_HEADER.join(',');
  if (rows.length > LIMITS.rowsPerWrite) return { ok: false, msg: '一次寫太多行（' + rows.length + '）' };
  var body = rows.map(function (r) {
    if (generic) { var o = JSON.parse(JSON.stringify(r)); delete o.__id; delete o.__at; delete o.__by; return [String(r.__id || r.id || uid_(name)), json_(o), String(r.__at || stamp_()), sanitizeLabel_(by || r.__by || '')]; }
    return header.map(function (h) { return r[h] === undefined ? '' : r[h]; });
  });
  var backup = [];                              // 先寫新（放下面），成功先刪舊（上面）—— 中途死都仲有舊數據
  var beforeRows = Math.max(0, sh.getLastRow() - 1);        // 唔計 header
  if (body.length) sh.getRange(sh.getLastRow() + 1, 1, body.length, body[0].length).setValues(body);
  var start = 2;
  var oldRows = beforeRows;                                 // header 佔第 1 行，舊數據＝2 … 1+beforeRows
  if (oldRows >= 1) {
    var oldRange = sh.getRange(start, 1, oldRows, body[0] ? body[0].length : header.length);
    backup = oldRange.getValues();
    oldRange.clearContent();
  }
  /* 自證：讀返 */
  var back = readTable_(name);
  var ok = back.length >= rows.length;
  if (!ok && backup.length) {                    // 失敗就回復舊數據（唔會靜靜冇咗）
    sh.getRange(start, 1, backup.length, backup[0].length).setValues(backup);
    return { ok: false, msg: '寫入自證唔齊（寫 ' + rows.length + '、讀返 ' + back.length + '）' };
  }
  return { ok: true, rows: back.length };
}

/* --------------------------- 審計（prev_hash 鏈） ------------------------ */
/** hash 用嘅 canonical 字串：跟 header 欄序（唔靠物件 key 次序，讀返先驗得到） */
/** 喺泛用表（例如備份紀錄）加一行紀錄 */
function pushRow_(table, obj) {
  var rows = readTable_(table); rows.push(Object.assign({ id: uid_(table), at: stamp_(), by: actor_() }, obj));
  return writeTable_(table, rows, actor_());
}
function canonicalRow_(header, row, skip) {
  return header.filter(function (h) { return skip.indexOf(h) < 0; }).map(function (h) {
    var v = row[h];
    return v === undefined || v === null ? '' : (typeof v === 'object' ? json_(v) : String(v));
  }).join('\u0001');
}
function appendLog_(name, obj) {
  var sh = ss_().getSheetByName(name) || ensureSheet_(name, LOGS[name]);
  var header = LOGS[name];
  var last = sh.getLastRow();
  var prev = '';
  if (last >= 2) prev = String(sh.getRange(last, header.indexOf('hash') + 1).getValue() || '');   // 攞上一行嘅 hash（唔係 prev_hash）
  var row = JSON.parse(JSON.stringify(obj));
  if (header.indexOf('prev_hash') >= 0) {
    row.prev_hash = prev;
    row.hash = sha256Hex_(prev + '|' + canonicalRow_(header, row, ['hash', 'prev_hash']));
  }
  sh.appendRow(header.map(function (h) { return row[h] === undefined ? '' : (h === 'hash' || h === 'prev_hash' ? String(row[h]) : (typeof row[h] === 'object' ? json_(row[h]) : row[h])); }));
  return row;
}
/* ★ 紀錄只記 metadata（BUILD §10 條 7／§8 私隱）：
   審計係用嚟追「邊個幾時做過咩」，唔係用嚟備份內容。所以全部 log 都經呢支收口：
     · email → 遮中間（`chan…@demo.hk`），唔會儲存完整電郵
     · 電話（8 位香港號碼）→ `****1234`
     · 長文字（通告內文、退問原因、求救詳情、備註…）→ `[內容不記錄 len=123]`
     · 短嘅識別碼／狀態／版本／數字 → 原樣留住（呢啲先係追蹤要用嘅 metadata）
   紅acted 之後先算 hash，所以審計鏈照樣驗得到。 */
var LOG_META_MAX = 80;                        // 單一欄位最多記幾多字（超過＝當內容，唔記）
function redactMeta_(v) {
  var t = String(v == null ? '' : v);
  if (!t) return '';
  /* email：只留頭兩個字＋網域（唔會儲存完整電郵） */
  t = t.replace(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, function (m, dom) {
    return m.slice(0, 2) + '…@' + dom;
  });
  /* 香港電話：+852／帶分隔嘅 8 位號碼 → 只留尾 4 位（唔會誤中純 8 位數字如日期碼） */
  t = t.replace(/(?:\+?852[\s-]?)?\b(\d{4})[\s-](\d{4})\b/g, function (m, a, b) { return '****-' + b; });
  /* 長文字：唔記錄內容，只記長度（追蹤夠用） */
  if (t.length > LOG_META_MAX) return '[內容不記錄 len=' + t.length + ']';
  return t;
}
function audit_(actor, action, target, detail, via) {
  return appendLog_('審計紀錄', {
    id: uid_('au'), at: stamp_(), actor: redactMeta_(sanitizeLabel_(actor)), role: sanitizeLabel_(role_()),
    identity: sanitizeLabel_(identity_()), branchId: sanitizeLabel_(branch_()),
    action: String(action || '').slice(0, 40), target: redactMeta_(String(target || '').slice(0, 120)),
    detail: redactMeta_(String(detail || '').slice(0, 400)), via: sanitizeLabel_(via || 'api')
  });
}
function access_(kind, email, ip, meta) {
  return appendLog_('操作紀錄', {
    id: uid_('ac'), at: stamp_(), kind: String(kind || '').slice(0, 20),
    email: redactMeta_(sanitizeLabel_(email || '')), ip: sanitizeLabel_(ip || ''), meta: redactMeta_(String(meta || '').slice(0, 200))
  });
}
function sync_(mode, tables, version, confirmed, ms) {
  return appendLog_('同步紀錄', { id: uid_('sy'), at: stamp_(), mode: String(mode || '').slice(0, 20), tables: String(tables || '').slice(0, 200), version: String(version || ''), confirmed: confirmed ? 'true' : 'false', ms: String(ms || '') });
}
/** 驗證審計鏈完整（有守護測試用） */
function verifyAuditChain_() {
  var rows = readTable_('審計紀錄');
  var prev = '';
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r.prev_hash || '') !== prev) return { ok: false, at: r.id, msg: 'prev_hash 斷鏈' };
    if (sha256Hex_(prev + '|' + canonicalRow_(LOGS['審計紀錄'], r, ['hash', 'prev_hash'])) !== String(r.hash)) return { ok: false, at: r.id, msg: 'hash 對唔上（可能被人改過）' };
    prev = String(r.hash);
  }
  return { ok: true, rows: rows.length, head: prev };
}
/* --------------------------- 刪除＝tombstone ------------------------------ */
/* BUILD §10-7：刪除唔係即刻消失，而係寫低「墓碑」（邊個、幾時、為咩），
   前端靠墓碑知「呢行係真係被刪（唔係唔見咗）」；90 日後由 purge 清走。 */
var TOMBSTONE_DAYS = 90;
function tombstones() {
  var sh = ss_().getSheetByName('_tombstone') || ensureSheet_('_tombstone', ['id', 'table', 'rowId', 'by', 'at', 'reason']);
  var last = sh.getLastRow(); if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 6).getValues().filter(function (r) { return r[0]; }).map(function (r) {
    return { id: String(r[0]), table: String(r[1]), rowId: String(r[2]), by: String(r[3]), at: String(r[4]), reason: String(r[5]) };
  });
}
function markDeleted(table, rowId, reason) {
  var sh = ensureSheet_('_tombstone', ['id', 'table', 'rowId', 'by', 'at', 'reason']);
  sh.appendRow([uid_('tm'), String(table), String(rowId), sanitizeLabel_(actor_()), stamp_(), String(reason || '').slice(0, 120)]);
  return { id: table + '/' + rowId };
}
function purgeTombstones() {
  var cut = now_().getTime() - TOMBSTONE_DAYS * 24 * 3600 * 1000;
  var sh = ss_().getSheetByName('_tombstone'); if (!sh) return 0;
  var last = sh.getLastRow(); if (last < 2) return 0;
  var vals = sh.getRange(2, 1, last - 1, 6).getValues();
  var keep = vals.filter(function (r) { var d = new Date(String(r[4]).replace(' ', 'T')).getTime(); return !(d && d < cut); });
  var n = vals.length - keep.length;
  if (n) { sh.getRange(2, 1, vals.length, 6).clearContent(); if (keep.length) sh.getRange(2, 1, keep.length, 6).setValues(keep); }
  return n;
}
/** 刪一行（前端用）：表 ＋ row id ＋ 理由 → 墓碑；table 用 readTableAll_ 讀（分件都讀） */
function deleteRow(o) {
  var table = String(o.table || '');
  if (TABLES.indexOf(table) < 0) return err_('bad_table', '冇呢個表');
  var rows = readTableAll_(table), before = rows.length;
  var kept = rows.filter(function (r) { return String(r.id) !== String(o.rowId) && String(r.__id) !== String(o.rowId); });
  if (kept.length === before) return err_('no_row', '搵唔到呢一行（可能已經刪咗）');
  var w = writeSharded_(table, kept, actor_());
  if (!w.ok) return err_('write_fail', w.msg);
  markDeleted(table, o.rowId, o.reason);
  audit_(actor_(), '刪除行', table + '/' + String(o.rowId), String(o.reason || ''), CTX.mode === 'server' ? 'api' : 'ui');
  return ok_({ deleted: true, table: table, rowId: String(o.rowId), left: kept.length, tombstone: true });
}

/* --------------------------- PDPO（BUILD §8） ------------------------------
   離隊（TRANSFERRED_OUT／LEFT）滿 12 個月 → 匿名化（唔係直接刪，留住統計）；
   另外：開戶帶家長同意欄位（見 applyPush_ 嘅 consent）；數據清單一張表（見 dataInventory）。
   條文：PDPO 講「保留唔超過所需時間」—— 呢個就係嗰條線。 */
var LEFT_PURGE_DAYS = 365;
function purgeLeftMembers(o) {
  var dry = !o || o.dryRun !== false;                 // 預設＝只報告，唔真做（安全）
  var cutoff = now_().getTime() - LEFT_PURGE_DAYS * 24 * 3600 * 1000;
  var rows = readUsers_(), hit = [], keep = [];
  rows.forEach(function (u) {
    var st = String(u.status || '');
    var left = ['transferred_out', 'left', 'transferred', 'ended'].indexOf(st) >= 0;
    var at = parseStamp_(u.leftAt || u.at);
    var old = isFinite(at) && at < cutoff;
    if (left && old) {
      hit.push({ id: u.id, email: u.email, status: st, leftAt: u.leftAt || '', days: Math.floor((now_().getTime() - at) / 86400000) });
      keep.push({ id: u.id, at: stamp_(), by: actor_(), status: 'anonymised', email: '', name: '（已離隊 · 已匿名化）', ymis: '', phone: '', hash: '', salt: '', perms: [], branchAccess: [], children: [], anonymisedAt: stamp_(), wasEmail: String(u.email || '').slice(0, 0) });
    } else keep.push(u);
  });
  if (!hit.length) return { ok: true, dryRun: true, hit: [], kept: rows.length, msg: '冇滿 ' + LEFT_PURGE_DAYS + ' 日嘅離隊紀錄' };
  if (dry) return { ok: true, dryRun: true, hit: hit, kept: rows.length, msg: '（演練）會匿名化 ' + hit.length + ' 個離隊滿 12 個月嘅戶 —— 要真做就傳 dryRun:false' };
  var w = writeTable_('旅員', keep, actor_());
  if (!w.ok) return { ok: false, msg: w.msg };
  audit_(actor_(), 'PDPO 匿名化離隊成員', 'purgeLeftMembers', hit.map(function (h) { return h.email; }).join('、').slice(0, 200), 'menu');
  return { ok: true, dryRun: false, hit: hit, anonymised: hit.length, kept: keep.length, msg: '已匿名化 ' + hit.length + ' 個離隊滿 12 個月嘅戶（紀錄留住，個人資料清走）' };
}
/** 數據清單一張表（PDPO：收集咩／用途／邊個睇到／保留幾久） */
function dataInventory() {
  return [
    { what: '姓名／YMIS／聯絡', where: '旅員 分頁', why: '開戶、點名、通知家長', who: '旅長、教練員、該團領袖', keep: '在隊期間；離隊 12 個月後匿名化' },
    { what: '密碼 hash（PBKDF2）', where: '旅員 分頁（hash／salt，唔存明文）', why: '登入驗證（只由 /api/auth 驗）', who: 'system（人睇唔到；讀取一律剝走）', keep: '改密碼即換；離隊即清' },
    { what: '出席／報名／活動', where: '旅通告／旅行事曆／申請 分頁', why: '活動安排、統計', who: '該團領袖、旅部', keep: '24 個月' },
    { what: '財務／物資', where: '財務整合／物資整合 分頁', why: '核數、借用歸還', who: '該團財務、旅長', keep: '24 個月' },
    { what: '審計／操作紀錄', where: '審計紀錄／操作紀錄 分頁', why: '追責、防篡改（prev_hash 鏈）', who: '旅長（超管）', keep: '24 個月' },
    { what: '求救／問題回報', where: '求救 分頁 ＋ Scout Admin 收件匣', why: '處理入唔到／問題', who: '旅部 ADMIN', keep: '24 個月' },
    { what: '家長同意（收集聲明）', where: '申請 分頁 consent 欄', why: 'PDPO：開戶要家長／監護人同意', who: '該團領袖', keep: '同帳號' }
  ];
}
function purgeOldLogs() {
  var cutoff = new Date(now_().getTime() - 24 * 30 * 24 * 3600 * 1000);
  var moved = 0;
  Object.keys(LOGS).forEach(function (t) {
    var sh = ss_().getSheetByName(t); if (!sh) return;
    var last = sh.getLastRow(); if (last < 2) return;
    var atCol = LOGS[t].indexOf('at') + 1;
    var vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
    var keep = vals.filter(function (r) { var d = new Date(String(r[atCol - 1]).replace(' ', 'T')); return !(d.getTime() && d.getTime() < cutoff.getTime()); });
    moved += vals.length - keep.length;
    if (keep.length !== vals.length) { sh.getRange(2, 1, vals.length, sh.getLastColumn()).clearContent(); if (keep.length) sh.getRange(2, 1, keep.length, keep[0].length).setValues(keep); }
  });
  var tm = purgeTombstones();
  audit_('（系統）', 'purge', '24 個月前紀錄', '清走 ' + moved + ' 行；墓碑 ' + tm + ' 個', 'menu');
  return { ok: true, msg: '已清 ' + moved + ' 行（24 個月前）' };
}

/* --------------------------- 身份（session／sig） ------------------------ */
/* 限流：同一 IP 連續失敗（錯 key／錯 sig／登入失敗）5 次 → 鎖 15 分鐘（CacheService） */
function failCount_(ip) { return Number(cache_().get('rl_' + ip) || 0); }
function bumpFail_(ip) { var n = failCount_(ip) + 1; cache_().put('rl_' + ip, String(n), 900); return n; }
function isLocked_(ip) { return failCount_(ip) >= LIMITS.loginFails; }
function clearFails_(ip) { cache_().remove('rl_' + ip); }
function lockedReply_() { return ContentService.createTextOutput(json_(err_('rate_limited', '試得太多（15 分鐘）—— 請等一等再試'))).setMimeType(ContentService.MimeType.JSON); }

var CTX = { mode: 'guest', actor: '', role: '', identity: '', branch: '', body: null, ip: '', matched: [] };
function role_() { return CTX.role; }
function identity_() { return CTX.identity; }
function branch_() { return CTX.branch; }
function actor_() { return CTX.actor; }

function apiKey_() { return props_().getProperty('API_KEY') || ''; }

/** apikey 驗證（server 側；前端永不帶 key） */
function checkApiKey_(key) {
  var real = apiKey_();
  if (!real || !key) return false;
  var a = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(key), Utilities.Charset.UTF_8);
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, real, Utilities.Charset.UTF_8);
  if (a.length !== b.length) return false;
  var diff = 0; for (var i = 0; i < a.length; i++) diff |= (a[i] ^ b[i]);
  return diff === 0;
}

/** sig 驗證（雙通道：query 先、body 後；兩組 nonce 一次過消耗） */
function verifySig_(action, rawBody, params, body) {
  var ts = params.sig_ts || body.sig_ts, nonce = params.sig_nonce || body.sig_nonce, sig = params.sig || body.sig;
  var fromQuery = !!(params.sig && params.sig_ts && params.sig_nonce);
  if (!sig || !ts || !nonce) return { ok: false, msg: '缺少 sig 欄位' };
  if (!isHex64_(sig)) return { ok: false, msg: 'sig 格式唔啱（要 64 位 hex）' };
  var t = Number(ts);
  if (!t || Math.abs(now_().getTime() - t) > LIMITS.sigSkewMs) return { ok: false, msg: '時間戳過期（±5 分鐘）' };
  if (t > now_().getTime() + 1000) return { ok: false, msg: '時間戳喺未來' };
  var consumed = [];
  if (params.sig_nonce) consumed.push(params.sig_nonce);
  if (body.sig_nonce && body.sig_nonce !== params.sig_nonce) consumed.push(body.sig_nonce);
  var c = cache_();
  var jtis = consumed.map(function (n) { return jtiOf_(n, t); });
  for (var i = 0; i < consumed.length; i++) {
    if (c.get('sn_' + consumed[i])) return { ok: false, code: 'sig_replayed', jti: jtis[i], msg: 'nonce 已用過（防重放）' };
    /* 持久環：cache 蒸發咗都照樣擋得住重放 */
    if (jtiSeen_(jtis[i])) return { ok: false, code: 'sig_replayed', jti: jtis[i], msg: 'jti 已用過（防重放；cache 蒸發都擋得住）' };
  }
  /* digest：query 綁完整原始 body；body 通道綁去掉 sig 三欄之後嘅 body */
  var payloadForBody = JSON.parse(JSON.stringify(body)); delete payloadForBody.sig; delete payloadForBody.sig_ts; delete payloadForBody.sig_nonce;
  var digestQuery = sha256Hex_(rawBody);
  var digestBody = sha256Hex_(json_(payloadForBody));
  var digest = fromQuery ? digestQuery : digestBody;
  var canonical = action + '\n' + t + '\n' + nonce + '\n' + digest;
  var kids = Object.keys(props_().getProperties()).filter(function (k) { return /^DOWNSTREAM_.*_KEY$/.test(k); });
  var myKey = props_().getProperty('SHEET_KEY') || props_().getProperty('API_KEY') || '';
  var keys = kids.map(function (k) { return props_().getProperty(k); }); if (myKey) keys.push(myKey);
  var sigKey = sha256Hex_(LINK_SIG_PURPOSE + '|' + myKey);       // 本機一條 purpose（下游側照自己常數驗）
  var expect = bytesToHex_(Utilities.computeHmacSha256Signature(canonical, sigKey));
  if (expect !== sig) return { ok: false, msg: '簽名不符' };
  consumed.forEach(function (n, k) {
    c.put('sn_' + n, '1', 600);                     // 快路：10 分鐘
    jtiRemember_(jtis[k], t);                        // 持久環：cache 冇咗都認得出
  });
  return { ok: true, via: fromQuery ? 'query' : 'body', jti: jtis[0] };
}

/* ★ sig jti（BUILD §10 條 7）：nonce 就係 jti，但 cache 只係「盡力而為」——
   蒸發咗就等於防重放冇咗。所以再做一個**持久** jti 環（ScriptProperties，有上限＋會過期），
   cache 快路 + 持久環雙保險：同一張簽名用第二次一定拒。 */
var SIG_JTI_RING_KEY = 'SIG_JTI_RING';
function jtiOf_(nonce, ts) { return sha256Hex_('jti|' + String(nonce) + '|' + String(ts)).slice(0, 24); }
function jtiRingRead_() {
  var raw = props_().getProperty(SIG_JTI_RING_KEY) || '[]';
  var arr = [];
  try { arr = JSON.parse(raw); } catch (e) { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  var cut = now_().getTime() - (LIMITS.sigSkewMs * 2);
  return arr.filter(function (x) { return x && Number(x.ts) >= cut; });        // 過期即自然淘汰
}
function jtiSeen_(jti) {
  var ring = jtiRingRead_();
  for (var i = 0; i < ring.length; i++) { if (String(ring[i].jti) === String(jti)) return true; }
  return false;
}
function jtiRemember_(jti, ts) {
  var ring = jtiRingRead_();
  ring.push({ jti: String(jti), ts: Number(ts) || now_().getTime() });
  var max = LIMITS.sigJtiRing || 200;
  if (ring.length > max) ring = ring.slice(ring.length - max);                 // 有上限：唔會無限長大
  try { props_().setProperty(SIG_JTI_RING_KEY, JSON.stringify(ring)); } catch (e) { /* 寫唔入都唔可以擋住請求；cache 快路仍在 */ }
  return ring.length;
}
/** 測試／管理用：睇 jti 環現況 */
function jtiRingInfo_() {
  var ring = jtiRingRead_();
  return { count: ring.length, oldest: ring.length ? ring[0].ts : 0 };
}

/** 中央登入票據回打固定端點（一次性防重放；60 秒） */
function verifySuperTicket_(ticket) {
  var c = cache_();
  if (c.get('st_' + ticket)) return { ok: false, msg: '票據已用過' };
  var res = UrlFetchApp.fetch(SUPER_VERIFY_URL, { method: 'post', contentType: 'application/json', payload: json_({ ticket: ticket, unit: unitId_() }), muteHttpExceptions: true });
  var body = parseJson_(res.getContentText(), {});
  if (!body || body.success !== true) return { ok: false, msg: '票據驗唔過（' + (body && body.error || res.getResponseCode()) + '）' };
  c.put('st_' + ticket, '1', 300);
  return { ok: true, data: body.data || {} };
}
function unitId_() { return props_().getProperty('TROOP_ID') || props_().getProperty('UNIT_ID') || ''; }

/* --------------------------- sig 出站 ------------------------------------ */
/** 對下游簽（purpose 逐條登記）：canonical = action + ts + nonce + sha256(body) */
function signOutgoing_(action, bodyObj, purpose, key) {
  var ts = now_().getTime(), nonce = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  var digest = sha256Hex_(json_(bodyObj));
  var sigKey = sha256Hex_(purpose + '|' + key);
  var sig = bytesToHex_(Utilities.computeHmacSha256Signature(action + '\n' + ts + '\n' + nonce + '\n' + digest, sigKey));
  return { sig: sig, sig_ts: ts, sig_nonce: nonce };
}
/** 打下游（讀／寫）：一律 POST；apikey 唔落 query；如實轉述下游回應 */
function callDownstream(id, action, payload, opts) {
  var p = props_();
  var url = p.getProperty('DOWNSTREAM_' + id + '_URL');
  var key = p.getProperty('DOWNSTREAM_' + id + '_KEY');
  var purpose = p.getProperty('DOWNSTREAM_' + id + '_PURPOSE') || LINK_SIG_PURPOSE;
  if (!url || !key) return { ok: false, msg: '未登記下游：' + id };
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) return { ok: false, msg: '下游 URL 格式唔啱（一定要 /exec）' };
  var body = payload || {};
  body.action = action;
  var sig = signOutgoing_(action, body, purpose, key);
  body.sig = sig.sig; body.sig_ts = sig.sig_ts; body.sig_nonce = sig.sig_nonce;
  var res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: json_(body), muteHttpExceptions: true });
  var out = parseJson_(res.getContentText(), null);
  if (!out) return { ok: false, msg: '下游回應唔係 JSON（HTTP ' + res.getResponseCode() + '）' };
  if (out.success !== true) return { ok: false, msg: String(out.error || '下游失敗'), data: out };
  return { ok: true, data: out.data, raw: out };
}

/* --------------------------- registry（ScriptProperties） ---------------- */
function registerDownstream(o) {
  var p = props_();
  var id = sanitizeLabel_(o.id).toLowerCase();
  if (!id || id.length > 32) return { ok: false, msg: 'id 唔啱（英數／底線／連字號，最長 32）' };
  var url = String(o.url || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) return { ok: false, msg: 'URL 一定要係 https://script.google.com/macros/s/…/exec' };
  if (!o.key) return { ok: false, msg: '要填下游 KEY' };
  p.setProperties({
    ['DOWNSTREAM_' + id + '_URL']: url,
    ['DOWNSTREAM_' + id + '_KEY']: String(o.key),
    ['DOWNSTREAM_' + id + '_NAME']: String(o.name || id).slice(0, 60),
    ['DOWNSTREAM_' + id + '_PURPOSE']: String(o.purpose || LINK_SIG_PURPOSE).slice(0, 60),
    ['DOWNSTREAM_' + id + '_API']: sanitizeLabel_(o.api || 'v1'),
    ['DOWNSTREAM_' + id + '_AT']: stamp_()
  });
  audit_('（管理員）', '登記下游', id, 'URL 登記（唔入 Sheet、唔入 frontend）', 'menu');
  return { ok: true, id: id };
}
function removeDownstream(id) {
  id = sanitizeLabel_(id).toLowerCase();
  var p = props_(), all = p.getProperties(), n = 0;
  Object.keys(all).forEach(function (k) { if (k.indexOf('DOWNSTREAM_' + id + '_') === 0) { p.deleteProperty(k); n++; } });
  audit_('（管理員）', '移除下游', id, '刪 ' + n + ' 個屬性', 'menu');
  return { ok: n > 0, msg: n ? ('已移除 ' + id) : '搵唔到呢個下游' };
}
function updateDownstream(o) {
  var p = props_(), id = sanitizeLabel_(o.id).toLowerCase();
  if (!p.getProperty('DOWNSTREAM_' + id + '_URL')) return { ok: false, msg: '未登記下游：' + id };
  if (o.name) p.setProperty('DOWNSTREAM_' + id + '_NAME', String(o.name).slice(0, 60));
  if (o.api) p.setProperty('DOWNSTREAM_' + id + '_API', sanitizeLabel_(o.api));
  if (o.purpose) p.setProperty('DOWNSTREAM_' + id + '_PURPOSE', String(o.purpose).slice(0, 60));
  audit_('（管理員）', '改下游登記', id, json_(o), 'menu');
  return { ok: true };
}
/** 前端只可以讀呢個（**永不含 URL／KEY／purpose**） */
function getDownstreams() {
  var p = props_(), all = p.getProperties(), out = {}, ids = [];
  Object.keys(all).forEach(function (k) {
    var m = k.match(/^DOWNSTREAM_(.+)_URL$/); if (!m) return;
    var id = m[1]; ids.push(id);
    out[id] = {
      id: id,
      name: all['DOWNSTREAM_' + id + '_NAME'] || id,
      api: all['DOWNSTREAM_' + id + '_API'] || 'v1',
      at: all['DOWNSTREAM_' + id + '_AT'] || '',
      linked: !!all['DOWNSTREAM_' + id + '_URL']
    };
  });
  return ids.map(function (id) { return out[id]; }).sort(function (a, b) { return a.id < b.id ? -1 : 1; });
}
/* --------------------------- 支部狀態（紅黃綠） ---------------------------
   三態：green（啱啱測過連線正常）／amber（未測過／好耐冇測）／red（測唔到）。
   ★ 手動紅燈：BASE2 講「未起好進度 sig 路徑之前，進度燈用手動紅」→ setUnitStatus。
   ★ 零回打：狀態一律由**我哋主動測**或者人手設定，下游永遠唔會通知我哋。 */
var STATUS_MAX_AGE_MS = 26 * 60 * 60 * 1000;    // 超過 26 鐘頭未測 → 當 amber
function readUnitStatus_() {
  var rows = readTable_('設定值'), out = {};
  rows.forEach(function (r) { if (String(r.id).indexOf('unitStatus:') === 0) out[String(r.id).slice(11)] = r; });
  return out;
}
function setUnitStatus(o) {
  var id = sanitizeLabel_(o.id).toLowerCase();
  if (!id) return { ok: false, msg: '要支部 id' };
  if (['green', 'amber', 'red'].indexOf(String(o.status)) < 0) return { ok: false, msg: '狀態只可以 green／amber／red' };
  var rows = readTable_('設定值').filter(function (r) { return String(r.id) !== 'unitStatus:' + id; });
  rows.push({ id: 'unitStatus:' + id, status: String(o.status), note: String(o.note || '').slice(0, 200), manual: true, at: stamp_(), by: actor_() });
  var w = writeTable_('設定值', rows, actor_());
  audit_(actor_(), '設定支部燈號', id, String(o.status) + (o.note ? '（' + String(o.note).slice(0, 80) + '）' : ''), 'api');
  return w.ok ? { ok: true, id: id, status: String(o.status) } : { ok: false, msg: w.msg };
}
/** 支部註冊表（＝前端「註冊表／接駁」用）：登記資料 ＋ 燈號 ＋ 有冇試過連線 */
function registry() {
  var reg = readDownstreams_(), st = readUnitStatus_();
  return reg.map(function (d) {
    var s0 = st[d.id] || null;
    var last = s0 && s0.status ? s0 : null;
    var status = 'amber', note = '未測過連線', at = d.at || '';
    if (last) { status = last.status; note = last.note || ''; at = last.at || at; }
    else if (d.lastTest && d.lastTest.ok) { status = 'green'; note = '上次測試連線成功'; at = d.lastTest.at; }
    else if (d.lastTest && d.lastTest.ok === false) { status = 'red'; note = '上次測試連線失敗：' + d.lastTest.msg; at = d.lastTest.at; }
    else if (at) {
      var age = Date.now() - Date.parse(String(at).replace(' ', 'T') + ':00+08:00');
      if (isFinite(age) && age > STATUS_MAX_AGE_MS) { status = 'amber'; note = '好耐冇測過連線'; }
    }
    return { id: d.id, name: d.name, api: d.api, linked: d.linked, status: status, note: note, at: at, tested: !!d.lastTest };
  });
}
/* 純讀版 registry（唔可以寫入）：直接由 properties 砌，避免讀寫循環 */
function readDownstreams_() {
  var p = props_(), all = p.getProperties(), ids = [];
  Object.keys(all).forEach(function (k) { var m = k.match(/^DOWNSTREAM_(.+)_URL$/); if (m) ids.push(m[1]); });
  return ids.sort().map(function (id) {
    var lt = null;
    try { lt = all['DOWNSTREAM_' + id + '_LASTTEST'] ? JSON.parse(all['DOWNSTREAM_' + id + '_LASTTEST']) : null; } catch (e) { lt = null; }
    return {
      id: id, name: all['DOWNSTREAM_' + id + '_NAME'] || id, api: all['DOWNSTREAM_' + id + '_API'] || 'v1',
      at: all['DOWNSTREAM_' + id + '_AT'] || '', linked: !!all['DOWNSTREAM_' + id + '_URL'], lastTest: lt
    };
  });
}
function testDownstream(id) {
  id = sanitizeLabel_(id).toLowerCase();
  var r = callDownstream(id, 'getLinkState', {});
  /* 記低測試結果（唔落 Sheet；registry 只住 ScriptProperties） */
  try {
    props_().setProperty('DOWNSTREAM_' + id + '_LASTTEST', json_({ ok: !!r.ok, msg: r.ok ? '' : String(r.msg || '').slice(0, 120), at: stamp_() }));
  } catch (e) { /* 記唔到就唔記：唔會影響測試本身 */ }
  audit_(actor_(), '測試下游連線', id, r.ok ? '成功' : ('失敗：' + r.msg), CTX.mode === 'server' ? 'api' : 'menu');
  if (!r.ok) return { ok: false, msg: r.msg };
  return { ok: true, data: r.data, msg: '下游回覆正常' };
}
function setLocalLogin(o) {
  var r = callDownstream(o.id, 'setLocalLogin', { gate: o.gate === 'sig-only' ? 'sig-only' : 'open' });
  audit_('（管理員）', o.gate === 'sig-only' ? '閂下游直接登入' : '開返下游直接登入', o.id, r.ok ? '下游已確認' : ('失敗：' + r.msg), 'menu');
  return r;
}
/* 為下游開戶：**兩邊同一個 hash**（由 /api/auth 算好交落嚟）。
   · 冇帶 hash → 只喺旅側開一個 pending_hash 戶（唔會亂作密碼）
   · 帶 hash → 旅側寫入 ＋ 即刻 sig 打下游 upsertUser（如實轉述下游成功／失敗） */
function openAccountForDownstream(o) {
  var u = upsertUser_({
    email: o.user.email, name: o.user.name, role: o.user.role || 'member',
    branchId: o.branchId || '', status: o.password_hash ? 'active' : 'pending_hash',
    mustChangePw: o.mustChangePw !== false,
    password_hash: o.password_hash, password_salt: o.password_salt, at: stamp_()
  }, '為下游開戶');
  var r = { ok: false, msg: '（未有 hash：只開咗旅側 pending 戶）' };
  if (o.password_hash) {
    r = callDownstream(o.id, 'upsertUser', {
      user: {
        email: o.user.email, name: o.user.name, role: o.user.role || 'member',
        password_hash: o.password_hash, password_salt: o.password_salt,
        pw_version: 1, mustChangePw: o.mustChangePw !== false
      }
    });
  }
  audit_('（管理員）', '為下游開戶', o.id + '/' + o.user.email, r.ok ? '兩邊同一 hash' : ('旅側已開戶、下游未寫：' + r.msg), 'menu');
  if (!r.ok) return { ok: false, msg: '旅側已開戶，但下游未寫入：' + r.msg, user: publicUser_(u), downgraded: true };
  return { ok: true, user: publicUser_(u) };
}

/* --------------------------- 權限（封頂：下級 ⊆ 上級） -------------------
   規矩（BUILD §3 附帶、落差報告 #9）：授權唔可以超過自己嘅層級 ——
     · 角色階級 rank：super 99 ＞ chief 5 ＞ coach 4 ＞ branch_chief 3 ＞ exec 2 ＞ member 1
     · 一個人嘅有效權限 ＝ 自己角色嘅權限 ∪ 逐人加嘅 `perms`，但**封頂到自己角色**
       （除非 actor 係 chief／super：旅長本身有嘅權限可以授落去）
     · 想加嘅權限超出自己 → **如實回報 clamped**（唔會靜靜收窄，亦唔會偷偷放寬） */
var ROLE_RANK = { super: 99, chief: 5, coach: 4, branch_chief: 3, exec: 2, coach_staff: 3, parent: 1, member: 1, guest: 0 };
var ROLE_PERMS = {
  chief: ['view_all', 'branch_view', 'share_decide', 'share_send', 'branch_link_edit', 'open_account_downstream', 'notice_publish',
    'calendar_edit', 'finance_view', 'finance_confirm', 'inventory_all', 'transfer_all', 'user_manage', 'identity_manage',
    'invite_create', 'public_edit', 'module_toggle', 'system_all', 'audit_view', 'enter_any_branch'],
  coach: ['branch_view', 'enter_granted_branch', 'share_decide', 'share_send', 'notice_publish', 'calendar_edit', 'finance_view',
    'finance_submit_troop', 'inventory_all', 'transfer_view', 'user_view', 'public_edit', 'audit_view'],
  parent: ['children_view', 'notice_view', 'calendar_view', 'share_send'],
  member: ['self_view', 'notice_view', 'calendar_view', 'branch_own', 'share_decide', 'share_send'],
  super: ['platform_all', 'enter_any_branch', 'branch_view', 'view_all', 'branch_link_edit', 'user_manage', 'audit_view'],
  guest: ['public_view']
};
function rankOf_(role) { return ROLE_RANK[String(role || '')] || 0; }
function permsOf_(role) { return (ROLE_PERMS[String(role || '')] || []).slice(); }
/** 邊個角色有嘅權限（用嚟封頂） */
function ceilingFor_(actorRole) { return permsOf_(actorRole); }
/**
 * 封頂：想加嘅 perms 只可以係自己（或者自己角色）有嘅
 * @returns {{perms:string[], clamped:string[]}}
 */
function capPerms_(want, actorRole) {
  var ceiling = ceilingFor_(actorRole);
  var allow = {}, kept = [], clamped = [];
  ceiling.forEach(function (p) { allow[p] = true; });
  (Array.isArray(want) ? want : []).forEach(function (p0) {
    var p = sanitizeLabel_(p0);
    if (!p) return;
    if (allow[p]) { if (kept.indexOf(p) < 0) kept.push(p); } else { clamped.push(p); }
  });
  return { perms: kept, clamped: clamped };
}
/** 角色昇級封頂：唔可以授一個唔低過自己嘅角色 */
function capRole_(want, actorRole) {
  var w = String(want || ''), a = String(actorRole || '');
  if (a === 'super') return { role: w, clamped: false };
  if (rankOf_(w) >= rankOf_(a)) return { role: a, clamped: true, asked: w };
  return { role: w, clamped: false };
}

/* --------------------------- 用戶 ---------------------------------------- */
function readUsers_() { return readTableAll_('旅員'); }
function findUser_(key) {
  var k = String(key || '').trim().toLowerCase();
  return readUsers_().filter(function (u) { return String(u.email || '').toLowerCase() === k || String(u.id || '') === key; })[0] || null;
}
/** 一個人嘅有效權限（角色 ∪ 逐人 perms，但逐人 perms 一樣要封頂） */
/** 邊個角色做嘢：server（apikey）＝super；有 asUser ＝查該用戶 */
function actorRole_() {
  var key = String((CTX.body && CTX.body.asUser) || '').trim();
  if (!key) return CTX.mode === 'server' ? 'super' : (CTX.mode === 'upstream' ? 'coach' : 'member');
  var u = findUser_(key);
  /* ★ fail closed：帶咗 asUser 但搵唔到／已經停用 → 當最低權限（唔會當超管） */
  if (!u || (u.status && u.status !== 'active')) return 'member';
  return String(u.role || 'member');
}
function effectivePerms_(u) {
  var base = permsOf_(u && u.role);
  var extra = capPerms_(u && u.perms, u && u.role).perms;
  return base.concat(extra.filter(function (p) { return base.indexOf(p) < 0; }));
}
function publicUser_(u) {
  if (!u) return null;
  var o = JSON.parse(JSON.stringify(u));
  ['hash', 'salt', 'pw', 'password_hash', 'password_salt', 'apiKey', 'apikey', 'setupToken'].forEach(function (k) { delete o[k]; });
  o.effectivePerms = effectivePerms_(u);          // 前端攞嚟畫掣；真正授權永遠喺 server
  return o;
}
function upsertUser_(o, via) {
  var users = readUsers_();
  var email = String(o.email || '').trim();
  if (!email) return { ok: false, msg: '要 email／YMIS' };
  var existing = users.filter(function (u) { return String(u.email || '').toLowerCase() === email.toLowerCase(); })[0];
  var hasHash = validHashPair_(o.password_hash, o.password_salt);
  var rec = existing || { id: uid_('u'), at: stamp_(), pv: 1 };
  rec.email = email; rec.name = String(o.name || rec.name || email).slice(0, 60);
  rec.role = o.role || rec.role || 'member';
  rec.status = o.status || rec.status || 'active';
  rec.branchId = o.branchId !== undefined ? sanitizeLabel_(o.branchId) : (rec.branchId || '');
  rec.identity = sanitizeLabel_(o.identity || rec.identity || '');
  rec.mustChangePw = o.mustChangePw !== undefined ? !!o.mustChangePw : !!rec.mustChangePw;
  if (hasHash) {
    rec.hash = String(o.password_hash); rec.salt = String(o.password_salt);
    rec.algo = 'pbkdf2-sha256'; rec.iter = Number(o.iter || 100000);
    if (rec.status === 'pending_hash') rec.status = 'active';
  } else if (!rec.hash) {
    rec.hash = ''; rec.salt = ''; rec.algo = 'pbkdf2-sha256'; rec.iter = Number(o.iter || 100000);
    rec.status = 'pending_hash';                    // 未落 hash ＝ 入唔到（但見到佢等緊）
  }
  rec.pv = (rec.pv || 1) + (existing ? 1 : 0);
  if (existing) { users = users.map(function (u) { return u.id === rec.id ? rec : u; }); } else { users.push(rec); }
  var w = writeTable_('旅員', users, via || 'system');
  if (!w.ok) return { ok: false, msg: w.msg };
  audit_(actor_(), '寫帳號', rec.email, (existing ? '更新' : '新增') + '（pv ' + rec.pv + '）', via || 'system');
  var out = publicUser_(rec); out._stored = true; out.needsHash = !validHashPair_(rec.hash, rec.salt);
  return out;
}

/* --------------------------- 模組開關（分頁為真相） ---------------------- */
function listModules() { return readTable_('模組開關'); }
function setModule(o) {
  var rows = listModules_();
  var rec = rows.filter(function (r) { return r.id === o.module; })[0] || { id: o.module };
  rec.mode = o.mode === 'off' ? 'off' : (o.mode === 'custom' ? 'custom' : 'all');
  rec.branches = Array.isArray(o.branches) ? o.branches.map(sanitizeLabel_) : [];
  rec.at = stamp_(); rec.by = actor_();
  rows = rows.filter(function (r) { return r.id !== o.module; }).concat([rec]);
  var w = writeTable_('模組開關', rows, actor_());
  audit_(actor_(), '改模組開關', o.module, json_({ mode: rec.mode, branches: rec.branches }), 'api');
  return w.ok ? { ok: true, module: rec } : { ok: false, msg: w.msg };
}
function listModules_() { return readTable_('模組開關'); }

/* --------------------------- 後端實況 ------------------------------------ */
function dbInfo() {
  var info = {
    app: APP, unit: unitId_(), spread: ss_().getName(), tables: [], rows: 0, broken: [], chain: null,
    /* ★ db shard 現況：邊幾張表分咗件、每件幾行（大庫睇得到，唔使打開 Sheet 數） */
    shard: { maxParts: LIMITS.maxParts || 40, rowsPerWrite: LIMITS.rowsPerWrite, sharded: 0, shards: 0, largest: null, unbalanced: [] },
    properties: { downstreams: getDownstreams().length, apiKey: !!apiKey_() }
  };
  TABLES.concat(Object.keys(LOGS)).forEach(function (t) {
    try {
      var sh = ss_().getSheetByName(t);
      if (!sh) { info.broken.push(t + '：冇分頁'); return; }
      var n = Math.max(0, sh.getLastRow() - 1);
      var parts = partSheets_(t).map(function (pn) {
        var p = ss_().getSheetByName(pn);
        return { name: pn, rows: p ? Math.max(0, p.getLastRow() - 1) : 0 };
      });
      var total = n + parts.reduce(function (a, p) { return a + p.rows; }, 0);
      info.tables.push({ name: t, rows: n, parts: parts, totalRows: total });
      info.rows += total;
      if (parts.length) {
        info.shard.sharded += 1; info.shard.shards += parts.length;
        if (!info.shard.largest || total > info.shard.largest.rows) info.shard.largest = { name: t, rows: total, parts: parts.length };
        /* 唔平衡：有分件但主分頁仲有嘢（分件寫入應該清空主分頁） */
        if (n > 0) info.shard.unbalanced.push(t + '：主分頁仲有 ' + n + ' 行（分件寫入應該清空）');
      }
    } catch (e) { info.broken.push(t + '：' + e); }
  });
  info.shard.ok = info.shard.unbalanced.length === 0;
  info.chain = verifyAuditChain_();
  return info;
}

/* --------------------------- 匯出／匯入／備份 ---------------------------- */
function exportAll() {
  var data = {};
  TABLES.concat(Object.keys(LOGS)).forEach(function (t) { data[t] = readTable_(t); });
  var payload = { meta: { app: APP.name, version: APP.version, unit: unitId_(), exportedAt: stamp_() }, data: data };
  payload.meta.sha256 = sha256Hex_(json_(payload.data));
  audit_(actor_(), '匯出全庫', 'exportAll', '表 ' + Object.keys(data).length, 'menu');
  return payload;
}
function importAll(payload, opts) {
  opts = opts || {};
  if (!payload || !payload.data) return { ok: false, msg: '格式唔啱' };
  var only = opts.only || Object.keys(payload.data);
  var out = { added: 0, updated: 0, failed: 0, tables: {} };
  only.forEach(function (t) {
    if (TABLES.indexOf(t) < 0) { out.failed++; return; }
    var rows = payload.data[t] || [];
    if (rows.length > LIMITS.importRows) { out.failed++; out.tables[t] = '太多行（>' + LIMITS.importRows + '）'; return; }
    if (t === '旅員') {
      var cur = readUsers_();
      rows.forEach(function (r) {                       // 直插 hash（唔重算）；撞號阻擋
        var dup = cur.filter(function (u) { return String(u.email).toLowerCase() === String(r.email).toLowerCase(); })[0];
        if (dup) { out.updated++; } else { out.added++; }
        if (r.hash && !isHex64_(String(r.hash))) { out.failed++; return; }
      });
      var merged = cur.slice();
      rows.forEach(function (r) {
        var i = merged.map(function (u) { return String(u.email).toLowerCase(); }).indexOf(String(r.email).toLowerCase());
        if (i >= 0) merged[i] = Object.assign(merged[i], r); else merged.push(r);
      });
      var w = writeTable_('旅員', merged, 'import'); if (!w.ok) { out.failed++; out.tables[t] = w.msg; }
    } else {
      var w2 = writeTable_(t, rows, 'import'); if (!w2.ok) { out.failed++; out.tables[t] = w2.msg; } else { out.tables[t] = rows.length; }
    }
    out.tables[t] = out.tables[t] || rows.length;
  });
  audit_(actor_(), '匯入全庫', 'importAll', json_(out), 'menu');
  return { ok: out.failed === 0, data: out };
}
/* 備份：Drive 留 13 份（BUILD §3）——多過就刪最舊；檔名帶時戳（`troop-<unit>-YYYYMMDDHHmm.json`）
   ★ 刪之前只刪**自己命名格式**嘅檔（唔會誤刪你 Drive 其他嘢） */
var BACKUP_KEEP = 13;
function backupFileName_() { return 'troop-' + (unitId_() || 'unit') + '-' + stamp_().replace(/[^\d]/g, '') + '.json'; }
function listBackups_() {
  var prefix = 'troop-' + (unitId_() || 'unit') + '-';
  var it = DriveApp.getFilesByName('');
  var out = [], guard = 0;
  try {
    var all = DriveApp.searchFiles("title contains '" + (unitId_() || 'unit') + "' and mimeType = 'application/json'");
    while (all.hasNext() && guard++ < 500) {
      var f = all.next(), nm = f.getName();
      if (nm.indexOf(prefix) === 0 && /\.json$/.test(nm)) out.push({ id: f.getId(), name: nm, at: f.getDateCreated().getTime(), size: f.getSize() });
    }
  } catch (e) { Logger.log('searchFiles fail: ' + e); }
  return out.sort(function (a, b) { return a.at - b.at; });
}
function rotateBackups_() {
  var list = listBackups_(), removed = [];
  while (list.length > BACKUP_KEEP) {
    var oldest = list.shift();
    try {
      var it = DriveApp.getFilesByName(oldest.name);
      while (it.hasNext()) { var f = it.next(); if (f.getId() === oldest.id) { f.setTrashed(true); removed.push(oldest.name); break; } }
    } catch (e) { Logger.log('trash fail: ' + e); }
  }
  return removed;
}
/** 三時機提醒（BUILD §3）：升級前／批量操作前／7 日冇備份 → 前端據此提示「先備份」 */
function backupState() {
  var rows = readTable_('備份紀錄');
  var last = rows.length ? rows[rows.length - 1] : null;
  var lastAt = last ? String(last.at || last.__at || '') : '';      // 表嘅 at 欄／JSON 內嘅 at 都認
  var ageDays = null;
  if (lastAt) {
    var t = parseStamp_(lastAt);
    if (isFinite(t)) ageDays = Math.floor((now_().getTime() - t) / 86400000);
  }
  var files = listBackups_();
  return {
    keep: BACKUP_KEEP, count: files.length, name: (files[files.length - 1] || {}).name || '',
    lastAt: lastAt, ageDays: ageDays,
    missing: !lastAt, stale: ageDays !== null && ageDays >= 7,
    remind: (!lastAt ? '未有備份紀錄：建議即刻做一次 Drive 備份（升級／批量操作之前一定要）'
      : (ageDays >= 7 ? '已經 ' + ageDays + ' 日冇備份 —— BUILD 要求每週一次、留 13 份' : '備份仲新（' + ageDays + ' 日前）')),
    /** 三個時機：升級前、批量操作前、7 日冇備份 */
    triggers: { beforeUpgrade: true, beforeBatch: true, weekly: true }
  };
}
function backupToDrive() {
  var payload = exportAll();
  var name = backupFileName_();
  var file = DriveApp.createFile(Utilities.newBlob(json_(payload), 'application/json', name));
  try { file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) { Logger.log('sharing fail: ' + e); }
  var kb = Math.round(json_(payload).length / 1024);
  pushRow_('備份紀錄', { note: 'Drive 備份', file: name, kb: kb, sha256: (payload.meta || {}).sha256 || '' });
  var removed = rotateBackups_();                    // 13 份輪替
  audit_(actor_(), '備份去 Drive', name, '私密（建立後即設 PRIVATE）；輪替刪 ' + removed.length + ' 個舊檔', 'menu');
  var keptCount = listBackups_().length;
  return {
    ok: true, name: name, kb: kb, keep: BACKUP_KEEP, kept: keptCount, rotatedOut: removed,
    msg: '已備份：' + name + '（' + kb + ' KB）' + (removed.length ? '；舊檔刪咗 ' + removed.length + ' 個（留 ' + BACKUP_KEEP + ' 份）' : '' + '（Drive 而家有 ' + listBackups_().length + ' 份）')
  };
}

/* --------------------------- 邀請 ---------------------------------------- */
function createInvite(o) {
  var token = Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
  var rec = { id: uid_('iv'), token: token, role: o.role || 'member', branchId: sanitizeLabel_(o.branchId || ''), name: String(o.name || '').slice(0, 60), email: String(o.email || ''), expiresAt: stamp_(new Date(now_().getTime() + 24 * 3600 * 1000)), used: false, at: stamp_(), by: actor_() };
  var rows = readTable_('邀請'); rows.push(rec);
  var w = writeTable_('邀請', rows, actor_());
  audit_(actor_(), '發邀請', rec.email || rec.role, '24 小時、一次性', 'api');
  return w.ok ? { ok: true, token: token, expiresAt: rec.expiresAt } : { ok: false, msg: w.msg };
}
function redeemInvite(o) {
  var rows = readTable_('邀請');
  var rec = rows.filter(function (r) { return String(r.token).toUpperCase() === String(o.token || '').toUpperCase(); })[0];
  if (!rec) return { ok: false, msg: '連結無效' };
  if (rec.used) return { ok: false, msg: '連結已用過' };
  if (new Date(String(rec.expiresAt).replace(' ', 'T')).getTime() < now_().getTime()) return { ok: false, msg: '連結已過期（24 小時）' };
  if (o.password || o.pw) return { ok: false, msg: '明文密碼唔可以過嚟：請由 /api/auth 驗完／算完 hash 先交（GAS 唔驗密碼）' };
  if (!validHashPair_(o.password_hash, o.password_salt)) return { ok: false, msg: '要 email ＋ 64 位 hex password_hash ＋ salt' };
  var u = upsertUser_({ email: o.email || rec.email, name: o.name || rec.name, role: rec.role, branchId: rec.branchId, status: 'active', mustChangePw: false, password_hash: o.password_hash, password_salt: o.password_salt }, '邀請開戶');
  rec.used = true; rec.usedAt = stamp_();
  writeTable_('邀請', rows, 'invite');
  audit_(rec.email || rec.role, '邀請開戶', rec.email || '', '一次性 token 已用', 'api');
  return { ok: true, user: publicUser_(u) };
}
function listInvites() { return readTable_('邀請').map(function (r) { delete r.token; return r; }); }
function revokeInvite(o) {
  var rows = readTable_('邀請');
  var rec = rows.filter(function (r) { return r.id === o.id; })[0];
  if (!rec) return { ok: false, msg: '搵唔到' };
  rec.used = true; rec.revoked = true; rec.revokedAt = stamp_();
  var w = writeTable_('邀請', rows, actor_()); audit_(actor_(), '撤回邀請', rec.id, '', 'api');
  return w.ok ? { ok: true } : { ok: false, msg: w.msg };
}

/* --------------------------- 本機登入通道（leaf 狀態） ------------------- */
/* 上游（平台／旅）用 sig 打 `setLocalLogin` → 我哋寫低；本機自己登入前一定要讀呢個（fail closed：冇設定＝open） */
function readGate_() {
  var rows = readTable_('設定值');
  var rec = rows.filter(function (r) { return r.id === 'localLogin'; })[0];
  return rec ? (rec.value === false || rec.value === 'false' ? false : true) : true;
}
function writeGate_(allowed, by) {
  var rows = readTable_('設定值').filter(function (r) { return r.id !== 'localLogin'; });
  rows.push({ id: 'localLogin', value: !!allowed, at: stamp_(), by: sanitizeLabel_(by || actor_()) });
  var w = writeTable_('設定值', rows, by || actor_());
  audit_(actor_(), allowed ? '開返本機直接登入' : '閂本機直接登入', 'localLogin', 'upstream=' + sanitizeLabel_(by || CTX.mode), 'sig');
  return w;
}

/** 回應正規化：內部 { ok, … } → 對外 { success, data }／{ success:false, error } */
function wrap_(r, failCode) {
  if (!r) return err_(failCode || 'fail', '冇回應');
  if (r.ok === false) return err_(failCode || 'fail', r.msg || '失敗', r.data ? { data: r.data } : null);
  var data = JSON.parse(JSON.stringify(r)); delete data.ok; delete data.msg;
  var o = ok_(data); if (r.msg) o.note = r.msg; return o;
}

/* --------------------------- 路由 ---------------------------------------- */
function doGet(e) {
  /* 只收 POST：sig 唔可以喺 GET 帶（會落 log／被 cache）。呢個 GET 只回健康檢查，唔帶任何資料。 */
  return ContentService.createTextOutput(json_(ok_({ app: APP.name, version: APP.version, note: '呢支 GAS 只收 POST' }))).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var rawBody = (e && e.postData && e.postData.contents) || '';
  var body = parseJson_(rawBody, null);
  var params = (e && e.parameter) || {};
  if (!body || typeof body !== 'object') return ContentService.createTextOutput(json_(err_('bad_json', 'body 唔係 JSON'))).setMimeType(ContentService.MimeType.JSON);
  if (rawBody.length > LIMITS.body) return ContentService.createTextOutput(json_(err_('too_big', 'body 太大（>' + Math.round(LIMITS.body / 1024) + 'KB）'))).setMimeType(ContentService.MimeType.JSON);
  var action = String(body.action || '').trim();
  CTX = { mode: 'guest', actor: '', role: '', identity: '', branch: '', body: body, ip: sanitizeLabel_(params.ip || 'sheet'), matched: [] };

  var needsLock = READ_ACTIONS.indexOf(action) < 0;          // 讀取樂觀化：讀唔上鎖
  var lock = needsLock ? LockService.getScriptLock() : null;
  var locked = needsLock ? lock.tryLock(20000) : true;
  var t0 = now_().getTime();
  try {
    if (!locked) return ContentService.createTextOutput(json_(err_('busy', '系統忙（等唔到鎖）—— 請再試'))).setMimeType(ContentService.MimeType.JSON);
    if (NEVER_ACCEPT.indexOf(action) >= 0) return ContentService.createTextOutput(json_(err_('never_accept', '呢個 action 永不經上游／簽名接受：' + action))).setMimeType(ContentService.MimeType.JSON);
    if (ACTIONS.indexOf(action) < 0) return ContentService.createTextOutput(json_(err_('unknown_action', '冇呢個 action：' + action, { allowed: ACTIONS.join(',') }))).setMimeType(ContentService.MimeType.JSON);

    /* 限流：鎖緊就唔使驗身，直接拒 */
    if (isLocked_(CTX.ip)) return lockedReply_();

    /* 驗身：apikey（server）→ sig（上游）→ login 類免簽 */
    var key = body.apikey || params.apikey || '';
    if (key) {
      if (!checkApiKey_(key)) { bumpFail_(CTX.ip); access_('AUTH_FAIL', '', CTX.ip, action); return ContentService.createTextOutput(json_(err_('bad_key', 'apikey 唔啱'))).setMimeType(ContentService.MimeType.JSON); }
      CTX.mode = 'server'; CTX.actor = '（server）'; clearFails_(CTX.ip);
    } else if (body.sig || params.sig) {
      var v = verifySig_(action, rawBody, params, body);
      if (!v.ok) { bumpFail_(CTX.ip); access_('SIG_FAIL', '', CTX.ip, action + '：' + v.msg + (v.jti ? ('｜jti=' + v.jti.slice(0, 8)) : '')); return ContentService.createTextOutput(json_(err_('bad_sig', v.msg))).setMimeType(ContentService.MimeType.JSON); }
      CTX.mode = 'upstream'; CTX.actor = 'upstream'; clearFails_(CTX.ip);
    } else if (ANON_WRITE_ACTIONS.indexOf(action) >= 0) {
      /* 純邀請制：自助申請一律唔收（開戶申請） */
      if (action === 'accountApply' && readApplyMode_() === 'invite-only') {
        return ContentService.createTextOutput(json_(err_('invite_only', '呢個旅係純邀請制：只收旅長／教練員發出嘅邀請連結'))).setMimeType(ContentService.MimeType.JSON);
      }
      /* 匿名可寫（求救）：有上限；落 `操作紀錄` 記低（誰／邊個 IP／幾時） */
      var fam = action === 'saveRescue' ? 'rescue' : 'apply';
      var q = anonQuotaOk_(CTX.ip, fam);
      if (!q.ok) {
        access_('ANON_LIMIT', '', CTX.ip, action + '：' + fam + ' 已經 ' + q.used + '/' + q.max);
        return ContentService.createTextOutput(json_(err_('rate_limited', fam === 'rescue'
          ? '同一個網絡每個鐘最多送 3 單求救 —— 請等一等，或者用官方回報頁'
          : '同一個網絡每個鐘最多送 10 單申請 —— 請等一等'))).setMimeType(ContentService.MimeType.JSON);
      }
      access_('ANON_WRITE', '', CTX.ip, action);
    } else if (['login', 'superLogin', 'redeemInvite', 'status', 'getDownstreams', 'registry'].indexOf(action) < 0) {
      return ContentService.createTextOutput(json_(err_('need_auth', '要 apikey 或 sig（或者用 login 類 action）'))).setMimeType(ContentService.MimeType.JSON);
    }

    var res = dispatch_(action, body, params);
    var ms = now_().getTime() - t0;
    if (CTX.mode !== 'guest') sync_(CTX.mode, action, APP.version, res && res.success === true, ms);
    return ContentService.createTextOutput(json_(res)).setMimeType(ContentService.MimeType.JSON);
  } catch (ex) {
    Logger.log('doPost error: ' + ex);
    return ContentService.createTextOutput(json_(err_('exception', String(ex && ex.message || ex)))).setMimeType(ContentService.MimeType.JSON);
  } finally { if (locked && lock) lock.releaseLock(); }        // 讀取樂觀化：讀冇 lock 物件
}

function dispatch_(action, body, params) {
  /* 敏感 action 只可以由 server（apikey）打 */
  if (SERVER_ONLY.indexOf(action) >= 0 && CTX.mode !== 'server') return err_('server_only', '呢個 action 只可以由 server（apikey）打');

  /* mustChangePw 閘：未改密碼之前只可以做極少數事 */
  if (CTX.mode === 'server' && body.asUser) {
    var me = findUser_(body.asUser);
    if (me && me.mustChangePw && ['changePassword', 'status', 'load'].indexOf(action) < 0) return err_('must_change_pw', '要先改密碼');
    if (me) { CTX.actor = me.email; CTX.role = me.role; CTX.identity = me.identity || ''; CTX.branch = me.branchId || ''; }
  }
  if (CTX.mode === 'upstream') {
    /* 上游（帶 sig）只可以做白名單內嘅讀／寫；本 GAS 嘅管理 action 唔收上游 */
    if (READ_ACTIONS.concat(WRITE_ACTIONS).indexOf(action) < 0) return err_('not_allowed_upstream', '上游唔可以做呢個 action');
    if (WRITE_ACTIONS.indexOf(action) >= 0) audit_('upstream', '簽名寫入', action, 'on_behalf=' + sanitizeLabel_(body.on_behalf || ''), 'sig');
  }

  switch (action) {
    case 'status': return ok_({ app: APP.name, version: APP.version, unit: unitId_(), ready: !!apiKey_(), tables: TABLES.length });
    case 'dbInfo': return ok_(dbInfo());
    case 'load': {
      var name = String(body.table || ''); if (TABLES.indexOf(name) < 0) return err_('bad_table', '冇呢個表：' + name);
      var rows = readTableAll_(name);          // 分件都讀齊
      var sensitive = (body.withSecrets === true) && CTX.mode === 'server' && !body.asUser;
      /* ★ 保持「回一個 array」嘅舊合約（唔少讀者靠佢）；要版本就用 getVersion 或 loadTables */
      return ok_(sensitive ? rows : rows.map(function (r) { return publicUser_(r); }));
    }
    case 'loadTables': {
      /* 讀取樂觀化：pointer 覆查（唔上全域鎖）—— 兩次讀到同一版本＝一致 */
      var want = (body.tables && body.tables.length ? body.tables : TABLES).filter(function (t) { return TABLES.indexOf(t) >= 0; });
      var vBefore = readVersion_(), data = {}, vAfter = vBefore, stable = true, rounds = 0;
      for (var r = 0; r < 3; r++) {
        rounds = r + 1;
        vBefore = readVersion_();
        data = {};
        want.forEach(function (t) { data[t] = readTableAll_(t).map(publicUser_); });
        vAfter = readVersion_();
        if (vAfter === vBefore) { stable = true; break; }
        stable = false;
      }
      return ok_({
        data: data, version: vBefore, appVersion: APP.version,
        consistent: stable, readRounds: rounds,
        note: stable ? '' : '讀取期間有人寫入（已重試 ' + rounds + ' 次）—— 版本以 version 為準，寫入會照樣行樂觀鎖'
      });
    }
    case 'getVersion': return ok_({ version: readVersion_(), appVersion: APP.version, consistent: true });
    case 'saveTables': {
      if (!body.data || typeof body.data !== 'object') return err_('bad_data', '冇 data');
      /* 樂觀鎖：帶咗 baseVersion 而對唔上（有人搶先寫）→ 唔寫，回 conflict ＋現行版本 */
      var vc = versionCheck_(body.baseVersion);
      if (!vc.ok) return err_('conflict', '有人搶先寫過（版本對唔上）—— 請重新讀再合併', { version: vc.cur, conflict: true });
      var wrote = {}, fails = [];
      Object.keys(body.data).forEach(function (t) {
        if (TABLES.indexOf(t) < 0) { fails.push(t + '：唔喺白名單'); return; }
        var w = writeSharded_(t, body.data[t] || [], actor_());      // 超上限自動分件（大庫分件）
        if (w.ok) { wrote[t] = (body.data[t] || []).length; } else { fails.push(t + '：' + w.msg); }
      });
      var back = {}; Object.keys(wrote).forEach(function (t) { back[t] = readTableAll_(t).length; });   // 自證要計埋分件
      var confirmed = fails.length === 0 && Object.keys(wrote).every(function (t) { return back[t] >= wrote[t]; });
      var newVersion = confirmed ? bumpVersion_() : vc.cur;         // 寫成功先算新版本（失敗＝版本唔郁）
      sync_(CTX.mode, Object.keys(wrote).join(','), newVersion, confirmed, 0);
      audit_(actor_(), '逐表寫入', Object.keys(wrote).join(','), 'confirmed=' + confirmed + '｜v=' + newVersion + (fails.length ? ('；失敗：' + fails.join(' / ')) : ''), CTX.mode === 'server' ? 'api' : 'sig');
      return ok_({ confirmed: confirmed, wrote: wrote, readBack: back, fails: fails, version: newVersion });
    }
    case 'saveTable': {
      if (TABLES.indexOf(body.table) < 0) return err_('bad_table', '冇呢個表');
      var vc2 = versionCheck_(body.baseVersion);
      if (!vc2.ok) return err_('conflict', '有人搶先寫過（版本對唔上）—— 請重新讀再合併', { version: vc2.cur, conflict: true });
      var w2 = writeSharded_(body.table, body.rows || [], actor_());     // 超上限自動分件
      if (!w2.ok) return err_('write_fail', w2.msg);
      return ok_({ confirmed: true, rows: w2.rows, parts: w2.parts || [], version: bumpVersion_() });
    }
    case 'authUser': {
      var u = findUser_(body.email);
      if (!u) { access_('LOGIN_FAIL', body.email, CTX.ip, '搵唔到帳號'); return err_('no_user', '搵唔到帳號'); }
      if (u.status !== 'active') { access_('LOGIN_FAIL', u.email, CTX.ip, 'status=' + u.status); return err_('disabled', '帳號停用咗'); }
      return ok_({ id: u.id, email: u.email, role: u.role, name: u.name, branchId: u.branchId || '', identity: u.identity || '', algo: u.algo || 'pbkdf2-sha256', iter: u.iter || 100000, salt: u.salt, hash: u.hash, pv: u.pv || 1, mustChangePw: !!u.mustChangePw, status: u.status });
    }
    case 'login': {
      /* 中央登入：帶 super_ticket → 回打固定端點驗票（一次性、60 秒）；冇票 → 誠實拒絕 */
      if (body.super_ticket) {
        var v2 = verifySuperTicket_(body.super_ticket);
        if (!v2.ok) { access_('LOGIN_FAIL', body.email || '', CTX.ip, 'super_ticket：' + v2.msg); return err_('bad_ticket', v2.msg); }
        var u3 = findUser_(v2.data.email || body.email);
        if (!u3) return err_('no_user', '票據 OK，但旅 SHEET 冇呢個帳號');
        access_('LOGIN_OK', u3.email, CTX.ip, 'via=super');
        return ok_({ user: publicUser_(u3), via: 'super', mustChangePw: !!u3.mustChangePw });
      }
      access_('LOGIN_FAIL', body.email || '', CTX.ip, 'local password：唔喺 GAS 驗');
      return err_('use_api_auth', '密碼登入由 /api/auth 處理（PBKDF2 ≥100k 喺 Node 先夠快）；呢支 GAS 唔會代驗密碼');
    }
    case 'superLogin': return dispatch_('login', body, params);
    case 'issueResetToken': return issueResetToken(body);
    case 'setupWithToken': {
      /* 第一個旅長：/api/auth 用一次性 setup token 交 hash 落嚟（GAS 唔經手明文） */
      if (CTX.mode !== 'server') return err_('server_only', '要 server 側做');
      if (!validHashPair_(body.password_hash, body.password_salt)) return err_('bad_hash', '要 64 位 hex password_hash ＋ salt');
      var rowsT = readUsers_(), iT = rowsT.map(function (r) { return String(r.setupToken || ''); }).indexOf(String(body.token || ''));
      if (iT < 0) return err_('bad_token', 'setup token 唔啱（或者已經用過）');
      /* 重設連結有時限（第一個旅長嘅 setup token 冇 exp ＝當長期有效，兼容舊流程） */
      if (rowsT[iT].setupExp && String(rowsT[iT].setupExp) < new Date().toISOString()) {
        return err_('token_expired', '連結已經過期 —— 請重新要求一次');
      }
      rowsT[iT].hash = String(body.password_hash); rowsT[iT].salt = String(body.password_salt);
      rowsT[iT].algo = 'pbkdf2-sha256'; rowsT[iT].iter = Number(body.iter || 100000);
      rowsT[iT].status = 'active'; rowsT[iT].pv = 1; rowsT[iT].mustChangePw = false;
      delete rowsT[iT].setupToken; delete rowsT[iT].setupAt; delete rowsT[iT].setupExp;
      var wT = writeTable_('旅員', rowsT, 'setup');
      if (!wT.ok) return err_('write_fail', wT.msg);
      audit_('（setup）', '第一個旅長設密碼', rowsT[iT].email, 'setup token 已消耗', 'api');
      return ok_({ email: rowsT[iT].email, ready: true });
    }
    case 'logAccess': return ok_(access_(String(body.kind || 'INFO'), body.email || '', CTX.ip, String(body.meta || '').slice(0, 200)));
    case 'changePassword': {
      /* 由 /api/auth 驗完舊密碼之後呼叫；hash 一律喺 server 側算 */
      if (CTX.mode !== 'server') return err_('server_only', '改密碼要 server 側做');
      if (!body.email || !isHex64_(String(body.password_hash || ''))) return err_('bad_hash', '要 email ＋ 64 位 hex password_hash');
      var rowsI = readUsers_();
      var idx = rowsI.map(function (x) { return String(x.email).toLowerCase(); }).indexOf(String(body.email).toLowerCase());
      if (idx < 0) return err_('no_user', '搵唔到帳號');
      rowsI[idx].hash = String(body.password_hash); rowsI[idx].salt = String(body.password_salt || rowsI[idx].salt || ''); rowsI[idx].algo = 'pbkdf2-sha256'; rowsI[idx].iter = Number(body.iter || 100000);
      rowsI[idx].pv = (rowsI[idx].pv || 1) + 1; rowsI[idx].mustChangePw = false; rowsI[idx].at = stamp_();
      rowsI[idx].status = rowsI[idx].status === 'pending_hash' ? 'active' : rowsI[idx].status;
      delete rowsI[idx].setupToken; delete rowsI[idx].setupAt;
      var w3 = writeTable_('旅員', rowsI, 'api');
      if (!w3.ok) return err_('write_fail', w3.msg);
      audit_(body.email, '改密碼', body.email, 'pv → ' + rowsI[idx].pv, 'api');
      return ok_({ pv: rowsI[idx].pv });
    }
    case 'createInvite': return wrap_(createInvite(body), 'invite_fail');
    case 'redeemInvite': return redeemInvite(body);
    case 'listInvites': return ok_(listInvites());
    case 'revokeInvite': return wrap_(revokeInvite(body), 'invite_fail');
    case 'getDownstreams': return ok_(getDownstreams());
    case 'registerDownstream': return wrap_(registerDownstream(body), 'register_fail');
    case 'testDownstream': return wrap_(testDownstream(body.id), 'test_fail');
    case 'updateDownstream': return wrap_(updateDownstream(body), 'update_fail');
    case 'removeDownstream': return wrap_(removeDownstream(body.id), 'remove_fail');
    case 'setLocalLogin': case 'setGate': {
      /* 上游叫我閂／開本機通道 → 寫低；我自己做上游 → sig 打下游 */
      if (CTX.mode === 'upstream') {
        var w4 = writeGate_(body.gate !== 'sig-only', body.by);
        return w4.ok ? ok_({ localLogin: readGate_(), confirmed: true }) : err_('write_fail', w4.msg);
      }
      return wrap_(setLocalLogin(body), 'gate_fail');
    }
    case 'getLoginMode': return ok_({ localLogin: readGate_(), mode: readGate_() ? 'open' : 'sig-only' });
    case 'getLinkState': return ok_({ unit: unitId_(), app: APP.version, localLogin: readGate_(), linked: getDownstreams().length > 0, downstreams: getDownstreams() });
    case 'openAccountForDownstream': return wrap_(openAccountForDownstream(body), 'open_account_fail');
    case 'listModules': return ok_(listModules());
    case 'setModule': return wrap_(setModule(body), 'module_fail');
    case 'exportAll': return ok_(exportAll());
    case 'importAll': {
      var imp = importAll(body.payload || body, body.opts || {});
      return imp.ok ? ok_(imp.data) : err_('import_partial', '匯入有失敗（詳情見 data）', { data: imp.data });
    }
    /* ---- 上游（平台／旅）對我哋用嘅讀 action ---- */
    case 'getAllUsers': return ok_(readUsers_().map(publicUser_));
    case 'getMembers': return ok_(readTable_('旅員').map(publicUser_));
    case 'getNotices': return ok_(readTable_('旅通告'));
    case 'getFinance': return ok_(readTable_('財務整合'));
    case 'getInventory': return ok_(readTable_('物資整合'));
    case 'getCalendar': return ok_(readTable_('旅行事曆'));
    case 'getPublicProfile': return ok_(readTable_('公開資料'));
    case 'getApplications': return ok_(readTable_('申請'));
    case 'getConfig': return ok_({ unit: unitId_(), app: APP, modules: listModules_(), localLogin: readGate_(), applyMode: readApplyMode_() });
    case 'getSummary': return ok_({
      unit: unitId_(), name: (readTable_('公開資料')[0] || {}).name || '',
      branches: readTable_('支部').length, users: readUsers_().length,
      notices: readTable_('旅通告').length, rescues: readTable_('求救').filter(function (r) { return r.state !== 'done'; }).length,
      finance: readTable_('財務整合').length, inventory: readTable_('物資整合').length,
      shares: readTable_('分享').length,
      units: registry()                     // 支部燈號（綠／黃／紅＋原因＋時間）
    });
    case 'getAuditLog': return ok_(readTable_('審計紀錄').slice(-Number(body.limit || 200)));
    /* ---- 上游對我哋用嘅寫 action ---- */
    case 'save': case 'saveTable2': {
      if (TABLES.indexOf(body.table) < 0) return err_('bad_table', '冇呢個表');
      var w5 = writeTable_(body.table, body.rows || [], actor_());
      return w5.ok ? ok_({ confirmed: true, rows: w5.rows }) : err_('write_fail', w5.msg);
    }
    case 'importUsers': {
      var cur = readUsers_(), added = 0, updated = 0, bad = 0;
      (body.users || []).forEach(function (r) {
        if (r.hash && !isHex64_(String(r.hash))) { bad++; return; }
        var i = cur.map(function (u) { return String(u.email).toLowerCase(); }).indexOf(String(r.email || '').toLowerCase());
        if (i >= 0) { cur[i] = Object.assign(cur[i], r); updated++; } else { cur.push(r); added++; }
      });
      var w6 = writeTable_('旅員', cur, actor_());
      audit_(actor_(), '匯入用戶', 'importUsers', 'added=' + added + ' updated=' + updated + ' bad=' + bad, 'sig');
      return w6.ok ? ok_({ added: added, updated: updated, failed: bad, hashKept: true }) : err_('write_fail', w6.msg);
    }
    case 'addMember': case 'bulkAddUsers': {
      var list = body.users || [body.user || {}], n = 0;
      list.forEach(function (u0) { var r0 = upsertUser_(u0, 'sig'); if (r0 && r0.ok !== false) n++; });
      return ok_({ added: n });
    }
    case 'updateUserProfile': {
      var rows2 = readUsers_(), i2 = rows2.map(function (r) { return r.id; }).indexOf(body.id);
      if (i2 < 0) return err_('no_user', '搵唔到');
      ['name', 'identity', 'phone', 'ymis', 'ageGroup', 'title'].forEach(function (k) { if (body[k] !== undefined) rows2[i2][k] = String(body[k]).slice(0, 60); });
      var w7 = writeTable_('旅員', rows2, actor_());
      return w7.ok ? ok_(publicUser_(rows2[i2])) : err_('write_fail', w7.msg);
    }
    case 'updateUserRole': case 'updatePermissions': {
      var rows3 = readUsers_(), i3 = rows3.map(function (r) { return r.id; }).indexOf(body.id);
      if (i3 < 0) return err_('no_user', '搵唔到');
      /* ★ 封頂：唔可以授一個唔低過自己嘅角色；權限只可以授自己角色有嘅 */
      var actorRole = actorRole_();
      var clamped = { role: [], perms: [] };
      if (body.role !== undefined) {
        var cr = capRole_(body.role, actorRole);
        rows3[i3].role = cr.role;
        if (cr.clamped) clamped.role.push(cr.asked + '→' + cr.role + '（唔可以授唔低過自己嘅角色）');
      }
      if (body.perms !== undefined) {
        var cp = capPerms_(body.perms, actorRole);
        rows3[i3].perms = cp.perms;
        if (cp.clamped.length) clamped.perms = cp.clamped;
      }
      var w8 = writeTable_('旅員', rows3, actor_());
      if (!w8.ok) return err_('write_fail', w8.msg);
      var outU = publicUser_(rows3[i3]);
      if (clamped.role.length || clamped.perms.length) {
        outU.clamped = clamped;
        return ok_({ user: outU, clamped: clamped, note: '有啲權限超出你嘅層級，已經如實封頂（冇靜靜放寬）' });
      }
      return ok_(outU);
    }
    case 'setUserStatus': return setUserStatus(body);
    case 'deleteUser': return deleteUser(body);
    case 'resetPassword': return resetPassword(body);
    case 'upsertUser': return upsertUser(body);
    case 'saveNotice': return saveNotice(body);
    case 'saveShare': return saveShare(body);
    case 'saveRescue': return saveRescue(body);
    case 'noticeSignup': return noticeSignup(body);
    case 'borrowApply': return borrowApply(body);
    case 'financeApply': return financeApply(body);
    case 'progressApply': return progressApply(body);
    case 'accountApply': return accountApply(body);
    case 'bindChild': return bindChild(body);
    case 'decideBind': return decideBind(body);
    case 'transferOut': return transferOut(body);
    case 'importTransferBundle': return importTransferBundle(body);
    case 'decideApplication': return decideApplication(body);
    case 'setApplyMode': return wrap_(setApplyMode(body), 'mode_fail');
    case 'getApplyMode': return ok_({ mode: readApplyMode_() });
    case 'registry': return ok_(registry());
    case 'deleteRow': return deleteRow(body);
    case 'saveDbPart': {
      /* 前端主動分件：{ table, part, rows, reset }；part=0 ＝主分頁 */
      if (TABLES.indexOf(body.table) < 0) return err_('bad_table', '冇呢個表');
      var pn = Number(body.part || 0);
      if (pn < 0 || pn > 50) return err_('bad_part', '件號 0–50');
      var target = pn === 0 ? body.table : partName_(body.table, pn);
      if (body.reset && pn === 0) dropParts_(body.table);          // reset＝清走舊分件（連分頁刪埋）
      var wp = writeTable_(target, body.rows || [], actor_());
      return wp.ok ? ok_({ part: pn, sheet: target, rows: (body.rows || []).length, confirmed: true }) : err_('write_fail', wp.msg);
    }
    case 'purgeTombstones': return ok_({ purged: purgeTombstones() });
    case 'backupState': return ok_(backupState());
    case 'purgeLeftMembers': {
      var pl = purgeLeftMembers(body);
      return pl.ok ? ok_(pl) : err_('purge_fail', pl.msg || '清唔到');
    }
    case 'dataInventory': return ok_({ items: dataInventory(), leftPurgeDays: LEFT_PURGE_DAYS });
    case 'getTombstones': {
      var tl = tombstones();
      if (body.table) tl = tl.filter(function (x) { return x.table === body.table; });
      return ok_(tl.slice(-Number(body.limit || 500)));
    }
    case 'setUnitStatus': return wrap_(setUnitStatus(body), 'status_fail');
    case 'saveFinanceEntry': return saveFinanceEntry(body);
    case 'saveAudit': return ok_(audit_(actor_(), body.actionName || '（前端）', body.target || '', body.detail || '', 'ui'));
    case 'getAccessLog': return ok_(readTable_('操作紀錄').slice(-Number(body.limit || 200)));
    case 'purgeOldLogs': return purgeOldLogs();
    case 'backupToDrive': return backupToDrive();
    default: return err_('unhandled', '未實作：' + action);
  }
}

/* --------------------------- 更新／刪除用戶（下游側寫入用） -------------- */
function upsertUser(o) { return ok_(publicUser_(upsertUser_(o.user || o, 'sig'))); }
function setUserStatus(o) {
  var rows = readUsers_(); var i = rows.map(function (r) { return r.id; }).indexOf(o.id);
  if (i < 0) return err_('no_user', '搵唔到');
  rows[i].status = sanitizeLabel_(o.status || 'active'); rows[i].at = stamp_();
  var w = writeTable_('旅員', rows, 'sig'); audit_(actor_(), '改帳號狀態', rows[i].email, rows[i].status, 'sig');
  return w.ok ? ok_({ status: rows[i].status }) : err_('write_fail', w.msg);
}
function deleteUser(o) {
  var rows = readUsers_();
  var leaders = rows.filter(function (r) { return r.role === 'chief' && r.status === 'active' && r.id !== o.id; });
  var target = rows.filter(function (r) { return r.id === o.id; })[0];
  if (!target) return err_('no_user', '搵唔到');
  if (target.role === 'chief' && !leaders.length) return err_('keep_one', '旅長係最後一個領袖戶 —— 唔可以刪（帳號下限：每個 leaf 至少留 1 個）');
  var before = rows.length;
  rows = rows.filter(function (r) { return r.id !== o.id; });
  var w = writeTable_('旅員', rows, 'sig');
  if (w.ok) { pushRow_('備份紀錄', { note: '已移除帳號', removed: target.email, role: target.role }); audit_(actor_(), '刪除帳號', target.email, '剩 ' + rows.length + '/' + before, 'sig'); }
  return w.ok ? ok_({ removed: target.email }) : err_('write_fail', w.msg);
}
function resetPassword(o) {
  var rows = readUsers_(), i = rows.map(function (r) { return r.email; }).indexOf(o.email);
  if (i < 0) return err_('no_user', '搵唔到帳號');
  if (!isHex64_(String(o.password_hash || ''))) return err_('bad_hash', '要 64 位 hex password_hash');
  rows[i].hash = String(o.password_hash); rows[i].salt = String(o.password_salt || rows[i].salt); rows[i].mustChangePw = true; rows[i].pv = (rows[i].pv || 1) + 1;
  var w = writeTable_('旅員', rows, 'api'); audit_(actor_(), '重設密碼', o.email, '首登強制改', 'api');
  return w.ok ? ok_({ mustChangePw: true }) : err_('write_fail', w.msg);
}
/** 分享（旅側發起 → 支部收件方決定）寫入 `分享` 表 */
function saveShare(o) {
  var rec = Object.assign({ id: uid_('sh'), at: stamp_(), by: actor_(), state: 'pending' }, o.share || {});
  rec.title = String(rec.title || '').slice(0, 120);
  rec.to = Array.isArray(rec.to) ? rec.to.map(sanitizeLabel_).slice(0, 50) : [];
  if (!rec.title) return err_('bad_share', '分享要有標題');
  var rows = readTable_('分享').filter(function (r) { return r.id !== rec.id; }); rows.push(rec);
  var w = writeTable_('分享', rows, actor_());
  if (!w.ok) return err_('write_fail', w.msg);
  audit_(actor_(), '發起分享', rec.id, rec.title + ' → ' + (rec.to.join('、') || '（未揀對象）'), CTX.mode === 'server' ? 'api' : 'ui');
  return ok_({ saved: true, id: rec.id, to: rec.to, state: rec.state });
}
/** 匿名申報 → `申請` 待批表（唯一入口；領袖對名冊核對之後批／拒）
    去重規矩（照 BUILD）：同通告同名去重／同 YMIS 待批唯一／同支部同期唯一 */
function applyPush_(kind, o, dedupeKey) {
  if (!ANON_APPLY_KINDS[kind]) return err_('bad_kind', '唔支援呢種申請：' + kind);
  var rows = readTable_('申請');
  if (dedupeKey) {
    var dup = rows.filter(function (r) {
      return String(r.kind) === kind && String(r.dedupe || '') === dedupeKey && String(r.state || 'pending') === 'pending';
    })[0];
    if (dup) return ok_({ duplicate: true, id: dup.id, state: dup.state, note: '同一個申請已經待批（唔會重複）' });
  }
  var rec = {
    id: uid_('ap'), kind: kind, at: stamp_(),
    name: String(o.name || '').slice(0, ANON_MAX_ROWS.name),
    contact: String(o.contact || '').slice(0, ANON_MAX_ROWS.contact),
    ymis: sanitizeLabel_(o.ymis || ''),
    branchId: sanitizeLabel_(o.branchId || ''),
    email: String(o.email || '').slice(0, 80),
    title: String(o.title || '').slice(0, ANON_MAX_ROWS.title),
    note: String(o.note || '').slice(0, ANON_MAX_ROWS.note),
    ref: sanitizeLabel_(o.ref || ''),                 // 通告／物資／期數嘅 id
    consent: !!(o.consent),                           // PDPO：開戶要家長／監護人同意（前端一定要見到打勾）
    state: 'pending', via: 'anon', ip: String(CTX.ip || '').slice(0, 40),
    dedupe: dedupeKey || '', decidedBy: '', decidedAt: '', reason: ''
  };
  rows.push(rec);
  var w = writeTable_('申請', rows, rec.name || '（免登入）');
  if (!w.ok) return err_('write_fail', w.msg);
  audit_('（免登入）', '收到申請：' + kind, rec.id, rec.title || rec.ref || rec.ymis, 'anon');
  return ok_({ saved: true, id: rec.id, kind: kind, state: 'pending', at: rec.at });
}
/** 通告報名（免登入）：同通告同名去重 */
function noticeSignup(o) {
  if (!o.ref && !o.noticeId) return err_('bad_ref', '要通告編號');
  var ref = sanitizeLabel_(o.ref || o.noticeId);
  return applyPush_('signup', o, ref + '|' + sanitizeLabel_(o.name) + '|' + sanitizeLabel_(o.ymis));
}
/** 物資借用（免登入）：同一人同一件同一日唔重複 */
function borrowApply(o) {
  if (!o.ref) return err_('bad_ref', '要物資編號');
  return applyPush_('borrow', o, sanitizeLabel_(o.ref) + '|' + sanitizeLabel_(o.ymis || o.name) + '|' + stamp_().slice(0, 10));
}
/** 收支申報（免登入；支部用）：同支部同期唯一 */
function financeApply(o) {
  return applyPush_('finance', o, sanitizeLabel_(o.branchId) + '|' + sanitizeLabel_(o.period));
}
/** 進度申報（免登入；支部用）：同支部同期唯一 */
function progressApply(o) {
  return applyPush_('progress', o, sanitizeLabel_(o.branchId) + '|' + sanitizeLabel_(o.period));
}
/** 開戶申請（免登入；成員入口）：**同 YMIS 待批唯一** */
function accountApply(o) {
  if (!o.ymis) return err_('bad_ymis', '要 YMIS（唔係會員編號唔開得戶）');
  if (readUsers_().some(function (u) { return String(u.ymis || '') === String(o.ymis); })) {
    return ok_({ duplicate: true, note: '呢個 YMIS 已經有戶口（唔使再申請）' });
  }
  return applyPush_('account', o, sanitizeLabel_(o.ymis));
}
/** 領袖決定（批／拒）：拒＝一定要有原因；批 account ＝ 回一張一次性邀請 token */
function decideApplication(o) {
  var rows = readTable_('申請'), i = rows.map(function (r) { return String(r.id); }).indexOf(String(o.id));
  if (i < 0) return err_('no_app', '搵唔到呢張申請');
  var decide = String(o.decide || '');
  if (decide === 'reject') {
    if (!String(o.reason || '').trim()) return err_('need_reason', '拒絕一定要寫原因（會通知申請人）');
    rows[i].state = 'rejected'; rows[i].reason = String(o.reason).slice(0, 200);
  } else if (decide === 'approve') {
    rows[i].state = 'approved'; rows[i].reason = '';
  } else return err_('bad_decide', "decide 只可以 approve／reject");
  rows[i].decidedBy = actor_(); rows[i].decidedAt = stamp_();
  var w = writeTable_('申請', rows, actor_());
  if (!w.ok) return err_('write_fail', w.msg);
  audit_(actor_(), decide === 'approve' ? '批准申請' : '拒絕申請', rows[i].id, rows[i].kind + (rows[i].reason ? '：' + rows[i].reason : ''), CTX.mode === 'server' ? 'api' : 'ui');
  var out = { id: rows[i].id, kind: rows[i].kind, state: rows[i].state };
  /* 批開戶：**批 ＝ 開戶或邀請連結**（照 BUILD §7） */
  if (decide === 'approve' && rows[i].kind === 'account') {
    var inv = createInvite({ role: 'member', branchId: rows[i].branchId, name: rows[i].name, email: rows[i].email });
    if (inv.ok) { out.inviteToken = inv.token; out.inviteExpiresAt = inv.expiresAt; }
    else out.inviteError = inv.msg;
  }
  return ok_(out);
}
/** 純邀請制開關（BUILD §7：領袖可改純邀請制） */
function setApplyMode(o) {
  var rows = readTable_('設定值').filter(function (r) { return String(r.id) !== 'applyMode'; });
  var mode = o.mode === 'invite-only' ? 'invite-only' : 'open';
  rows.push({ id: 'applyMode', value: mode, at: stamp_(), by: actor_() });
  var w = writeTable_('設定值', rows, actor_());
  audit_(actor_(), '改開戶申請模式', mode, mode === 'invite-only' ? '純邀請制（唔收自助申請）' : '開放申請', 'api');
  return w.ok ? { ok: true, mode: mode } : { ok: false, msg: w.msg };
}
function readApplyMode_() {
  var r = readTable_('設定值').filter(function (x) { return String(x.id) === 'applyMode'; })[0];
  return r && r.value === 'invite-only' ? 'invite-only' : 'open';
}
/** 求救／問題回報**落旅 SHEET**（免登入都寫得：只可以 append，唔可以覆蓋其他人嘅單） */
/* ========================= 家長子女綁定（BUILD §2 / §13 ③） =========================
   規矩：家長**自己**申請（用自己 email）→ 該團領袖確認 → 先寫落 children。
   為咩要確認：唔係嘅話任何人打個 YMIS 就睇到人哋個仔嘅資料。
   綁定用**全球 SCOUT_ID**（YMIS），所以升團／轉支部零改動。
   ================================================================================== */
function bindChild(o) {
  var ymis = sanitizeLabel_(String(o.ymis || '').trim().toUpperCase());
  if (!ymis) return err_('bad_ymis', '要子女 YMIS／SCOUT_ID');
  var email = String(o.email || '').toLowerCase();
  if (!email) return err_('bad_email', '要家長 email（要用你自己個戶口）');
  var users = readUsers_();
  var parent = users.filter(function (u) {
    return String(u.email || '').toLowerCase() === email && String(u.role || '') === 'parent';
  })[0];
  if (!parent) return err_('no_parent', '搵唔到呢個家長戶 —— 要用你自己登入嘅 email');
  var kids = (parent.children || parent.childrenIds || []).map(String);
  if (kids.indexOf(ymis) >= 0) return ok_({ duplicate: true, note: '呢個子女已經綁咗（唔使再申請）' });
  /* 對名冊：唔可以綁一個唔存在嘅編號（防亂輸入） */
  var child = users.filter(function (u) { return String(u.ymis || '').trim().toUpperCase() === ymis; })[0];
  if (!child) return err_('no_child', '名冊搵唔到呢個編號 —— 請確認 YMIS（或者等該團先加入名冊）');
  if (String(child.role || '') === 'super') return err_('no_child', '（呢個編號唔可以綁）');
  var rows = readTable_('申請');
  var dup = rows.filter(function (r) {
    return String(r.kind) === 'bind' && String(r.ymis) === ymis
      && String(r.email || '').toLowerCase() === email && String(r.state || 'pending') === 'pending';
  })[0];
  if (dup) return ok_({ duplicate: true, id: dup.id, note: '同一個綁定已經待批（唔會重複）' });
  var rec = {
    id: uid_('ap'), kind: 'bind', at: stamp_(),
    name: String(parent.name || '').slice(0, 60), email: email, ymis: ymis,
    branchId: sanitizeLabel_(child.branchId || ''), title: String(child.name || '').slice(0, 60),
    note: String(o.note || '').slice(0, 200), consent: !!o.consent,
    state: 'pending', via: CTX.mode === 'server' ? 'api' : 'ui', ip: String(CTX.ip || '').slice(0, 40),
    dedupe: ymis + '|' + email, decidedBy: '', decidedAt: '', reason: ''
  };
  rows.push(rec);
  var w = writeTable_('申請', rows, rec.name || 'parent');
  if (!w.ok) return err_('write_fail', w.msg);
  audit_(actor_(), '家長申請綁定子女', ymis, '家長 ' + email + '｜待該團領袖確認', 'parent');
  return ok_({ saved: true, id: rec.id, state: 'pending', childName: child.name, branchId: child.branchId, note: '要該團領袖確認先睇到' });
}
function decideBind(o) {
  var rows = readTable_('申請');
  var i = rows.map(function (r) { return String(r.id); }).indexOf(String(o.id));
  if (i < 0) return err_('no_app', '搵唔到呢張申請');
  if (String(rows[i].kind) !== 'bind') return err_('bad_kind', '呢張唔係子女綁定申請');
  if (String(rows[i].state || 'pending') !== 'pending') return err_('decided', '呢張已經處理過（唔會改第二次）');
  var decide = String(o.decide || '');
  var at = stamp_();
  if (decide === 'reject') {
    if (!String(o.reason || '').trim()) return err_('need_reason', '拒絕一定要寫原因（會通知家長）');
    rows[i].state = 'rejected'; rows[i].reason = String(o.reason).slice(0, 200);
    rows[i].decidedBy = actor_(); rows[i].decidedAt = at;
    var w = writeTable_('申請', rows, actor_());
    if (!w.ok) return err_('write_fail', w.msg);
    audit_(actor_(), '拒絕子女綁定', rows[i].ymis, String(o.reason).slice(0, 80), 'leader');
    return ok_({ decided: 'rejected', id: rows[i].id });
  }
  if (decide !== 'approve') return err_('bad_decide', 'decide 只可以 approve／reject');
  /* 批：寫落家長戶嘅 children（**唔會**動子女自己嗰個戶） */
  var users = readUsers_();
  var pIdx = -1;
  users.forEach(function (u, k) {
    if (pIdx < 0 && String(u.email || '').toLowerCase() === String(rows[i].email || '').toLowerCase()
      && String(u.role || '') === 'parent') pIdx = k;
  });
  if (pIdx < 0) return err_('no_parent', '家長戶唔見咗（可能被停用）—— 唔會批');
  var kids = (users[pIdx].children || []).slice();
  if (kids.map(String).indexOf(String(rows[i].ymis)) < 0) kids.push(String(rows[i].ymis));
  users[pIdx].children = kids;
  var w2 = writeTable_('旅員', users, actor_());
  if (!w2.ok) return err_('write_fail', w2.msg);
  rows[i].state = 'approved'; rows[i].reason = '';
  rows[i].decidedBy = actor_(); rows[i].decidedAt = at;
  rows[i].note = '已綁定（children 已加 ' + rows[i].ymis + '）';
  var w3 = writeTable_('申請', rows, actor_());
  if (!w3.ok) return err_('write_fail', w3.msg);
  audit_(actor_(), '確認子女綁定', rows[i].ymis, '家長 ' + rows[i].email + '（children 已加）', 'leader');
  return ok_({ decided: 'approved', id: rows[i].id, parent: rows[i].email, children: kids.length });
}

/* ============================ 移交與升降團（BUILD §6） ============================
   同一套流程行晒：跨支部／轉旅／調區／海轉空。
     ① 移出（transferOut）：來源團記 TRANSFERRED_OUT（tombstone）＋ transferTo／transferDate，
        歷史留來源唯讀；出一個移交套裝 JSON ＋ sha256（面交／私密頻道傳）
     ② 接收（importTransferBundle）：驗 sha256 → transferId 冪等 → 撞號阻擋 →
        新 ACTIVE membership（**同一個 SCOUT_ID**）→ 密碼行開戶流程（未設 hash ＝ pending_hash）
     ③ 家長：同旅移動＝零改動（children 存全域 SCOUT_ID）；轉旅／調區＝來源家長戶轉 left
        ＋回一段通知文案（由接收旅發邀請連結重開）
   ========================================================================== */
var TRANSFER_FIELDS = ['transferId', 'scout_id', 'ymis', 'name', 'dob', 'parentContact', 'badgeSummary', 'transferTo', 'transferDate'];
/** 移交套裝嘅 sha256：**只計內容欄位**（唔計 sha256 自己），key 次序固定先驗得到 */
function bundleCanonical_(b) {
  var src = b || {};
  var out = {};
  TRANSFER_FIELDS.forEach(function (k) { out[k] = src[k] === undefined || src[k] === null ? '' : src[k]; });
  return JSON.stringify(out);
}
function bundleSha_(b) { return sha256Hex_(bundleCanonical_(b)); }

function transferOut(o) {
  var scoutId = sanitizeLabel_(o.scoutId || o.ymis || '');
  if (!scoutId) return err_('bad_scout', '要 SCOUT_ID／YMIS');
  var to = String(o.to || '').slice(0, 40);
  var from = sanitizeLabel_(o.from || '');
  var users = readUsers_();
  var u = users.filter(function (x) { return String(x.ymis || '') === scoutId; })[0];
  if (u) {
    if (String(u.status || '').toLowerCase() === 'transferred_out') {
      return err_('already_out', '呢位成員已經移出咗（唔會出兩次套裝）');
    }
    u.status = 'TRANSFERRED_OUT';
    u.transferTo = to;
    u.transferDate = String(o.date || stamp_().slice(0, 10));
    var w0 = writeTable_('旅員', users, actor_());
    if (!w0.ok) return err_('write_fail', w0.msg);
  }
  var bundle = {
    transferId: uid_('tid'),
    scout_id: scoutId, ymis: scoutId,
    name: String(o.name || (u && u.name) || '').slice(0, 80),
    dob: String(o.dob || (u && u.dob) || '').slice(0, 20),
    parentContact: String(o.parentContact || (u && u.email) || '').slice(0, 120),
    badgeSummary: String(o.badgeSummary || '').slice(0, 300),
    transferTo: to, transferDate: String(o.date || stamp_().slice(0, 10))
  };
  var sha = bundleSha_(bundle);
  var rec = {
    id: bundle.transferId, kind: sanitizeLabel_(o.kind || 'transfer'),
    scoutId: scoutId, name: bundle.name, from: from, to: to,
    reason: String(o.reason || '').slice(0, 80), at: stamp_(),
    state: 'out', bundle: 'sha256:' + sha, sha256: sha,
    transferId: bundle.transferId, parentSameTroop: !!o.parentSameTroop,
    parentAction: parentAction
  };
  /* 家長處理（BUILD §6）：同旅移動＝零改動；轉旅／調區＝來源家長戶轉 left（children 留住），
     接收旅之後用套裝內 email 發邀請連結重開。唔會自動開新戶。 */
  var parentAction = '（同旅移動：家長零改動 —— children 存全域 SCOUT_ID）';
  var parentNotice = '';
  if (!o.parentSameTroop) {
    var pEmail = String(o.parentEmail || (u && u.guardianEmail) || '').toLowerCase();
    var users2 = readUsers_();
    var hit = users2.filter(function (x) {
      if (String(x.role || '') !== 'parent') return false;
      if (pEmail && String(x.email || '').toLowerCase() === pEmail) return true;
      var kids = x.children || x.childrenIds || [];
      return kids.map(String).indexOf(scoutId) >= 0;
    });
    if (hit.length) {
      hit.forEach(function (x) { x.status = 'LEFT'; x.leftAt = stamp_().slice(0, 10); x.leftReason = '被監護人轉旅／調區'; });
      var w3 = writeTable_('旅員', users2, actor_());
      if (!w3.ok) return err_('write_fail', w3.msg);
      parentAction = '來源家長戶已轉 LEFT（' + hit.length + ' 個）—— 接收旅發邀請連結重開';
      audit_(actor_(), '家長戶停用（轉旅）', pEmail || scoutId, hit.length + ' 個', 'leader');
    } else {
      parentAction = '搵唔到來源家長戶（可能要人手核對）—— 接收旅按套裝內 email 發邀請連結重開';
    }
    parentNotice = '【' + unitId_() + '】' + (bundle.name || scoutId) + ' 已經移交去 ' + (to || '（接收單位）')
      + '（' + bundle.transferDate + '）。你喺本旅嘅家長帳號已停用；接收旅會用你嘅 email（'
      + (pEmail || '套裝內嘅家長聯絡') + '）發一條一次性邀請連結，撳入去就可以重開，子女資料自動跟過去（children 用全球 SCOUT_ID，唔使重新綁定）。';
  }
  var rows = readTable_('移交');
  if (rows.filter(function (r) { return String(r.transferId) === bundle.transferId; }).length) return err_('duplicate', 'transferId 撞（重試就會係咁）');
  rows.push(rec);
  var w = writeTable_('移交', rows, actor_());
  if (!w.ok) return err_('write_fail', w.msg);
  audit_(actor_(), '移出（TRANSFERRED_OUT）', scoutId, from + ' → ' + to + '｜sha256 ' + sha.slice(0, 12), 'leader');
  return ok_({ saved: true, transferId: bundle.transferId, sha256: sha, bundle: bundle, row: rec, parentAction: parentAction, parentNotice: parentNotice });
}

function importTransferBundle(o) {
  var b = o.bundle || {};
  var sha = bundleSha_(b);
  if (o.sha256 && String(o.sha256) !== sha) return err_('bad_hash', 'sha256 唔對 —— 個檔改過或者傳壞咗，唔可以匯入');
  var scoutId = sanitizeLabel_(b.scout_id || b.ymis || '');
  if (!scoutId) return err_('bad_scout', '套裝冇 SCOUT_ID');
  var tid = sanitizeLabel_(b.transferId || '');
  if (!tid) return err_('bad_transfer', '套裝冇 transferId（冇冪等鍵唔收）');
  var rows = readTable_('移交');
  /* 冪等：一個 transferId 只會有一行。移出時已經開咗一行（state 'out'）→ 接收就更新嗰行做 done，
     唔會再 push 多一行（唔係嘅話同一個 transferId 會有兩行，讀返會亂） */
  var idx = -1;
  rows.forEach(function (r, i) { if (String(r.transferId) === tid && idx < 0) idx = i; });
  if (idx >= 0 && String(rows[idx].state) === 'done') {
    return ok_({ duplicate: true, transferId: tid, note: '呢個 transferId 已經接收過（冪等：唔會建第二次）' });
  }
  /* 撞號：本旅已經有同一個 SCOUT_ID（現役或等開戶）→ 阻住，交人手處理 */
  var users = readUsers_();
  var LIVE = ['ACTIVE', 'PENDING_HASH'];
  var clash = users.filter(function (x) {
    return String(x.ymis || '') === scoutId && LIVE.indexOf(String(x.status || '').toUpperCase()) >= 0;
  })[0];
  if (clash) {
    audit_(actor_(), '接收移交被拒（撞號）', scoutId, '已有現役戶：' + String(clash.email || '').slice(0, 40), 'leader');
    return err_('clash', '撞號：本旅已經有同一個 SCOUT_ID 現役（' + String(clash.name || '') + '）—— 唔會重複建，請人手核對');
  }
  var to = sanitizeLabel_(o.to || b.transferTo || '');
  var at = stamp_();
  var user = {
    id: uid_('u'), ymis: scoutId, name: String(b.name || '').slice(0, 80),
    email: String(o.email || b.parentContact || '').slice(0, 120),
    role: 'member', branchId: to, identity: '成員', status: 'pending_hash',
    dob: String(b.dob || '').slice(0, 20), mustChangePw: true,
    fromBranch: sanitizeLabel_(o.from || ''), transferId: tid, joined: at.slice(0, 10),
    pv: 1
  };
  users.push(user);
  var w = writeTable_('旅員', users, actor_());
  if (!w.ok) return err_('write_fail', w.msg);
  var accept = {
    state: 'done', at: at, reason: '接收匯入', bundle: 'sha256:' + sha, sha256: sha,
    transferId: tid, acceptedBy: actor_(), acceptedAt: at,
    note: '已接收：新 membership（pending_hash，首登強制改密碼）',
    parentAction: b.parentContact ? '接收旅用套裝內 email 發邀請連結重開家長戶' : '套裝冇家長聯絡，家長要自己行開戶申請'
  };
  if (idx >= 0) rows[idx] = Object.assign({}, rows[idx], accept);
  else rows.push(Object.assign({ id: tid, kind: 'transfer_in', scoutId: scoutId, name: user.name, from: sanitizeLabel_(o.from || ''), to: to }, accept));
  var w2 = writeTable_('移交', rows, actor_());
  if (!w2.ok) return err_('write_fail', w2.msg);
  audit_(actor_(), '接收移交（匯入套裝）', scoutId, tid + '｜sha256 ' + sha.slice(0, 12) + ' → ' + to, 'leader');
  return ok_({ saved: true, duplicate: false, transferId: tid, sha256: sha, user: { ymis: scoutId, branchId: to, status: 'pending_hash' } });
}

function saveRescue(o) {
  var r0 = o.rescue || {};
  var rec = {
    id: r0.id ? sanitizeLabel_(r0.id) : uid_('rs'),
    at: stamp_(), by: String(r0.by || '').slice(0, 60), contact: String(r0.contact || '').slice(0, 80),
    branchId: sanitizeLabel_(r0.branchId || ''), kind: sanitizeLabel_(r0.kind || 'other'),
    title: String(r0.title || '').slice(0, 120), severity: sanitizeLabel_(r0.severity || ''),
    note: String(r0.note || '').slice(0, 2000), state: 'open', via: CTX.mode === 'upstream' ? 'sig' : (CTX.mode === 'server' ? 'api' : 'anon')
  };
  if (!rec.title || !rec.note) return err_('bad_rescue', '求救要有標題同詳情');
  var rows = readTable_('求救');
  if (rows.filter(function (r) { return r.id === rec.id; }).length) return err_('duplicate', '呢張單已經存在（冪等）');
  rows.push(rec);
  var w = writeTable_('求救', rows, rec.by || '（免登入）');
  if (!w.ok) return err_('write_fail', w.msg);
  access_('RESCUE', rec.by || '', CTX.ip, rec.id + '｜' + rec.kind + '｜' + rec.severity);
  return ok_({ saved: true, id: rec.id, at: rec.at, state: rec.state });
}
function saveNotice(o) {
  var rows = readTable_('旅通告'); rows.push(Object.assign({ id: uid_('n'), at: stamp_(), by: actor_() }, o.notice || {}));
  var w = writeTable_('旅通告', rows, actor_()); return w.ok ? ok_({ saved: true }) : err_('write_fail', w.msg);
}
function saveFinanceEntry(o) {
  var rows = readTable_('財務整合'); rows.push(Object.assign({ id: uid_('f'), at: stamp_(), by: actor_() }, o.entry || {}));
  var w = writeTable_('財務整合', rows, actor_()); return w.ok ? ok_({ saved: true }) : err_('write_fail', w.msg);
}

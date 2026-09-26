/* ============================================================
   Downstream.gs — 團側（下游 leaf）接入範本（BUILD §1／§2／§10 條 7）
   ------------------------------------------------------------
   用途：畀 vs_portal / cubs_portal / scout_portal / gh_portal 等**下游 GAS** 直接抄。
   冇依賴、唔碰原有 UI／資料表：只係喺 `doPost` 開頭加幾行（見下方 doPost 範例）。

   三條規矩（同旅系統 Code.gs 完全對齊）：
     ① 上游簽名進嚟：canonical = action\n ts \n nonce \n sha256(digest)，HMAC-SHA256，
        密鑰 = sha256(PURPOSE + '|' + 本機 API_KEY)；±5 分鐘；nonce 一次性（cache ＋持久環）。
     ② 本機直接入口掣：ScriptProperties `ALLOW_LOCAL_LOGIN`（未設定＝開；'false'＝閂）。
        閂咗之後只收上游 sig；本地憑證操作（login／apply／logout／改密碼…）永不經 sig 接受。
     ③ **leaf 自製 session token**：ver 完上游 sig 之後，leaf 自己簽一張短期 session token
        （唔使每 request 回打上游，亦唔使每次驗 sig）。下游**永不回打**上游
        （唯一例外＝中央登入票據回打固定端點，屬上游側設計）。

   抄之前改三樣：LINK_PURPOSE（逐個 portal 唔同）、LINK_READ_ACTIONS／LINK_WRITE_ACTIONS
   （你個 portal 真係有嘅 action）、以及 `doPost` 嗰幾行。
   ============================================================ */

/* ------------------------- 常數（照抄；PURPOSE 要改） ------------------------- */
var LINK_PURPOSE = 'scportal-troop-sig-v1';       // ★ 逐個 portal 唔同（旅側 registry 要登記同一個）
var LINK_FLAG = 'ALLOW_LOCAL_LOGIN';              // 直接入口掣（未設定＝開）
var LINK_SIG_WINDOW_MS = 5 * 60 * 1000;           // ±5 分鐘
var LINK_SIG_NONCE_TTL = 600;                     // cache 10 分鐘（＋持久環）
var LINK_MAX_SIGNED_BYTES = 900000;
var LINK_JTI_RING_KEY = 'LINK_JTI_RING';
var LINK_JTI_RING_MAX = 200;
var LINK_NONCE_RE = /^[0-9A-Za-z_-]{8,64}$/;
var LINK_SIG_HEX_RE = /^[0-9a-f]{64}$/i;
/* ★ leaf session token：leaf 自己簽、自己驗（唔關上游事） */
var LEAF_TOKEN_TTL_MS = 30 * 60 * 1000;           // 30 分鐘（同旅 session 一致）
var LEAF_TOKEN_MIN = 5 * 60 * 1000;
var LEAF_TOKEN_MAX = 30 * 60 * 1000;
var LEAF_TOKEN_ACTION = 'leafLogin';              // 上游可以用 sig 叫 leaf 發 token

/* 上游（旅）可以經 sig 叫本機做嘅嘢。本地憑證操作永不列入。 */
var LINK_READ_ACTIONS = ['load', 'getLinkState', 'getLoginMode', 'getMembers', 'getPendingRequests'];
var LINK_WRITE_ACTIONS = ['save', 'addMember', 'bulkAddUsers', 'upsertUser', 'setLocalLogin', 'importUsers'];
/* ★ 本地憑證操作：就算有合法上游簽名都**永不接受**（login 一定係本機自己驗密碼） */
var LINK_NEVER_ACTIONS = ['login', 'apply', 'logout', 'changePassword', 'requestLogRecord', 'cancelLogRequest', 'updateConfig'];
/* 本地登入（唔經 sig）都做得嘅 action：本機自己嘅登入流程用 */
var LINK_LOCAL_ACTIONS = ['login', 'leafLogin', 'apply', 'logout', 'changePassword'];

/* ------------------------- 小工具 ------------------------- */
function linkProps_() { return PropertiesService.getScriptProperties(); }
function linkCache_() { return CacheService.getScriptCache(); }
function linkNow_() { return new Date(); }
function toHex_(bytes) { var out = ''; for (var i = 0; i < bytes.length; i++) out += ('0' + (bytes[i] & 0xFF).toString(16)).slice(-2); return out; }
function sha256Hex_(text) { return toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text === null || text === undefined ? '' : text), Utilities.Charset.UTF_8)); }
function hmacHex_(message, key) { return toHex_(Utilities.computeHmacSha256Signature(String(message), String(key))); }
/** 常數時間比較：兩邊各自 SHA-256 再比（唔會逐字元短路） */
function safeEqual_(a, b) { return sha256Hex_(a) === sha256Hex_(b); }
function linkApiKey_() { return linkProps_().getProperty('API_KEY') || ''; }
function linkSigKey_() { return sha256Hex_(LINK_PURPOSE + '|' + linkApiKey_()); }
function linkCanonical_(action, ts, nonce, digest) { return [String(action || ''), String(ts || ''), String(nonce || ''), String(digest || '')].join('\n'); }
function linkNonce_() { return Utilities.getUuid().replace(/-/g, ''); }
function linkNodeId_() { try { return String(SpreadsheetApp.getActiveSpreadsheet().getName() || 'node').slice(0, 80); } catch (e) { return 'node'; } }
function linkAudit_(actor, action, target, detail) {
  /* 只記 metadata（同旅系統一樣）：長文字唔入 log */
  var d = String(detail || '');
  return { at: Utilities.formatDate(linkNow_(), 'Asia/Hong_Kong', 'yyyy-MM-dd HH:mm'), actor: String(actor || '').slice(0, 40), action: String(action || '').slice(0, 40), target: String(target || '').slice(0, 80), detail: d.length > 80 ? ('[內容不記錄 len=' + d.length + ']') : d };
}

/* ------------------------- ① 直接入口掣 ------------------------- */
function localLoginAllowed() {
  var v = String(linkProps_().getProperty(LINK_FLAG) || '').trim().toLowerCase();
  if (!v) return true;                                        // 未設定＝開（現有旅團零影響）
  return ['1', 'true', 'yes', 'on', 'open'].indexOf(v) >= 0;
}
function setLocalLoginAllowed(allow) {
  linkProps_().setProperty(LINK_FLAG, allow ? 'true' : 'false');
  return allow ? 'true' : 'false';
}
/** 閂咗口：本地登入一律拒（做一個 403 樣嘅回應，帶求救連結） */
function linkClosedResponse(action) {
  return {
    success: false, local_login: false, upstream_only: true, code: 'local_login_closed',
    rescue: '（免登入）求救：請去旅系統登入頁撳「🆘 求救」，或者請旅長喺旅側「支部登記」開返本機登入',
    error: '本機直接入口已閂（' + LINK_FLAG + '=false），只接受上游簽名（sig）請求；請由旅入口入。' + (action ? '（已拒絕：' + action + '）' : '')
  };
}
function getLinkState() {
  var raw = String(linkProps_().getProperty(LINK_FLAG) || '');
  return {
    success: true, node: linkNodeId_(), purpose: LINK_PURPOSE,
    allow_local_login: localLoginAllowed(),
    link_flag_set: raw === 'false' ? 'false' : (raw ? 'true' : '（未設定＝開啟）'),
    api_key_masked: (function (k) { k = String(k || ''); return k.length <= 12 ? '****' : k.slice(0, 8) + '…' + k.slice(-4); })(linkApiKey_())
  };
}

/* ------------------------- ② sig 驗證（同旅系統同一套） ------------------------- */
function stripLinkSigFields_(body) {
  var out = {};
  for (var k in (body || {})) { if (['sig', 'sig_ts', 'sig_nonce'].indexOf(k) >= 0) continue; out[k] = body[k]; }
  return out;
}
/** 讀兩種通道：query（?sig=&sig_ts=&sig_nonce=）先、body 後；digest 各綁各 */
function readLinkSig_(e, body, rawBody) {
  var p = (e && e.parameter) || {};
  var qSig = String(p.sig || ''), qTs = String(p.sig_ts || ''), qNonce = String(p.sig_nonce || '');
  if (qSig && qTs && qNonce) return { sig: qSig, ts: qTs, nonce: qNonce, digest: sha256Hex_(String(rawBody || '')), via: 'query' };
  var bSig = String((body && body.sig) || ''), bTs = String((body && body.sig_ts) || ''), bNonce = String((body && body.sig_nonce) || '');
  if (bSig && bTs && bNonce) {
    var payload = '';
    try { payload = JSON.stringify(stripLinkSigFields_(body)); } catch (err) { return null; }
    return { sig: bSig, ts: bTs, nonce: bNonce, digest: sha256Hex_(payload), via: 'body' };
  }
  return null;
}
/* jti 持久環（cache 蒸發都擋得住重放）——同旅系統 Code.gs 一致 */
function linkJti_(nonce, ts) { return sha256Hex_('jti|' + String(nonce) + '|' + String(ts)).slice(0, 24); }
function linkRingRead_() {
  var arr = [];
  try { arr = JSON.parse(linkProps_().getProperty(LINK_JTI_RING_KEY) || '[]'); } catch (e) { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  var cut = linkNow_().getTime() - (LINK_SIG_WINDOW_MS * 2);
  return arr.filter(function (x) { return x && Number(x.ts) >= cut; });
}
function linkJtiSeen_(jti) {
  var ring = linkRingRead_();
  for (var i = 0; i < ring.length; i++) { if (String(ring[i].jti) === String(jti)) return true; }
  return false;
}
function linkJtiRemember_(jti, ts) {
  var ring = linkRingRead_();
  ring.push({ jti: String(jti), ts: Number(ts) || linkNow_().getTime() });
  if (ring.length > LINK_JTI_RING_MAX) ring = ring.slice(ring.length - LINK_JTI_RING_MAX);
  try { linkProps_().setProperty(LINK_JTI_RING_KEY, JSON.stringify(ring)); } catch (e) { /* 寫唔入都唔可以擋住請求 */ }
  return ring.length;
}
/** 驗上游簽名。回 {ok, via, jti} 或者 {ok:false, msg} */
function verifyLinkSig(e, body, rawBody) {
  var s = readLinkSig_(e, body, rawBody);
  if (!s) return { ok: false, msg: '缺少 sig 欄位' };
  if (String(rawBody || '').length > LINK_MAX_SIGNED_BYTES) return { ok: false, msg: 'body 太大' };
  if (!LINK_SIG_HEX_RE.test(String(s.sig))) return { ok: false, msg: 'sig 格式唔啱' };
  if (!LINK_NONCE_RE.test(String(s.nonce))) return { ok: false, msg: 'nonce 格式唔啱' };
  var ts = parseInt(s.ts, 10);
  if (!isFinite(ts) || Math.abs(linkNow_().getTime() - ts) > LINK_SIG_WINDOW_MS) return { ok: false, msg: '時間戳過期（±5 分鐘）' };
  var action = String((body && body.action) || '');
  var expect = hmacHex_(linkCanonical_(action, s.ts, s.nonce, s.digest), linkSigKey_());
  if (!safeEqual_(expect, s.sig)) return { ok: false, msg: '簽名不符' };
  /* 防重放：cache 快路 ＋ 持久環；兩組通道嘅 nonce 都要消耗 */
  var nonces = [String(s.nonce)];
  var qn = String(((e && e.parameter) || {}).sig_nonce || '');
  var bn = String((body && body.sig_nonce) || '');
  [qn, bn].forEach(function (n) { if (LINK_NONCE_RE.test(n) && nonces.indexOf(n) < 0) nonces.push(n); });
  var jtis = nonces.map(function (n) { return linkJti_(n, ts); });
  var c = linkCache_();
  for (var i = 0; i < nonces.length; i++) {
    if (c.get('ln_' + nonces[i])) return { ok: false, code: 'sig_replayed', msg: 'nonce 已用過（防重放）' };
    if (linkJtiSeen_(jtis[i])) return { ok: false, code: 'sig_replayed', msg: 'jti 已用過（防重放）' };
  }
  for (var j = 0; j < nonces.length; j++) { c.put('ln_' + nonces[j], '1', LINK_SIG_NONCE_TTL); linkJtiRemember_(jtis[j], ts); }
  return { ok: true, via: s.via, jti: jtis[0] };
}

/* ------------------------- ③ leaf 自製 session token ------------------------- */
/**
 * leaf 自己簽一張短期 session token：`base64url(payloadJson).hex(hmac)`
 *   payload = { sub, role, name, node, exp, pv, scope }
 * 用途：leaf UI 之後嘅請求只帶呢張 token（HttpOnly cookie），
 *       唔使每 request 回打上游、亦唔使每 request 驗上游 sig。
 * 失效：到期（≤30 分鐘）／pv 對唔上（改密碼即全體失效）／node 對唔上（搬錯 node）。
 * 密鑰：leaf 自己嘅 API_KEY 派生（PURPOSE + ':leaf'）——唔會同上游 sig 密鑰互用。
 */
function leafTokenKey_() { return sha256Hex_(LINK_PURPOSE + '|' + linkApiKey_() + '|leaf-session-v1'); }
function leafB64_(s) { return Utilities.base64EncodeWebSafe(String(s)).replace(/=+$/, ''); }
function leafUnb64_(s) {
  var t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return Utilities.newBlob(Utilities.base64Decode(t)).getDataAsString();
}
function mintLeafToken(payload, ttlMs) {
  var p = payload || {};
  var ttl = Math.min(LEAF_TOKEN_MAX, Math.max(LEAF_TOKEN_MIN, Number(ttlMs) || LEAF_TOKEN_TTL_MS));
  var body = {
    sub: String(p.sub || '').slice(0, 40),            // SCOUT_ID / YMIS（全球唯一）
    role: String(p.role || '').slice(0, 20),
    name: String(p.name || '').slice(0, 60),
    node: p.node || linkNodeId_(),
    scope: String(p.scope || 'leaf').slice(0, 40),
    pv: Number(p.pv || 0) || 0,
    iat: linkNow_().getTime(),
    exp: linkNow_().getTime() + ttl
  };
  var head = leafB64_(JSON.stringify(body));
  return head + '.' + hmacHex_(head, leafTokenKey_());
}
/** 驗 leaf token：格式／簽名／到期／node／（可選）pv */
function verifyLeafToken(token, opts) {
  var o = opts || {};
  var parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !LINK_SIG_HEX_RE.test(parts[1])) return { ok: false, code: 'bad_token', msg: 'token 格式唔啱' };
  if (!safeEqual_(hmacHex_(parts[0], leafTokenKey_()), parts[1])) return { ok: false, code: 'bad_token', msg: 'token 簽名不符（唔係本機發）' };
  var body = null;
  try { body = JSON.parse(leafUnb64_(parts[0])); } catch (e) { return { ok: false, code: 'bad_token', msg: 'token 內容壞咗' }; }
  var now = Number(o.now || linkNow_().getTime());
  if (!body || !body.exp || now > Number(body.exp)) return { ok: false, code: 'token_expired', msg: 'token 已經到期 —— 請重新由旅入口入' };
  if (o.node && String(body.node) !== String(o.node)) return { ok: false, code: 'wrong_node', msg: 'token 唔屬於本 node' };
  if (o.pv !== undefined && o.pv !== null && Number(body.pv) !== Number(o.pv)) return { ok: false, code: 'stale_pv', msg: '密碼改過（pv 唔同）—— 舊 token 一律失效' };
  return { ok: true, payload: body, remainingMs: Number(body.exp) - now };
}
/** leaf 收到自己 UI 嘅請求：攞 token（cookie／body）→ 驗 */
function requireLeafToken(e, body) {
  var token = '';
  try { token = ((e && e.parameter) || {}).leaf_token || ''; } catch (err) { token = ''; }
  if (!token) {
    try {
      var cookies = String(((e && e.parameter) || {}).HTTP_COOKIE || '');
      var m = cookies.match(/leaf_token=([^;]+)/);
      if (m) token = decodeURIComponent(m[1]);
    } catch (err2) { /* 冇 cookie 就算 */ }
  }
  if (!token && body) token = String(body.leaf_token || '');
  return verifyLeafToken(token, { node: body && body.node });
}

/* ------------------------- doPost 掛勾（抄呢一段） -------------------------
   function doPost(e) {
     var handled = linkHandlePost(e);
     if (handled) return handled;                  // 已處理（sig 請求 或 已閂口嘅本地請求）
     ...你自己原本嘅邏輯...
   }
   ------------------------------------------------------------------------ */
function linkHandlePost(e) {
  var rawBody = (e && e.postData && e.postData.contents) || '';
  var body = null;
  try { body = JSON.parse(rawBody); } catch (err) { body = null; }
  if (!body || typeof body !== 'object') return null;            // 唔係 JSON：交返你自己處理
  var action = String(body.action || '');
  var hasSig = !!(body.sig || (e && e.parameter && e.parameter.sig));

  /* ① 有簽名：驗身 → 過白名單 → leafLogin 就發 leaf token → 其他交由 handleSignedRequest */
  if (hasSig) {
    var v = verifyLinkSig(e, body, rawBody);
    if (!v.ok) return linkJson_({ success: false, code: v.code || 'bad_sig', error: v.msg });
    if (LINK_NEVER_ACTIONS.indexOf(action) >= 0) return linkJson_({ success: false, code: 'never_accept', error: '呢個操作永不接受上游簽名：' + action });
    var allowed = LINK_READ_ACTIONS.concat(LINK_WRITE_ACTIONS).concat([LEAF_TOKEN_ACTION]);
    if (allowed.indexOf(action) < 0) return linkJson_({ success: false, code: 'unknown_action', error: '唔喺 sig 白名單：' + action, allowed: allowed });
    if (action === LEAF_TOKEN_ACTION) {
      /* ★ 上游帶住已核實嘅身份嚟：leaf 簽自己嘅 session token 交佢（之後唔使再驗 sig） */
      var ttl = Number(body.ttlMs || body.ttl_ms || LEAF_TOKEN_TTL_MS);
      var tok = mintLeafToken({ sub: body.sub || body.ymis || '', role: body.role || '', name: body.name || '', pv: body.pv, scope: body.scope || 'leaf' }, ttl);
      return linkJson_({ success: true, data: { leaf_token: tok, node: linkNodeId_(), ttlMs: Math.min(LEAF_TOKEN_MAX, Math.max(LEAF_TOKEN_MIN, ttl)), via: v.via, jti: v.jti } });
    }
    var out = handleSignedRequest(action, body);
    return linkJson_(out);
  }

  /* ② 冇簽名：本地入口。閂咗口就只放行 leaf token 驗到嘅請求（本地憑證操作一律拒） */
  var isLocalAction = LINK_LOCAL_ACTIONS.indexOf(action) >= 0;
  if (!localLoginAllowed()) {
    if (isLocalAction) return linkJson_(linkClosedResponse(action));
    var lt = requireLeafToken(e, body);
    if (!lt.ok) return linkJson_(linkClosedResponse(action));
    return null;                                   // leaf token OK：交返你自己處理（已登入）
  }
  return null;                                     // 本地入口開：你自己照舊處理
}
function linkJson_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

/**
 * 上游（帶有效 sig）叫本機做嘢 —— 你要喺呢個 switch 填自己 portal 嘅讀寫。
 * 回傳 {success:true, data:...} 或 {success:false, code, error}。
 */
function handleSignedRequest(action, body) {
  switch (String(action)) {
    case 'getLinkState': return getLinkState();
    case 'getLoginMode': return { success: true, data: { allow_local_login: localLoginAllowed(), node: linkNodeId_() } };
    case 'setLocalLogin': {
      setLocalLoginAllowed(body.allow !== false);
      return { success: true, data: { allow_local_login: localLoginAllowed(), node: linkNodeId_() } };
    }
    case 'getMembers': return { success: true, data: { rows: (typeof linkReadMembers_ === 'function' ? linkReadMembers_() : []) } };
    case 'load': return { success: true, data: { table: String(body.table || ''), rows: (typeof linkReadTable_ === 'function' ? linkReadTable_(String(body.table || '')) : []) } };
    case 'save': return { success: true, data: { written: (typeof linkWriteTable_ === 'function' ? linkWriteTable_(String(body.table || ''), body.rows || []) : 0), note: '（範本：接你嘅寫入函式）' } };
    default: return { success: false, code: 'not_implemented', error: '範本未接呢個 action：' + action };
  }
}

/* ------------------------- 上游側：點簽（供對照／測試） ------------------------- */
/** 產生一張合規格嘅簽名（旅系統 Code.gs 出站簽名同一套 canonical） */
function makeLinkSig(action, rawPayload, key) {
  var ts = String(linkNow_().getTime()), nonce = linkNonce_();
  var digest = sha256Hex_(String(rawPayload || ''));
  return { sig: hmacHex_(linkCanonical_(action, ts, nonce, digest), sha256Hex_(LINK_PURPOSE + '|' + String(key || ''))), sig_ts: ts, sig_nonce: nonce };
}

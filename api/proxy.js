/* ============================================================
   /api/proxy — 旅系統唯一代理出口（Vercel Function · 零依賴）
   ------------------------------------------------------------
   規矩（建構計劃 §6.2／§6.8）：
     · apikey／端點永遠唔落前端：前端只打同源 /api/proxy
     · 逐個 action 白名單；未實作嘅 action 一律「誠實失敗」（501），唔會靜靜當成功
     · log 只記 metadata（時間／action／結果），唔記內容、唔記密碼

   ★ 已實作：action = 'issue'
     對正 Scout Admin「問題回報 TICK」合約（同一支 GAS、同一張表 —— 同圖書館
     report.html?app=圖書館 一樣）：
       POST { type:'issue', sourceApp, title, desc, severity, troopId, name, contact }
     severity 白名單：低／中／高／緊急；亂填／陌生值 → 落「高」。
     ADMIN 側唔使改任何嘢：佢見 type:'issue' 就寫入「問題回報」表 ＋ Email 通知。

   ★ 已實作：action = '<gasAction>'（白名單）→ 轉發去旅 GAS `/exec`，server 側 inject apikey。
     · 需要有效 session（HttpOnly cookie；除 'status' 之外）—— 前端永遠見唔到 apikey
     · 4MB 上限、逾時、log 只記 metadata
     · 未白名單／未設定 env → 501／503 誠實失敗（**唔會扮成功**）
   ============================================================ */
import { verifySession } from './auth.js';
export const config = { runtime: 'nodejs' };

/** 可以經呢個 proxy 轉去旅 GAS 嘅 action（＝ Code.gs ACTIONS 對前端開放嘅子集） */
export const GAS_WHITELIST = [
  'status', 'dbInfo', 'load', 'loadTables', 'saveTables', 'saveTable',
  'createInvite', 'listInvites', 'revokeInvite',
  'getDownstreams', 'registerDownstream', 'testDownstream', 'updateDownstream', 'removeDownstream',
  'setLocalLogin', 'getLoginMode', 'getLinkState', 'listModules', 'setModule',
  'getSummary', 'getAuditLog', 'getAccessLog', 'saveAudit', 'logAccess',
  /* P1：支部狀態／分享／求救／內容寫入 */
  'registry', 'saveShare', 'saveRescue', 'getTombstones',
  /* P2：批核（開戶申請／申報）＋申請模式 */
  'decideApplication', 'setApplyMode', 'getApplyMode'
  /* 匿名可寫面（noticeSignup／borrowApply／financeApply／progressApply／accountApply／saveRescue）
     ＝下面 ANON_GAS，唔喺呢張表都入得閘（免得兩處名單走樣） */
];
/** 只有旅長（role=chief）先可以用（寫入類／管治類） */
export const CHIEF_ONLY = [
  'saveNotice', 'saveFinanceEntry', 'saveShare', 'setUnitStatus',
  'deleteRow', 'saveDbPart', 'purgeTombstones',          // 破壞性／體積治理：只旅長做得
  'setApplyMode',                                        // 開戶申請模式：旅長決定（唔想有人靜靜改收生政策）
  'createInvite', 'revokeInvite', 'registerDownstream', 'updateDownstream', 'removeDownstream',
  'setLocalLogin', 'setModule', 'upsertUser', 'setUserStatus', 'deleteUser', 'resetPassword'
];
/** 旅長 ＋ 教練員（coach）都可以用 */
export const LEADER_ACTIONS = ['testDownstream', 'openAccountForDownstream', 'importUsers', 'updateUserProfile', 'updateUserRole', 'updatePermissions',
  'decideApplication'];   // 批核：旅長／教練員都做得（拒一定要有原因）
/** 唔使 session 都讀得（只係健康／公開讀） */
const PUBLIC_GAS = ['status'];
/** 免登入寫得（＝GAS 匿名可寫面；限流 GAS 做，呢度再加一層）
    通告報名／物資借用／收支申報／進度申報／開戶申請／求救 */
export const ANON_GAS = ['noticeSignup', 'borrowApply', 'financeApply', 'progressApply', 'accountApply', 'saveRescue'];
/** 匿名路徑唔准帶嘅欄位（防有人借匿名面寫入內部欄位） */
export const ANON_FORBID = ['state', 'decidedBy', 'decidedAt', 'reason', 'perms', 'role', 'hash', 'password_hash', 'apikey'];

const REPORT = {
  type: 'issue',
  severities: ['低', '中', '高', '緊急'],
  fallbackSeverity: '高',
  maxDesc: 2000,
  maxTitle: 120
};

/** ADMIN 收件匣（Scout Admin）嘅固定 Apps Script 端點。可由環境變數蓋過，但永遠只留喺 server 側。 */
const ADMIN_ISSUE_ENDPOINT = process.env.ADMIN_ISSUE_ENDPOINT ||
  'https://script.google.com/macros/s/AKfycbxj5BDDGgjs559smkK4Z5aYImWYeXbN5af8U1ObON0z9WnsN6QJW4I1XWolhs5kQ_H-UQ/exec';

/* 限流（best-effort：逐個 warm instance 記 IP；正式限流喺旅 GAS 階段一齊做） */
const HITS = new Map();
const LIMIT = { max: 6, windowMs: 10 * 60 * 1000 };
function rateLimited(ip) {
  const now = Date.now();
  const arr = (HITS.get(ip) || []).filter(t => now - t < LIMIT.windowMs);
  arr.push(now);
  HITS.set(ip, arr);
  if (HITS.size > 5000) HITS.clear();                 // 唔好無限增長
  return arr.length > LIMIT.max;
}

const send = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

/** 問題回報：把前端表單砌成合同 payload（同前端 registry.REPORT.payload 一套規矩） */
export function buildIssuePayload(form = {}) {
  const sev = REPORT.severities.includes(form.severity) ? form.severity : REPORT.fallbackSeverity;
  return {
    type: REPORT.type,
    sourceApp: String(form.sourceApp || 'troop_portal').trim(),
    title: String(form.title || '').trim().slice(0, REPORT.maxTitle),
    desc: String(form.desc || '').trim().slice(0, REPORT.maxDesc),
    severity: sev,
    troopId: String(form.troopId || '').trim(),
    name: String(form.name || '').trim(),
    contact: String(form.contact || '').trim()
  };
}

export async function forwardIssue(payload) {
  const r = await fetch(ADMIN_ISSUE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'follow'
  });
  const text = await r.text().catch(() => '');
  let json = null;
  try { json = JSON.parse(text); } catch { /* GAS 有時回 HTML／空字串 */ }
  const ok = r.ok && !(json && json.success === false);
  return { ok, status: r.status, error: ok ? '' : (json?.error || `HTTP ${r.status}`) };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const at = new Date().toISOString();
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const normUnit = v => String(v || '').trim().toUpperCase().replace(/^0+(?=\d)/, '');

  /* 收 body（Vercel Node runtime：預設已 parse JSON；保險起見兩種都食） */
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== 'object') return send(res, 400, { success: false, error: '要 JSON body' });

  const action = String(body.action || '');
  console.log(`[proxy] ${at} ip=${ip} action=${action || '(none)'}`);   // 只記 metadata

  /* ---------- action: issue（Scout Admin 問題回報 TICK） ---------- */
  if (action === 'issue') {
    const payload = buildIssuePayload(body);
    if (!payload.title) return send(res, 400, { success: false, error: '要填標題（一句）' });
    if (!payload.desc) return send(res, 400, { success: false, error: '要填問題詳情' });
    if (rateLimited(ip)) return send(res, 429, { success: false, error: '送得太密（10 分鐘最多 6 次）—— 請等一等再試' });
    try {
      const out = await forwardIssue(payload);
      if (!out.ok) return send(res, 502, { success: false, error: `送唔到 ADMIN 收件匣（${out.error}）`, officialUrl: 'https://scout-admin-blue.vercel.app/report.html?app=troop_portal' });
      return send(res, 200, { success: true, data: { type: payload.type, sourceApp: payload.sourceApp, severity: payload.severity, at } });
    } catch (e) {
      return send(res, 502, { success: false, error: `連唔到 ADMIN 收件匣（${String(e?.message || e)}）`, officialUrl: 'https://scout-admin-blue.vercel.app/report.html?app=troop_portal' });
    }
  }

  /* ---------- action = 旅 GAS（白名單；server 側 inject apikey） ---------- */
  /* ★ 匿名可寫面一定要入呢個閘：唔係嘅話白名單成立但路由去唔到，前端會收到 501「未實作」 */
  if (GAS_WHITELIST.includes(action) || CHIEF_ONLY.includes(action) || LEADER_ACTIONS.includes(action) || ANON_GAS.includes(action)) {
    /* session 驗證（'status' 例外）→ 前端唔會、亦唔可以自己帶 key */
    const secret = process.env.SESSION_SECRET || '';
    const sess = verifySession(String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('troop_session='))?.slice('troop_session='.length) || '', secret);
    /* ★ 匿名可寫面：免 session（白名單＋唔准帶內部欄位；限流下面再做） */
    const isAnon = !sess && ANON_GAS.includes(action);
    if (!PUBLIC_GAS.includes(action) && !isAnon && !sess) return send(res, 401, { success: false, error: '要登入（session 過期／未登入）', code: 'no_session' });
    /* 權限：旅長 vs 教練員（隱藏超管唔喺 session 上，佢用 /api/super 票據，唔經呢條路） */
    if (sess) {
      const role = String(sess.role || '');
      const isChief = role === 'chief';
      const isCoach = isChief || role === 'coach';
      if (CHIEF_ONLY.includes(action) && !isChief) {
        return send(res, 403, { success: false, error: `「${action}」只有旅長做得（你係 ${role || '未設定'}）`, code: 'need_chief', need: 'chief' });
      }
      if (LEADER_ACTIONS.includes(action) && !isCoach) {
        return send(res, 403, { success: false, error: `「${action}」只有旅長／教練員做得（你係 ${role || '未設定'}）`, code: 'need_leader', need: 'chief|coach' });
      }
    }

    const unit = normUnit(body.unit || (sess && sess.unit) || '');
    if (!unit) return send(res, 400, { success: false, error: '要 unit（旅 ID）' });
    if (sess && sess.unit && normUnit(sess.unit) !== unit) return send(res, 403, { success: false, error: 'session 唔屬於呢個旅' });
    /* 匿名可寫面：唔准帶內部欄位（防有人借匿名面寫入 state／role 之類） */
    if (isAnon) {
      const leaked = ANON_FORBID.filter(k => body.payload && typeof body.payload === 'object' && k in body.payload);
      if (leaked.length) return send(res, 403, { success: false, error: `匿名唔可以帶呢啲欄位：${leaked.join('、')}`, code: 'anon_forbidden' });
      console.log(`[proxy] ${at} anon=${action} unit=${unit}`);      // 只記 metadata（唔記內容）
    }
    if (rateLimited(ip)) return send(res, 429, { success: false, error: '做得好密（10 分鐘最多 6 次）—— 請等一等再試' });

    const backend = process.env[`TROOP_${unit}_BACKEND`] || process.env[`TROOP_${String(unit).padStart(4, '0')}_BACKEND`] || '';
    const apikey = process.env[`TROOP_${unit}_APIKEY`] || process.env[`TROOP_${String(unit).padStart(4, '0')}_APIKEY`] || '';
    if (!backend || !apikey) {
      return send(res, 503, { success: false, error: `未設定 TROOP_${unit}_BACKEND／_APIKEY（ADMIN 放 Vercel env）`, code: 'not_configured' });
    }
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(backend)) {
      return send(res, 503, { success: false, error: 'BACKEND 格式唔啱（要 /exec）', code: 'bad_backend' });
    }
    const payload = { ...(body.payload || {}), action };
    if (sess) payload.asUser = sess.email;                       // Code.gs 嘅 mustChangePw 閘靠呢個
    const t0 = Date.now();
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 20000);
      const r = await fetch(backend, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, apikey }), redirect: 'follow', signal: ctl.signal });
      clearTimeout(timer);
      const text = await r.text();
      if (text.length > 4 * 1024 * 1024) return send(res, 502, { success: false, error: '旅 SHEET 回應太大（>4MB）' });
      let j = null; try { j = JSON.parse(text); } catch { /* 下面如實報 */ }
      console.log(`[proxy] ${at} gas=${action} unit=${unit} ${r.status} ${Date.now() - t0}ms`);   // 只記 metadata
      if (!j) return send(res, 502, { success: false, error: `旅 SHEET 回應唔係 JSON（HTTP ${r.status}）` });
      return send(res, j.success === true ? 200 : (j.code === 'must_change_pw' ? 403 : 400), j);
    } catch (e) {
      const to = String(e?.name || '').includes('Abort');
      console.log(`[proxy] ${at} gas=${action} unit=${unit} ${to ? 'timeout' : 'error'}`);
      return send(res, 504, { success: false, error: to ? '旅 SHEET 逾時（20 秒）' : `連唔到旅 SHEET：${String(e?.message || e)}` });
    }
  }

  /* ---------- 其他 action：未實作 → 誠實失敗（唔會扮成功） ---------- */
  return send(res, 501, {
    success: false,
    error: `action='${action || '(none)'}' 未實作（UI 先行）`,
    planned: ['登入 → /api/auth', '問題回報 issue → ADMIN 收件匣（已實作）', '旅 GAS action 白名單（已實作）'],
    note: 'apikey 只喺 server 側注入；前端、QR、URL 永不帶 key'
  });
}

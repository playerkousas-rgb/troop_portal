/* ============================================================
   main.js — App Shell（旅閘 → 登入 → 主介面）
   ============================================================ */
import { esc, icon, toast, modal, confirmDlg, money, fmtStamp, normId } from './lib/util.js';
import * as S from './lib/store.js';
import { route, resolve, go, currentPath } from './lib/router.js';
import { MODULES, GROUPS, moduleList, modulesForRole, moduleById, ROLE_LABEL, can } from './lib/registry.js';
import { login, loginAs, logout, changePassword, DEMO_LOGINS, DEMO_PASSWORD, roleLabel } from './lib/auth.js';

import * as vDashboard from './views/dashboard.js';
import * as vPending from './views/pending.js';
import * as vBranches from './views/branches.js';
import * as vNotices from './views/notices.js';
import * as vCalendar from './views/calendar.js';
import * as vFinance from './views/finance.js';
import * as vInventory from './views/inventory.js';
import * as vTransfers from './views/transfers.js';
import * as vUsers from './views/users.js';
import * as vPublic from './views/public.js';
import * as vChildren from './views/children.js';
import * as vSystem from './views/system.js';
import * as vDocs from './views/docs.js';

/* 注意：shell 會重寫 <body>，所以每個 view 都係「當下」由 document 拎容器，唔可以綁死一個元素 */
const viewEl = () => document.getElementById('view');

/* ---------------- 路由 ---------------- */
route('', () => vDashboard.render(viewEl()));
route('dashboard', () => vDashboard.render(viewEl()));
route('pending', (p, q) => vPending.render(viewEl(), p, q));
route('branches', () => vBranches.render(viewEl()));
route('branch/:id', (p, q) => vBranches.renderDetail(viewEl(), p, q));
route('notices', (p, q) => vNotices.render(viewEl(), p, q));
route('notice/:id', (p, q) => vNotices.renderDetail(viewEl(), p, q));
route('calendar', (p, q) => vCalendar.render(viewEl(), p, q));
route('finance', (p, q) => vFinance.render(viewEl(), p, q));
route('inventory', (p, q) => vInventory.render(viewEl(), p, q));
route('transfers', (p, q) => vTransfers.render(viewEl(), p, q));
route('users', (p, q) => vUsers.render(viewEl(), p, q));
route('public', (p, q) => vPublic.render(viewEl(), p, q));
route('children', () => vChildren.render(viewEl()));
route('system', (p, q) => vSystem.render(viewEl(), p, q));
route('docs', (p, q) => vDocs.render(viewEl(), p, q));

/* ---------------- BOOT ---------------- */
export function boot() {
  S.load();
  if (!S.getSession()) { sessionStorage.removeItem('troop.mustPw'); return renderGate(); }
  renderShell();
  if (sessionStorage.getItem('troop.mustPw')) { sessionStorage.removeItem('troop.mustPw'); setTimeout(() => openChangePw(true), 250); }
}

function render() {
  if (!S.getSession()) return renderGate();
  const shell = viewEl();
  const r = resolve(location.hash);
  if (!shell) return renderShell();                    // 第一轉：先起 shell（shell 自己會再 render 一次）
  if (!r) {
    shell.innerHTML = `<div class="card"><div class="empty">
      ${icon('search', 26)}<div class="mt-8"><b>搵唔到呢一頁</b></div>
      <div class="sm faint mt-8"><span class="mono">${esc('#' + (location.hash || '/'))}</span> 唔係有效路徑。</div>
      <div class="mt-12"><a class="btn primary" href="#/dashboard">返儀表板</a></div></div></div>`;
    paintNav();
    return;
  }
  const path = currentPath().split('/')[0] || 'dashboard';
  const mod = moduleForPath(path);
  const role = S.getSession().role;
  if (mod && !mod.roles.includes(role)) {
    shell.innerHTML = `<div class="card"><div class="empty">
      ${icon('lock', 26)}<div class="mt-8"><b>未授權</b></div>
      <div class="sm faint mt-8">「${esc(mod.label)}」唔屬你嘅角色（${esc(roleLabel(role))}）範圍。要權限請搵旅長。</div>
      <div class="mt-12"><a class="btn" href="#/dashboard">返儀表板</a></div></div></div>`;
    paintNav();
    return;
  }
  try { r.handler(r.params, r.query); } catch (e) {
    console.error(e);
    shell.innerHTML = `<div class="card"><div class="err">頁面錯誤：${esc(e.message)}</div>
      <div class="btn-row mt-12"><a class="btn" href="#/dashboard">返儀表板</a></div></div>`;
  }
  paintNav();
}

/** 路由首段 → 註冊表模組（明細頁用別名） */
function moduleForPath(p) {
  return moduleById({ branch: 'branches', notice: 'notices', user: 'users' }[p] || p);
}

/* ---------------- 未登入：旅閘 + 登入 ---------------- */
function renderGate() {
  const d = S.load();
  document.body.innerHTML = `<div class="gate-wrap"><div class="gate" id="gate"></div></div><div id="toasts"></div>`;
  const gate = document.getElementById('gate');
  const step = new URLSearchParams(location.search).get('step') || 'unit';

  if (step === 'unit') {
    gate.innerHTML = `
      <div class="gate-hero">
        <div class="logo">⚜</div>
        <h1>旅系統 · 生態頂點</h1>
        <div class="faint">所有人由旅呢個窗口入；入到去先揀支部。</div>
      </div>
      <div class="grid g2">
        <button class="unit-card" id="pick">
          <span class="emblem">82</span>
          <span class="grow">
            <span class="bold">${esc(d.unit.name)}</span><br>
            <span class="xs faint">${esc(d.unit.district)} · ${esc(d.unit.sponsor)} · 5 個支部</span><br>
            <span class="xs faint">編號 ${esc(d.unit.code)} · 示範模式（MOCK）</span>
          </span>
          <span class="nx">${icon('arrowR', 18)}</span>
        </button>
        <div class="card">
          <div class="card-h"><h3 class="mb-0">伺服器登記狀態</h3>${spanTag()}</div>
          <div class="diag-list">
            server: 示範模式（未連接任何後端）<br>
            env: VERCEL_ENV = （本機）<br>
            ids: ["${esc(d.unit.code)}"]<br>
            trusted: ["${esc(d.unit.code)}"]<br>
            withKey: [] <span class="faint">← 示範：冇 key</span><br>
            suspicious: []
          </div>
          <div class="btn-row mt-8">
            <button class="btn sm" id="diag">${icon('info', 13)} 診斷</button>
            <button class="btn sm" id="apply">${icon('plus', 13)} 新旅部署申請</button>
          </div>
        </div>
      </div>
      <div class="center mt-12 xs faint">示範模式唔需要後端：所有資料住喺你部機（localStorage），唔會送去任何地方。</div>
      <div class="center mt-12"><button class="btn primary" id="pick2">${icon('arrowR', 15)} 入 ${esc(d.unit.name)}</button></div>`;
    const enterUnit = () => { location.href = location.pathname + '?step=login'; };
    gate.querySelector('#pick').onclick = enterUnit;
    gate.querySelector('#pick2').onclick = enterUnit;
    gate.querySelector('#diag').onclick = () => modal({
      title: '登記診斷（只列變數名，冇值）',
      body: `<div class="diag-list">ok: true<br>server: 'ecportal'<br>onVercel: false<br>vercelEnv: ''<br>region: ''<br>ids: ["${esc(d.unit.code)}"]<br>count: 1<br>recognizedNames: []<br>suspicious: []<br>withKey: []<br>trusted: ["${esc(d.unit.code)}"]<br>withName: ["${esc(d.unit.code)}"]</div>
      <div class="xs faint mt-8">常見問題：變數只勾咗 Production 但你開 Preview 網址；或者名打錯（<span class="mono">TROOP0082_BACKEND</span>／<span class="mono">TROOP_0082_BACKEND_URL</span> 會出現在 suspicious）。</div>`,
      footer: `<button class="btn primary" onclick="this.closest('.mask').remove()">明白</button>`
    });
    gate.querySelector('#apply').onclick = () => modal({
      title: '新旅部署申請',
      body: `<label class="f"><span class="lb">旅團編號</span><input type="text" id="ap-id" placeholder="0082"></label>
      <label class="f"><span class="lb">旅團名稱</span><input type="text" id="ap-name" placeholder="第八十二旅"></label>
      <label class="f"><span class="lb">Apps Script URL（B）</span><input type="text" id="ap-url" placeholder="https://script.google.com/macros/s/…/exec"></label>
      <label class="f"><span class="lb">API Key（D）</span><input type="text" id="ap-key" placeholder="travel_xxxx…"></label>
      <label class="f"><span class="lb">聯絡人</span><input type="text" id="ap-contact" placeholder="scouter@example.hk"></label>
      ${noticeBox('表單會 POST 去同源 <span class="mono">/api/proxy</span>（action=submitRegistration），由伺服器端送去固定嘅 ADMIN 收件匣（scout-admin）。<b>冇回執語義</b>：送得出去就當送到。')}`,
      footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-send>送出</button>`,
      onMount: (dlg, close) => {
        dlg.querySelector('[data-close]').onclick = close;
        dlg.querySelector('[data-send]').onclick = () => { close(); toast('已送出接入申請（示範）—— ADMIN 收到之後會加 units.json ＋ Vercel env', 'ok', '', null, 6000); };
      }
    });
    return;
  }

  // 登入
  const params = new URLSearchParams(location.search);
  const role = params.get('role') || '';
  const prefillEmail = params.get('email') || DEMO_LOGINS[0].email;
  gate.innerHTML = `
    <div class="login-wrap">
      <div class="gate-hero">
        <div class="logo" style="width:48px;height:48px;font-size:24px">82</div>
        <h1 style="font-size:22px">${esc(d.unit.name)}</h1>
        <div class="faint sm">${esc(d.unit.nameEn)}</div>
      </div>
      <div class="card pad-l">
        <h3 class="mt-0">登入</h3>
        <div class="xs faint mb-12">身份＝帳號：冇共用帳戶。你入到去嘅權限＝你喺旅層嘅身份。</div>
        <div class="login-tabs">
          ${DEMO_LOGINS.map(l => `<button class="chip ${l.role === role ? 'on' : ''}" data-demo="${l.userId}" title="${esc(l.desc)}">${icon('key', 12)} ${esc(l.label)}</button>`).join('')}
        </div>
        <label class="f"><span class="lb">電郵</span><input type="text" id="lg-email" value="${esc(prefillEmail)}" autocomplete="username"></label>
        <label class="f"><span class="lb">密碼</span><input type="password" id="lg-pw" value="${esc(DEMO_PASSWORD)}" autocomplete="current-password"></label>
        <div id="lg-err"></div>
        <button class="btn primary block mt-8" id="lg-go">${icon('arrowR', 15)} 登入</button>
        <div class="flex-b mt-12 xs">
          <a href="#" id="lg-forgot">忘記密碼？</a>
          <a href="#" id="lg-member">我係成員（去自己支部）</a>
        </div>
        <hr>
        <div class="xs faint">示範帳號密碼一律 <span class="mono">demo1234</span>。真模式：密碼由旅 GAS server-side 核對（PBKDF2 ≥100k、5 次失敗鎖 15 分鐘）。</div>
      </div>
      <div class="grid g2 mt-12">
        <a class="unit-card" href="public.html" target="_blank" rel="noopener"><span class="emblem">${icon('globe', 20)}</span><span class="grow"><span class="bold">公開頁（免登入）</span><br><span class="xs faint">睇旅公開資料（等級 0）</span></span></a>
        <button class="unit-card" id="lg-back"><span class="emblem">${icon('arrowL', 20)}</span><span class="grow"><span class="bold">返回旅閘</span><br><span class="xs faint">揀另一個旅</span></span></button>
      </div>
      <div class="center mt-12 xs faint">APP v0.1.0-ui（示範） · 後端：（未連接）</div>
    </div>`;

  gate.querySelectorAll('[data-demo]').forEach(b => b.addEventListener('click', () => {
    const r = loginAs(b.dataset.demo);
    if (r.ok) { location.href = location.pathname + (location.hash || ''); } else toast(r.msg, 'err');
  }));
  gate.querySelector('#lg-go').onclick = () => {
    const r = login(gate.querySelector('#lg-email').value, gate.querySelector('#lg-pw').value);
    if (!r.ok) { gate.querySelector('#lg-err').innerHTML = `<div class="err mb-8">${esc(r.msg)}</div>`; return; }
    if (r.mustChangePw) sessionStorage.setItem('troop.mustPw', '1');
    location.href = location.pathname + (location.hash || '');
  };
  gate.querySelector('#lg-pw').addEventListener('keydown', e => { if (e.key === 'Enter') gate.querySelector('#lg-go').click(); });
  gate.querySelector('#lg-back').onclick = () => { location.href = location.pathname; };
  gate.querySelector('#lg-forgot').onclick = e => { e.preventDefault(); modal({ title: '忘記密碼', body: `<div class="info-box">EMAIL 帳號：由旅 GAS 寄一次性連結（用一次即廢；回應統一，防帳號枚舉）。<br>SUPER 備援：平台 SUPER_KEY 重設。<br><br>示範模式：請直接撳上面嘅示範帳號。</div>`, footer: `<button class="btn primary" onclick="this.closest('.mask').remove()">明白</button>` }); };
  gate.querySelector('#lg-member').onclick = e => {
    e.preventDefault();
    modal({
      title: '成員入口（旅窗口）',
      body: `${noticeBox('成員帳號住<b>自己屬團嘅支部系統</b>；旅只做導流。你嘅密碼由該團後端核對 —— 旅系統唔會、亦唔可以代驗成員密碼。')}
      <label class="f mt-12"><span class="lb">我嘅支部</span><select id="me-b">${d.branches.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></label>
      <label class="f"><span class="lb">YMIS／SCOUT_ID</span><input type="text" id="me-y" placeholder="YMIS-2001"></label>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-go>去我嘅支部入口</button>`,
      onMount: (dlg, close) => {
        dlg.querySelector('[data-close]').onclick = close;
        dlg.querySelector('[data-go]').onclick = () => {
          const b = d.branches.find(x => x.id === dlg.querySelector('#me-b').value);
          close();
          modal({
            title: '已為你準備入口（示範）',
            body: `<div class="info-box">真模式會跳去：<br><span class="mono">${esc((b.code || b.id) + '/members.html?u=' + (b.code || b.id) + '&ymis=' + normId(dlg.querySelector('#me-y').value || 'YMIS-0000'))}</span><br><br>喺該團輸入密碼（預設 1234，首登強制改）。</div>`,
            footer: `<button class="btn primary" onclick="this.closest('.mask').remove()">明白</button>`
          });
        };
      }
    });
  };
}
const spanTag = () => `<span class="tag y sm">示範</span>`;
const noticeBox = m => `<div class="info-box">${m}</div>`;

/* ---------------- 已登入：Shell ---------------- */
function renderShell() {
  const d = S.load();
  const s = S.getSession();
  const c = S.counters();
  const dirty = S.dirtyCount();
  const role = s.role;
  document.body.innerHTML = `
    <div class="topbar">
      <button class="burger no-print" id="burger">${icon('menu', 18)}</button>
      <div class="logo">82</div>
      <div>
        <div class="title">${esc(d.unit.name)} <span class="tag gold sm">旅系統</span></div>
        <div class="sub">${esc(d.unit.nameEn)} · 5 個支部 · 示範模式</div>
      </div>
      <div class="spacer"></div>
      <div class="nowrap" style="text-align:right">
        <div class="who">${esc(s.name)} <span class="r">${esc(roleLabel(role))}</span></div>
        <div class="xs" id="dirty">${dirty ? `<span class="tag y sm">${dirty} 項未寫入</span>` : `<span class="tag g sm">已同步</span>`}</div>
      </div>
      <button class="btn sm ${dirty ? 'gold' : ''}" id="save-btn">${icon('upload', 14)} 儲存到後端${dirty ? `（${dirty}）` : ''}</button>
      <button class="btn sm" id="user-btn">${icon('users', 14)}</button>
    </div>
    <div class="banner demo no-print">
      <span class="tag">示範模式</span>
      <span class="grow">全部資料住喺你呢部機（localStorage）—— <b>唔會送去任何後端</b>。真模式：資料由旅 SHEET ＋ /exec 經同源 /api/proxy 讀寫。</span>
      <button class="btn xs" id="bn-docs">功能藍圖</button>
      <button class="btn xs" id="bn-logout">登出</button>
    </div>
    <div class="shell">
      <aside class="side" id="side">
        <nav class="nav" id="nav"></nav>
      </aside>
      <main class="main" id="view"></main>
    </div>`;

  document.getElementById('burger').onclick = () => document.getElementById('side').classList.toggle('collapsed');
  document.getElementById('save-btn').onclick = openSave;
  document.getElementById('user-btn').onclick = openUserMenu;
  document.getElementById('bn-logout').onclick = doLogout;
  document.getElementById('bn-docs').onclick = () => go('docs/blueprint');
  render();
}

function paintNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const s = S.getSession();
  const role = s.role;
  const c = S.counters();
  const here = currentPath().split('/')[0] || 'dashboard';
  const mods = modulesForRole(role).filter(m => !(role === 'parent' && m.id === 'dashboard'));
  const byGroup = {};
  mods.forEach(m => { (byGroup[m.group] = byGroup[m.group] || []).push(m); });

  nav.innerHTML = `
    <div class="group">${esc(S.load().unit.name)}</div>
    ${Object.entries(byGroup).map(([g, list]) => `
      ${g !== 'troop' ? `<div class="group">${esc(GROUPS[g] || g)}</div>` : ''}
      ${list.map(m => {
    const badge = m.badge ? m.badge(c) : 0;
    return `<a href="#/${m.id}" class="${m.id === here ? 'on' : ''}">${icon(m.icon, 16)}<span>${esc(m.label)}</span>${badge ? `<span class="badge">${badge}</span>` : ''}</a>`;
  }).join('')}
      ${list[0]?.subs && list[0].id === here ? `<div class="sub">${list[0].subs.map(su => `<a href="#/${here}?tab=${su.id.replace(/^[a-z]+-/, '')}">${esc(su.label)}</a>`).join('')}</div>` : ''}
    `).join('')}
    <div class="group">其他</div>
    <a href="#/docs" class="${here === 'docs' ? 'on' : ''}">${icon('book', 16)}<span>教學</span></a>
    <a href="public.html" target="_blank" rel="noopener">${icon('globe', 16)}<span>公開頁</span></a>
    <a href="#" id="nav-logout">${icon('logout', 16)}<span>登出</span></a>
    <div class="xs faint mt-12" style="padding:6px 10px">APP v0.1.0-ui · 示範<br>後端：（未連接）</div>`;
  nav.querySelector('#nav-logout').onclick = e => { e.preventDefault(); doLogout(); };
}

function doLogout() {
  confirmDlg({ title: '登出', message: S.dirtyCount() ? `仲有 <b>${S.dirtyCount()} 項未寫入後端</b>。登出唔會代你寫 —— 要寫就先撳「儲存到後端」。` : '確定登出？', ok: '登出' })
    .then(ok => { if (ok) { logout(); boot(); } });
}

function openSave() {
  if (!S.dirtyCount()) return toast('冇未寫入嘅改動', '');
  const d = S.load();
  const n = S.dirtyCount();
  const tables = ['通告', '行事曆', '財務整合', '用戶', '公開資料', '物資'].slice(0, 3);
  modal({
    title: '儲存到後端（唯一寫入掣）',
    body: `${noticeBox('真模式：只寫<b>有改過</b>嘅表（逐表寫）→ 寫完<b>即刻讀返自證</b> → 回 <span class="mono">{success:true, confirmed:true, reports}</span>。<br>示範模式：呢一步只係模擬收據，唔會發任何請求。')}
    <div class="kv mt-12">
      <dt>模式</dt><dd>${d.backend.mode}（示範）</dd>
      <dt>寫入路線</dt><dd>逐表寫 saveTables ＋ 自證</dd>
      <dt>未寫入改動</dt><dd>${n} 項</dd>
    </div>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-do>${icon('upload', 14)} 確認寫入</button>`,
    onMount: (dlg, close) => {
      dlg.querySelector('[data-close]').onclick = close;
      dlg.querySelector('[data-do]').onclick = () => {
        close();
        const ms = 240 + Math.random() * 400;
        setTimeout(() => {
          S.markSaved();
          const t = new Date().toISOString().replace('T', ' ').slice(0, 19);
          modal({
            title: '寫入收據',
            body: `<div class="mono-block">{
  success: true,
  confirmed: true,           // 寫完即刻讀返自證
  route: "saveTables（逐表寫）",
  tables: ${JSON.stringify(tables)},
  receipt: { at: "${t}", ms: ${Math.round(ms)}, rows: ${d.backend.rows} },
  reports: ["團員", "帳目", "物資"],   // 同一個請求順手刷報表
  backendVersion: "（示範）"
}</div>
            <div class="xs faint mt-8">如果 <span class="mono">confirmed:false</span>，前端會當失敗、改動原封不動留喺部機，唔會扮成功。</div>`,
            footer: `<button class="btn primary" onclick="this.closest('.mask').remove()">明白</button>`
          });
          paintNav();
          render();
        }, ms);
        toast('寫入中…', '');
      };
    }
  });
}

function openUserMenu() {
  const s = S.getSession();
  const u = S.currentUser();
  modal({
    title: '我嘅帳號',
    body: `<div class="kv">
      <dt>姓名</dt><dd>${esc(s.name)}</dd>
      <dt>角色</dt><dd>${esc(roleLabel(s.role))}${u?.title ? '（' + esc(u.title) + '）' : ''}</dd>
      <dt>帳號</dt><dd><span class="mono">${esc(s.email || '')}</span></dd>
      <dt>身份錨點</dt><dd>${s.role === 'parent' || s.role === 'chief' ? '旅 SHEET' : '所屬層'}</dd>
      <dt>可進入支部</dt><dd>${(u?.branchAccess || []).length ? u.branchAccess.map(b => esc(b === '*' ? '全旅' : S.branchName(b))).join('、') : '（按角色）'}</dd>
      <dt>登入方式</dt><dd>${esc(s.via || 'local')}（示範）</dd>
      <dt>上線時間</dt><dd>${esc(fmtStamp(s.at))}</dd>
    </div>
    <div class="btn-row mt-12"><button class="btn" id="um-pw">${icon('key', 13)} 改密碼</button></div>`,
    footer: `<button class="btn" data-close>關閉</button><button class="btn danger" data-out>登出</button>`,
    onMount: (dlg, close) => {
      dlg.querySelector('[data-close]').onclick = close;
      dlg.querySelector('[data-out]').onclick = () => { close(); doLogout(); };
      dlg.querySelector('#um-pw').onclick = () => { close(); openChangePw(false); };
    }
  });
}

function openChangePw(must) {
  const m = modal({
    title: must ? '首次登入：請改密碼' : '改密碼',
    body: `${must ? noticeBox('你嘅帳號係臨時密碼，改完先可以用其他功能（<span class="mono">mustChangePw</span> 期間只放行改密碼 API）。') : ''}
    <label class="f mt-8"><span class="lb">舊密碼</span><input type="password" id="pw-old" value="demo1234"></label>
    <label class="f"><span class="lb">新密碼（≥8 位）</span><input type="password" id="pw-new"></label>
    <label class="f"><span class="lb">再打一次</span><input type="password" id="pw-new2"></label>
    <div class="xs faint">改完 <span class="mono">pv+1</span> → 所有舊 session 即刻 401（要重新登入）。真模式：PBKDF2-SHA256 ≥100k ＋ per-user salt。</div>`,
    footer: `${must ? '' : '<button class="btn" data-close>取消</button>'}<button class="btn primary" data-do>確認改密碼</button>`,
    onMount: (dlg, close) => {
      dlg.querySelector('[data-close]')?.addEventListener('click', close);
      dlg.querySelector('[data-do]').onclick = () => {
        const a = dlg.querySelector('#pw-old').value, b = dlg.querySelector('#pw-new').value, c = dlg.querySelector('#pw-new2').value;
        if (b !== c) return toast('兩次新密碼唔同', 'err');
        const r = changePassword(a, b);
        if (!r.ok) return toast(r.msg, 'err');
        close(); toast('已改密碼（示範）', 'ok');
        renderShell();
      };
    }
  });
}

/* ---------------- 監聽 ---------------- */
window.addEventListener('hashchange', render);
document.addEventListener('DOMContentLoaded', boot);
if (document.readyState !== 'loading') boot();

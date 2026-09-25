/* ============================================================
   main.js — App Shell（旅閘 → 身份 → 登入 → 主介面）
   ------------------------------------------------------------
   登入路徑（死規矩）：
     旅長／教練員／家長  → 旅帳號直接登入（帳號住旅 SHEET）
     支部人員（團長、副團長、成員）→ 一定要「先揀團」：旅要對得上
        該團下游 SHEET 先入得到；未登記下游＝紅字講明，唔會靜靜地失敗。
     平台超管 → 隱藏入口（?step=super 或旅閘撳 ⚜ 五下），唔喺任何名單出現。
   ============================================================ */
import { esc, icon, toast, modal, confirmDlg, fmtStamp, normId } from './lib/util.js';
import * as S from './lib/store.js';
import { route, resolve, go, currentPath } from './lib/router.js';
import { MODULES, GROUPS, moduleList, moduleAllowed, modulesForSession, moduleById } from './lib/registry.js';
import {
  login, loginAs, logout, changePassword, DEMO_LOGINS, DEMO_BRANCH_LOGINS, DEMO_PASSWORD,
  SUPER_EMAIL, branchEntryStatus, roleLabel
} from './lib/auth.js';

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
import * as vMine from './views/mine.js';
import * as vShares from './views/shares.js';
import * as vSystem from './views/system.js';
import * as vPlatform from './views/platform.js';
import * as vDocs from './views/docs.js';

/* shell 會重寫 <body>，所以每次都要「當下」由 document 拎容器 */
const viewEl = () => document.getElementById('view');

/* ---------------- 路由 ---------------- */
route('', () => vDashboard.render(viewEl()));
route('dashboard', () => vDashboard.render(viewEl()));
route('mine', () => vMine.render(viewEl()));
route('shares', (p, q) => vShares.render(viewEl(), p, q));
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
route('platform', (p, q) => vPlatform.render(viewEl(), p, q));
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
      <div class="mt-12"><a class="btn primary" href="#/${homePath()}">${homeLabel()}</a></div></div></div>`;
    paintNav();
    return;
  }
  const path = currentPath().split('/')[0] || 'dashboard';
  const mod = moduleForPath(path);
  const session = S.getSession();
  if (session.role === 'super' && path === 'dashboard') { location.hash = '#/' + homePath(session); return; }
  if (mod && !moduleAllowed(mod, session)) {
    shell.innerHTML = `<div class="card"><div class="empty">
      ${icon('lock', 26)}<div class="mt-8"><b>未授權</b></div>
      <div class="sm faint mt-8">「${esc(mod.label)}」唔屬你嘅身份範圍（${esc(roleLabel(session.role))}${session.identity ? ' · ' + esc(session.identity) : ''}）。要權限請搵旅長或你團長。</div>
      <div class="mt-12"><a class="btn" href="#/${homePath()}">${homeLabel()}</a></div></div></div>`;
    paintNav();
    return;
  }
  try { r.handler(r.params, r.query); } catch (e) {
    console.error(e);
    shell.innerHTML = `<div class="card"><div class="err">頁面錯誤：${esc(e.message)}</div>
      <div class="btn-row mt-12"><a class="btn" href="#/${homePath()}">${homeLabel()}</a></div></div>`;
  }
  paintNav();
}

/** 每個角色嘅主場（登入後／撳 logo／「返主場」都嚟呢度） */
function homePath(session = S.getSession()) {
  return session.role === 'super' ? 'platform' : 'dashboard';
}
const homeLabel = () => (S.getSession().role === 'super' ? '返平台' : '返儀表板');

/** 路由首段 → 註冊表模組（明細頁用別名） */
function moduleForPath(p) {
  return moduleById({ branch: 'branches', notice: 'notices', user: 'users' }[p] || p);
}

/* ---------------- 未登入：旅閘 → 身份 → 登入 ---------------- */
const GATE_STEPS = ['unit', 'role', 'branch', 'login', 'super'];
function gateGo(step, extra = '') {
  location.href = location.pathname + '?step=' + step + (extra ? '&' + extra : '');
}
function gateQuery() { return new URLSearchParams(location.search); }

function renderGate() {
  const d = S.load();
  document.body.innerHTML = `<div class="gate-wrap"><div class="gate" id="gate"></div><div id="toasts"></div>`;
  const gate = document.getElementById('gate');
  const q = gateQuery();
  const step = GATE_STEPS.includes(q.get('step')) ? q.get('step') : 'unit';

  /* ---- 第一站：旅閘（揀旅） ---- */
  if (step === 'unit') {
    gate.innerHTML = `
      <div class="gate-hero">
        <div class="logo" id="badge" title="">⚜</div>
        <h1>旅系統 · 生態頂點</h1>
        <div class="faint">所有人由旅呢個窗口入；入到去先揀身份、再揀團。</div>
      </div>
      <div class="grid g2">
        <button class="unit-card" id="pick">
          <span class="emblem">82</span>
          <span class="grow">
            <span class="bold">${esc(d.unit.name)}</span><br>
            <span class="xs faint">${esc(d.unit.district)} · ${esc(d.unit.sponsor)} · ${d.branches.length} 個支部</span><br>
            <span class="xs faint">編號 ${esc(d.unit.code)} · 示範模式（MOCK）</span>
          </span>
          <span class="nx">${icon('arrowR', 18)}</span>
        </button>
        <div class="card">
          <div class="card-h"><h3 class="mb-0">伺服器登記狀態</h3><span class="tag y sm">示範</span></div>
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

    gate.querySelector('#pick').onclick = () => gateGo('role');
    gate.querySelector('#pick2').onclick = () => gateGo('role');
    /* 隱藏超管入口：撳 ⚜ 五下 */
    let taps = 0;
    const badge = gate.querySelector('#badge');
    badge.onclick = () => {
      taps++;
      if (taps >= 5) { sessionStorage.setItem('troop.superHint', '1'); gateGo('super'); }
      else if (taps >= 3) toast(`（${5 - taps}…）`, '', '', null, 900);
    };
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
      <div class="info-box">表單會 POST 去同源 <span class="mono">/api/proxy</span>（action=submitRegistration），由伺服器端送去固定嘅 ADMIN 收件匣（scout-admin）。<b>冇回執語義</b>：送得出去就當送到。</div>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-send>送出</button>`,
      onMount: (dlg, close) => {
        dlg.querySelector('[data-close]').onclick = close;
        dlg.querySelector('[data-send]').onclick = () => {
          commitRegistration(d);
          close();
          toast('已送出接入申請（示範）—— 超管收件匣會見到', 'ok', '', null, 6000);
        };
      }
    });
    return;
  }

  /* ---- 第二站：揀身份 ---- */
  if (step === 'role') {
    const st = d.branches.map(b => ({ b, st: branchEntryStatus(b.id) }));
    const ready = st.filter(x => x.st.ok).length;
    gate.innerHTML = `
      <div class="gate-hero">
        <div class="logo" style="width:48px;height:48px;font-size:22px">82</div>
        <h1 style="font-size:22px">你係邊個身份？</h1>
        <div class="faint sm">${esc(d.unit.name)} · 身份決定你嘅帳號住邊張 Sheet（身份＝SCOUT_ID ＋ 所在 SHEET）</div>
      </div>
      <div class="grid g2">
        <button class="unit-card" data-go="staff">
          <span class="emblem">旅</span>
          <span class="grow"><span class="bold">旅長 ／ 教練員</span><br>
          <span class="xs faint">帳號住旅 SHEET。旅層只有呢兩種：旅長同教練員（教練員按授權睇指定支部）</span></span>
          <span class="nx">${icon('arrowR', 16)}</span>
        </button>
        <button class="unit-card" data-go="parent">
          <span class="emblem">家</span>
          <span class="grow"><span class="bold">家長（監護人）</span><br>
          <span class="xs faint">帳號住旅 SHEET：子女跨支部自動併埋，子女編號由該團領袖確認</span></span>
          <span class="nx">${icon('arrowR', 16)}</span>
        </button>
        <button class="unit-card" data-go="branch">
          <span class="emblem">團</span>
          <span class="grow"><span class="bold">支部人員（團長／副團長／成員）</span><br>
          <span class="xs faint">帳號住自己團支部 SHEET。★ <b>一定要先揀團</b>：旅要先對得上該團下游，先入得到</span></span>
          <span class="nx">${icon('arrowR', 16)}</span>
        </button>
        <div class="card">
          <div class="card-h"><h3 class="mb-0">未登入都可以做嘅事</h3><span class="tag g sm">免密碼</span></div>
          <div class="btn-row">
            <a class="btn sm" href="public.html" target="_blank" rel="noopener">${icon('globe', 13)} 公開頁</a>
            <a class="btn sm" href="borrow.html" target="_blank" rel="noopener">${icon('box', 13)} 物資借用</a>
            <a class="btn sm" href="notice.html?n=n-1" target="_blank" rel="noopener">${icon('megaphone', 13)} 通告報名</a>
          </div>
          <div class="xs faint mt-8">公開頁同分享連結只放行你設定咗「等級 0」嘅資料；QR／連結永不帶 key。</div>
        </div>
      </div>
      <div class="mt-12">${noticeBox(`支部有人入得到：<b>${ready}</b> / ${d.branches.length} 團。其餘係「未登記下游 SHEET」—— 旅讀唔到該團資料，所以由旅窗口入唔到（唔係壞咗，係未登記）。`)}</div>
      <div class="center mt-12"><button class="btn" id="back">${icon('arrowL', 14)} 返回旅閘</button></div>`;
    gate.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
      const v = b.dataset.go;
      if (v === 'branch') return gateGo('branch');
      gateGo('login', 'path=' + v);
    }));
    gate.querySelector('#back').onclick = () => gateGo('unit');
    return;
  }

  /* ---- 第三站（只限支部人員）：揀團 ---- */
  if (step === 'branch') {
    const ymis = q.get('ymis') || '';
    gate.innerHTML = `
      <div class="gate-hero">
        <div class="logo" style="width:48px;height:48px;font-size:22px">團</div>
        <h1 style="font-size:22px">先揀你嘅團</h1>
        <div class="faint sm">你嘅帳號、密碼、名冊全部住喺所屬團嘅支部 SHEET。<br>旅只做導流：揀啱團 → 核對該團下游登記 → 轉去該團入口。</div>
      </div>
      <div class="grid" style="gap:10px">
        ${d.branches.map(b => {
          const st = branchEntryStatus(b.id);
          const cnt = S.membersOf(b.id).length;
          return `<div class="unit-card" style="cursor:default">
            <span class="emblem" style="background:${b.color}22;color:${b.color}">${esc(String(b.section || b.name).slice(0, 2))}</span>
            <span class="grow">
              <span class="bold">${esc(b.name)}</span>
              <span class="tag ${st.state === 'green' ? 'g' : st.state === 'yellow' ? 'y' : 'r'} sm">${st.state === 'green' ? '已接駁' : st.state === 'yellow' ? '已登記 · 未閂口' : '未登記下游'}</span>
              <br><span class="xs faint">${esc(b.section)} · 名冊 ${cnt} 筆（示範）${b.link?.testedAt ? ' · 上次測試 ' + esc(b.link.testedAt) : ''}</span>
              ${st.ok ? '' : `<div class="xs mt-8" style="color:var(--danger)">${esc(st.msg)}</div>`}
            </span>
            <span class="btn-row">
              ${st.ok
      ? `<button class="btn sm primary" data-pick="${b.id}">${icon('arrowR', 13)} 揀呢個團</button>`
      : `<button class="btn sm" data-why="${b.id}">點解入唔到？</button>`}
            </span>
          </div>`;
        }).join('')}
      </div>
      <div class="mt-12">${noticeBox('★ 旅唔會、亦唔可以代驗支部密碼。就算登記咗下游，登入仍然係喺該團自己嘅入口做（旅只係帶你過去）。未登記＝旅連「你有冇呢個人」都讀唔到，所以入唔到。')}</div>
      <div class="center mt-12"><button class="btn" id="back">${icon('arrowL', 14)} 返上一頁</button></div>`;
    gate.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => gateGo('login', 'path=branch&b=' + b.dataset.pick + (ymis ? '&ymis=' + encodeURIComponent(ymis) : ''))));
    gate.querySelectorAll('[data-why]').forEach(b => b.addEventListener('click', () => {
      const st = branchEntryStatus(b.dataset.why);
      modal({ title: '點解入唔到？', body: `<div class="err">${esc(st.msg)}</div>${noticeBox('旅長做一步就得：支部 → 揀該團 →「接駁與登記」填 URL ＋ KEY ＋ sig 用途 → 測試連線（綠燈）。')}`, footer: `<button class="btn primary" onclick="this.closest('.mask').remove()">明白</button>` });
    }));
    gate.querySelector('#back').onclick = () => gateGo('role');
    return;
  }

  /* ---- 第四站：登入 ---- */
  if (step === 'login') {
    const path = q.get('path') || 'staff';
    if (path === 'branch') return renderBranchLogin(gate, q);
    const isParent = path === 'parent';
    const logins = isParent ? DEMO_LOGINS.filter(l => l.role === 'parent') : DEMO_LOGINS.filter(l => l.role !== 'parent');
    gate.innerHTML = `
      <div class="login-wrap">
        <div class="gate-hero">
          <div class="logo" style="width:48px;height:48px;font-size:22px">82</div>
          <h1 style="font-size:22px">${esc(d.unit.name)}</h1>
          <div class="faint sm">${isParent ? '家長登入（帳號住旅 SHEET）' : '旅長／教練員登入（帳號住旅 SHEET）'}</div>
        </div>
        <div class="card pad-l">
          <div class="xs faint mb-12">身份＝帳號：冇共用帳戶。你入到去嘅權限＝你嘅身份。</div>
          <div class="login-tabs">
            ${logins.map(l => `<button class="chip" data-demo="${l.userId}" title="${esc(l.desc)}">${icon('key', 12)} ${esc(l.label)}</button>`).join('')}
          </div>
          <label class="f"><span class="lb">電郵</span><input type="text" id="lg-email" value="${esc(logins[0]?.email || '')}" autocomplete="username"></label>
          <label class="f"><span class="lb">密碼</span><input type="password" id="lg-pw" value="${esc(DEMO_PASSWORD)}" autocomplete="current-password"></label>
          <div id="lg-err"></div>
          <button class="btn primary block mt-8" id="lg-go">${icon('arrowR', 15)} 登入</button>
          <div class="flex-b mt-12 xs">
            <a href="#" id="lg-forgot">忘記密碼？</a>
            <a href="#" id="lg-switch">我其實係${isParent ? '旅長／教練員' : '家長'}／支部人員</a>
          </div>
          <hr>
          <div class="xs faint">示範帳號密碼一律 <span class="mono">demo1234</span>。真模式：密碼由旅 GAS server-side 核對（PBKDF2 ≥100k、5 次失敗鎖 15 分鐘）。</div>
        </div>
        <div class="grid g2 mt-12">
          <a class="unit-card" href="public.html" target="_blank" rel="noopener"><span class="emblem">${icon('globe', 20)}</span><span class="grow"><span class="bold">公開頁（免登入）</span><br><span class="xs faint">睇旅公開資料（等級 0）</span></span></a>
          <button class="unit-card" id="lg-back"><span class="emblem">${icon('arrowL', 20)}</span><span class="grow"><span class="bold">返回身份選擇</span><br><span class="xs faint">揀另一個入口</span></span></button>
        </div>
        <div class="center mt-12 xs faint">APP v0.2.0-ui（示範） · 後端：（未連接）</div>
      </div>`;
    bindLoginForm(gate, logins);
    gate.querySelector('#lg-switch').onclick = e => { e.preventDefault(); gateGo('role'); };
    gate.querySelector('#lg-back').onclick = () => gateGo('role');
    return;
  }

  /* ---- 隱藏：超管入口 ---- */
  if (step === 'super') {
    gate.innerHTML = `
      <div class="login-wrap">
        <div class="gate-hero">
          <div class="logo" style="width:48px;height:48px;font-size:22px">${icon('sparkle', 22)}</div>
          <h1 style="font-size:22px">平台（隱藏入口）</h1>
          <div class="faint sm">呢個入口唔會喺任何名單、導航、文件出現</div>
        </div>
        <div class="card pad-l">
          <label class="f"><span class="lb">超管帳號</span><input type="text" id="lg-email" value="${esc(SUPER_EMAIL)}" autocomplete="username"></label>
          <label class="f"><span class="lb">密碼</span><input type="password" id="lg-pw" value="${esc(DEMO_PASSWORD)}" autocomplete="current-password"></label>
          <div id="lg-err"></div>
          <button class="btn primary block mt-8" id="lg-go">${icon('arrowR', 15)} 登入平台</button>
          <hr>
          <div class="xs faint">示範：密碼 <span class="mono">demo1234</span>。超管帳號 = <span class="mono">${esc(SUPER_EMAIL)}</span>（<span class="mono">role: super</span>、<span class="mono">hidden: true</span>）—— 唔會出現喺「帳號名單」、唔會計入任何統計、唔會被邀請或停用。</div>
        </div>
        <div class="center mt-12"><button class="btn" id="lg-back">${icon('arrowL', 14)} 返旅閘</button></div>
      </div>`;
    bindLoginForm(gate, []);
    gate.querySelector('#lg-back').onclick = () => gateGo('unit');
    return;
  }
}

/* ---- 支部人員登入（已揀團） ---- */
function renderBranchLogin(gate, q) {
  const d = S.load();
  const bid = q.get('b') || '';
  const ymis = q.get('ymis') || '';
  const b = d.branches.find(x => x.id === bid);
  if (!b) { gateGo('branch'); return; }
  const st = branchEntryStatus(bid);
  if (!st.ok) {
    gate.innerHTML = `<div class="login-wrap"><div class="card">
      <h2 class="mt-0">${esc(b.name)} 入唔到</h2>
      <div class="err">${esc(st.msg)}</div>
      ${noticeBox('旅長做一步就得：支部 → 揀該團 →「接駁與登記」→ 測試連線。')}
      <div class="btn-row mt-12"><button class="btn" id="back">揀第二個團</button><a class="btn primary" href="index.html?step=login&path=staff">我係旅長／教練員</a></div>
    </div></div>`;
    gate.querySelector('#back').onclick = () => gateGo('branch');
    return;
  }
  const logins = DEMO_BRANCH_LOGINS.filter(l => l.branchId === bid);
  gate.innerHTML = `
    <div class="login-wrap">
      <div class="gate-hero">
        <div class="logo" style="width:48px;height:48px;font-size:20px;background:${b.color}">${esc(String(b.section || b.name).slice(0, 2))}</div>
        <h1 style="font-size:22px">${esc(b.name)}</h1>
        <div class="faint sm">${esc(b.section)} · <span class="tag ${st.state === 'green' ? 'g' : 'y'} sm">${st.state === 'green' ? '已接駁' : '已登記 · 未閂口'}</span></div>
      </div>
      <div class="card pad-l">
        ${noticeBox('★ <b>旅入口＝你嘅支部入口</b>：揀咗團，登入之後就直接入到<b>你支部個世界</b>（名冊、自己團通告、活動、物資），只係多咗「其他支部 share 俾你」嘅嘢 —— 唔使你另開一個支部系統、亦唔使再登多次。示範模式用以下帳號試身份差異：')}
        <div class="login-tabs mt-8">
          ${logins.map(l => `<button class="chip" data-demo="${l.userId}" title="${esc(l.desc)}">${icon('key', 12)} ${esc(l.label)}</button>`).join('')}
        </div>
        <label class="f"><span class="lb">YMIS ／ 團內帳號</span><input type="text" id="lg-email" value="${esc(logins[0]?.email || '')}" autocomplete="username"></label>
        <label class="f"><span class="lb">密碼</span><input type="password" id="lg-pw" value="${esc(DEMO_PASSWORD)}" autocomplete="current-password"></label>
        <label class="f"><span class="lb">YMIS（可空；用嚟對名冊）</span><input type="text" id="lg-ymis" value="${esc(ymis)}" placeholder="YMIS-2001"></label>
        <div id="lg-err"></div>
        <button class="btn primary block mt-8" id="lg-go">${icon('arrowR', 15)} 入 ${esc(b.name)}</button>
        <hr>
        <div class="xs faint">登入之後：儀表板（你支部嘅嘢）＋「我的支部」（身份卡／監護／家長同意）＋「分享中心」（其他支部 share 咗乜畀你，你決定收唔收）。成員、團長、副團長都係<b>同一個旅入口</b>（權限跟身份：團長／副團長 → 支部管理；成員 → 自己紀錄）。</div>
      </div>
      <div class="grid g2 mt-12">
        <button class="unit-card" id="switch"><span class="emblem">${icon('refresh', 20)}</span><span class="grow"><span class="bold">揀第二個團</span><br><span class="xs faint">${d.branches.length} 個支部</span></span></button>
        <a class="unit-card" href="public.html" target="_blank" rel="noopener"><span class="emblem">${icon('globe', 20)}</span><span class="grow"><span class="bold">公開頁</span><br><span class="xs faint">免登入</span></span></a>
      </div>
    </div>`;
  bindLoginForm(gate, logins, { keepBranch: true });
  gate.querySelector('#switch').onclick = () => gateGo('branch');
}

/* ---- 登入表單（旅層／家長／支部通用） ---- */
function bindLoginForm(gate, logins, opts = {}) {
  const q = gateQuery();
  gate.querySelectorAll('[data-demo]').forEach(b => b.addEventListener('click', () => {
    const r = loginAs(b.dataset.demo);
    if (r.ok) {
      if (r.mustChangePw) sessionStorage.setItem('troop.mustPw', '1');
      location.href = location.pathname + (location.hash || '');
    } else {
      toast(r.msg, 'err', '', null, 6000);
    }
  }));
  const submit = () => {
    const email = gate.querySelector('#lg-email').value;
    const pw = gate.querySelector('#lg-pw').value;
    const ymisEl = gate.querySelector('#lg-ymis');
    const r = login(email, pw);
    if (!r.ok) { gate.querySelector('#lg-err').innerHTML = `<div class="err mb-8">${esc(r.msg)}</div>`; return; }
    if (opts.keepBranch && ymisEl?.value.trim()) {
      S.setSession({ ...S.getSession(), ymis: normId(ymisEl.value.trim()) });
    }

    if (r.mustChangePw) sessionStorage.setItem('troop.mustPw', '1');
    location.href = location.pathname + (location.hash || '');
  };
  gate.querySelector('#lg-go').onclick = submit;
  gate.querySelector('#lg-pw').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  gate.querySelector('#lg-forgot')?.addEventListener('click', e => {
    e.preventDefault();
    modal({
      title: '忘記密碼',
      body: `<div class="info-box">EMAIL 帳號（旅長／教練員／家長）：由旅 GAS 寄一次性連結。<br>支部人員（團長／副團長／成員）：<b>搵自己團長重設</b>（帳號住該團 SHEET）。<br>超管備援：平台 SUPER_KEY。<br><br>示範模式：請直接撳上面嘅示範帳號。</div>`,
      footer: `<button class="btn primary" onclick="this.closest('.mask').remove()">明白</button>`
    });
  });
}

function commitRegistration(d) {
  S.commit(dd => {
    dd.applications.unshift({
      id: 'a-' + Date.now(), kind: 'troop', name: (document.querySelector('#ap-name')?.value || '').trim() || '（新旅）',
      email: (document.querySelector('#ap-contact')?.value || '').trim(),
      note: `新旅部署申請：編號 ${(document.querySelector('#ap-id')?.value || '').trim()} · URL ${((document.querySelector('#ap-url')?.value || '').slice(0, 42))}…`,
      at: new Date().toISOString().slice(0, 16).replace('T', ' '), state: 'pending', need: '超管接入（units.json ＋ Vercel env）'
    });
  });
  S.audit('提交新旅部署申請', d.unit.name, '');
}

const noticeBox = m => `<div class="info-box">${m}</div>`;

/* ---------------- 已登入：Shell ---------------- */
function renderShell() {
  const d = S.load();
  const s = S.getSession();
  const dirty = S.dirtyCount();
  const role = s.role;
  const who = [esc(s.name), esc(roleLabel(role)) + (s.identity ? ' · ' + esc(s.identity) : '') + (s.title ? ' · ' + esc(s.title) : '')].join(' <span class="r">') + '</span>';

  document.body.innerHTML = `
    <div class="topbar">
      <button class="burger no-print" id="burger" aria-label="選單">${icon('menu', 18)}</button>
      <a class="logo" href="#/${homePath(s)}" title="返${homePath(s) === 'platform' ? '平台' : '儀表板'}" style="text-decoration:none">82</a>
      <div class="grow" style="min-width:0">
        <div class="title trunc">${esc(d.unit.name)} <span class="tag gold sm">旅系統</span>${s.branchId ? ` <span class="tag n sm">${esc(S.branchName(s.branchId))}</span>` : ''}</div>
        <div class="sub trunc">${esc(d.unit.nameEn)} · ${d.branches.length} 個支部 · 示範模式</div>
      </div>
      <div class="nowrap hide-sm" style="text-align:right">
        <div class="who">${who}</div>
        <div class="xs" id="dirty">${dirty ? `<span class="tag y sm">${dirty} 項未寫入</span>` : `<span class="tag g sm">已同步</span>`}</div>
      </div>
      <button class="btn sm ${dirty ? 'gold' : ''}" id="save-btn" title="唯一寫入掣">${icon('upload', 14)}<span class="hide-sm"> 儲存到後端${dirty ? `（${dirty}）` : ''}</span></button>
      <button class="btn sm" id="user-btn" title="我嘅帳號">${icon('users', 14)}</button>
    </div>
    <div class="banner demo no-print">
      <span class="tag">示範</span>
      <span class="grow hide-sm">資料住呢部機（localStorage），唔會送去任何後端。真模式：旅 SHEET ＋ 同源 /api/proxy。</span>
      <button class="btn xs" id="bn-docs">功能藍圖</button>
      <button class="btn xs" id="bn-logout">登出</button>
    </div>
    <div class="shell">
      <aside class="side collapsed" id="side">
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

/* 導航：模組註冊表自動生成；分組可收合（電話默認收埋，撳先開） */
function paintNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const s = S.getSession();
  const c = S.counters();
  const here = currentPath().split('/')[0] || homePath(s);
  const mods = modulesForSession(s);
  const byGroup = {};
  mods.forEach(m => { (byGroup[m.group] = byGroup[m.group] || []).push(m); });
  const groupOrder = Object.keys(GROUPS).filter(g => byGroup[g]?.length);

  nav.innerHTML = `
    <div class="group">${esc(S.load().unit.name)}</div>
    ${groupOrder.map(g => {
    const open = byGroup[g].some(m => m.id === here);
    return `<details class="navgrp" ${open ? 'open' : ''}>
        <summary>${esc(GROUPS[g])}<span class="chev">${icon('chevD', 12)}</span></summary>
        ${byGroup[g].map(m => {
      const badge = m.badge ? m.badge(c) : 0;
      return `<a href="#/${m.id}" class="${m.id === here ? 'on' : ''}">${icon(m.icon, 16)}<span>${esc(m.label)}</span>${badge ? `<span class="badge">${badge}</span>` : ''}</a>`;
    }).join('')}
      </details>`;
  }).join('')}
    <div class="group">其他</div>
    <a href="public.html" target="_blank" rel="noopener">${icon('globe', 16)}<span>公開頁（免登入）</span></a>
    <a href="#" id="nav-logout">${icon('logout', 16)}<span>登出</span></a>
    <div class="xs faint mt-12" style="padding:6px 10px">APP v0.2.0-ui · 示範<br>後端：（未連接）${s.role === 'super' ? '<br><span class="tag r sm">超管（隱藏）</span>' : ''}</div>`;
  nav.querySelector('#nav-logout').onclick = e => { e.preventDefault(); doLogout(); };
}

function doLogout() {
  confirmDlg({
    title: '登出',
    message: S.dirtyCount() ? `仲有 <b>${S.dirtyCount()} 項未寫入後端</b>。登出唔會代你寫 —— 要寫就先撳「儲存到後端」。` : '確定登出？',
    ok: '登出'
  }).then(ok => { if (ok) { logout(); location.search = ''; gateGo('unit'); boot(); } });
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
  reports: ["團員", "帳目", "物資"],
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
  const rows = [
    ['姓名', esc(s.name)],
    ['角色', esc(roleLabel(s.role)) + (u?.title ? '（' + esc(u.title) + '）' : '')]
  ];
  if (s.role === 'member') {
    rows.push(['所屬支部', esc(S.branchName(s.branchId))]);
    rows.push(['身份／職稱', `${esc(s.identity || '—')}${s.title ? ' · ' + esc(s.title) : ''}`]);
    rows.push(['年齡組', s.ageGroup === 'adult' ? '18+（成年）' : '未夠 18（未成年）']);
    rows.push(['YMIS', `<span class="mono">${esc(s.ymis || '—')}</span>`]);
  }
  rows.push(['帳號', `<span class="mono">${esc(s.email || '')}</span>`]);
  rows.push(['身份錨點', esc(u?.anchor || (s.role === 'member' ? '該團支部 SHEET' : '旅 SHEET'))]);
  rows.push(['可進入支部', (u?.branchAccess || []).length ? u.branchAccess.map(b => esc(b === '*' ? '全旅' : S.branchName(b))).join('、') : '（按角色）']);
  rows.push(['登入方式', esc(s.via || 'local') + '（示範）']);
  rows.push(['上線時間', esc(fmtStamp(s.at))]);
  modal({
    title: '我嘅帳號',
    body: `<div class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</div>
    ${s.role === 'member' ? noticeBox('你嘅主場喺自己團支部系統（名冊、進度、內部通告）。旅窗口只放行你身份睇得到嘅嘢。') : ''}
    <div class="btn-row mt-12">${s.role === 'member' ? '<a class="btn" href="#/mine">我嘅身份卡</a>' : ''}<button class="btn" id="um-pw">${icon('key', 13)} 改密碼</button></div>`,
    footer: `<button class="btn" data-close>關閉</button><button class="btn danger" data-out>登出</button>`,
    onMount: (dlg, close) => {
      dlg.querySelector('[data-close]').onclick = close;
      dlg.querySelector('[data-out]').onclick = () => { close(); doLogout(); };
      dlg.querySelector('#um-pw').onclick = () => { close(); openChangePw(false); };
    }
  });
}

function openChangePw(must) {
  modal({
    title: must ? '首次登入：請改密碼' : '改密碼',
    body: `${must ? noticeBox('你嘅帳號用臨時密碼，改完先可以用其他功能（<span class="mono">mustChangePw</span> 期間只放行改密碼 API）。') : ''}
    <label class="f mt-8"><span class="lb">舊密碼</span><input type="password" id="pw-old" value="${esc(DEMO_PASSWORD)}"></label>
    <label class="f"><span class="lb">新密碼（≥8 位）</span><input type="password" id="pw-new"></label>
    <label class="f"><span class="lb">再打一次</span><input type="password" id="pw-new2"></label>
    <div class="xs faint">改完 <span class="mono">pv+1</span> → 所有舊 session 即刻 401。真模式：PBKDF2-SHA256 ≥100k ＋ per-user salt。</div>`,
    footer: `${must ? '' : '<button class="btn" data-close>取消</button>'}<button class="btn primary" data-do>確認改密碼</button>`,
    onMount: (dlg, close) => {
      dlg.querySelector('[data-close]')?.addEventListener('click', close);
      dlg.querySelector('[data-do]').onclick = () => {
        const r = changePassword(dlg.querySelector('#pw-old').value, dlg.querySelector('#pw-new').value);
        if (!r.ok) return toast(r.msg, 'err');
        if (dlg.querySelector('#pw-new').value !== dlg.querySelector('#pw-new2').value) return toast('兩次新密碼唔同', 'err');
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

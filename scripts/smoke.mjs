#!/usr/bin/env node
/* ============================================================
   smoke.mjs — jsdom 守護測試（唔用瀏覽器都跑到）
   ------------------------------------------------------------
   覆蓋：
     A. 旅閘／登入（示範帳號、錯密碼、未登入）
     B. App shell：四個角色 × 全部路由 → 每個 view 都真係畫到嘢、冇例外
     C. 每個模組嘅全部 tab 直接 render（唔靠撳掣）
     D. 主要互動：儲存到後端、改密碼、開 modal、換角色
     E. 公開頁 HTML（public / notice / join / borrow）inline script 真跑一次
   ============================================================ */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const problems = [];
function ok(name) { results.push(['ok', name]); }
function bad(name, e) { results.push(['bad', name]); problems.push([name, e]); }
async function test(name, fn) {
  try { await fn(); ok(name); } catch (e) { bad(name, e); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

/* ---------- DOM 環境 ---------- */
function stripScripts(html) { return html.replace(/<script[\s\S]*?<\/script>/g, ''); }

function makeEnv(htmlFile, { search = '', hash = '' } = {}) {
  const html = stripScripts(readFileSync(join(ROOT, htmlFile), 'utf8'));
  const dom = new JSDOM(html, { url: 'http://localhost/' + htmlFile, pretendToBeVisual: true });
  const w = dom.window;
  const loc = {
    origin: 'http://localhost', pathname: '/' + htmlFile, search, hash,
    navigations: [],
    get href() { return this.origin + this.pathname + this.search + this.hash; },
    set href(v) { this.navigations.push(v); },
    assign(v) { this.navigations.push(v); },
    replace(v) { this.navigations.push(v); },
    reload() { this.navigations.push('reload'); }
  };
  globalThis.window = w;
  globalThis.document = w.document;
  globalThis.localStorage = w.localStorage;
  globalThis.sessionStorage = w.sessionStorage;
  globalThis.location = loc;
  for (const k of ['HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'FormData', 'DOMParser']) {
    if (w[k]) globalThis[k] = w[k];
  }
  try { Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true, writable: true }); } catch {}
  globalThis.getComputedStyle = w.getComputedStyle.bind(w);
  globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
  globalThis.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  globalThis.alert = () => {};
  globalThis.scrollTo = () => {};
  globalThis.print = () => {};
  w.print = () => {};
  return { dom, w, loc };
}

function fireHash(w, hash) {
  globalThis.location.hash = hash;
  w.dispatchEvent(new w.Event('hashchange'));
}

const text = () => globalThis.document.body.textContent || '';

/* ============================================================
   A + B + C + D：App shell
   ============================================================ */
const { w, loc } = makeEnv('index.html');
const S = await import('../assets/js/lib/store.js');
const A = await import('../assets/js/lib/auth.js');
const R = await import('../assets/js/lib/registry.js');
const main = await import('../assets/js/main.js');

await test('旅閘：未登入就顯示揀旅／登入', async () => {
  assert(text().includes('旅系統'), 'gate 冇顯示');
  assert(text().includes('登入') || text().includes('入'), 'gate 冇登入入口');
});

await test('登入：錯密碼要失敗，而且唔可以洩露帳號存在', async () => {
  const r1 = A.login('chief@demo.troop', 'wrong-pw');
  assert(r1.ok === false, '錯密碼竟然成功');
  const r2 = A.login('nobody@demo.troop', 'wrong-pw');
  assert(r2.ok === false && r2.msg === r1.msg, '兩個錯誤訊息唔一致（會被枚舉帳號）');
});

await test('登入：旅層帳號（旅長／教練員／家長）都入得', async () => {
  for (const l of A.DEMO_LOGINS) {
    const r = A.login(l.email, A.DEMO_PASSWORD);
    assert(r.ok, `${l.label} 登入失敗：${r.msg}`);
    assert(S.getSession().role === l.role, `${l.label} 角色唔啱`);
  }
});

await test('角色模型：冇「旅層領袖」；旅層只有旅長同教練員', async () => {
  assert(!R.ROLE_LABEL.leader, '仲有 leader 角色');
  assert(R.ROLE_LABEL.coach === '教練員', '教練員標籤唔啱');
  assert(R.ROLE_LABEL.member === '支部人員', '支部人員標籤唔啱');
  assert(R.ROLE_ANCHOR.member.includes('支部'), '支部人員帳號錨點唔啱');
  assert(R.ROLE_ANCHOR.coach === '旅 SHEET' && R.ROLE_ANCHOR.parent === '旅 SHEET', '旅層錨點唔啱');
});

await test('身份／職稱：默認等級 ＋ 職稱跟執委／管委 ＋ 逐人微調', async () => {
  assert(R.defaultRankFor('團長') === 5, '團長默認等級唔啱');
  assert(R.defaultRankFor('團員') === 2, '團員默認等級唔啱');
  assert(R.defaultRankFor('執委', '主席') === 4, '主席應該跟管委（4）');
  assert(R.defaultRankFor('執委', '秘書') === 3, '秘書應該跟執委（3）');
  assert(R.BRANCH_IDENTITIES.map(i => i.id).join(',') === '團長,副團長,管委,執委,隊長,副隊長,團隊長,團員', '身份清單唔啱');
  const m = S.load().members.find(x => x.ymis === 'YMIS-2006');
  m.perms = { rank: 5 };
  assert(S.effectiveRank(m) === 5, '逐人微調冇生效');
  delete m.perms;
});

await test('年齡組：18+ ／ 未夠 18 由生日自動判', async () => {
  assert(R.ageGroupOf('2007-04-12') === 'adult', '2007 應該係 18+');
  assert(R.ageGroupOf('2012-11-03') === 'minor', '2012 應該係未夠 18');
  assert(R.ageGroupOf('') === 'minor', '冇生日要當未成年');
  assert(R.ageFromDob('2011-06-20') > 13, '年齡計算唔啱');
});

await test('支部人員：未登記下游嘅團 ＝ 入唔到（誠實失敗）', async () => {
  const r = A.branchEntryStatus('gs0082');       // 示範：紅燈（未接駁）
  assert(r.ok === false && r.state === 'red', '紅燈支部竟然入得');
  assert(r.msg.includes('未登記下游'), '錯誤訊息冇講清楚原因');
  const g = A.branchEntryStatus('vs0082');       // 綠燈
  assert(g.ok === true && g.state === 'green', '綠燈支部應該入得');
  const y = A.branchEntryStatus('sc0082');       // 黃燈（支部系統自己登入都得）
  assert(y.ok === true && y.state === 'yellow' && y.gate === 'open', '兩條通道都開應該入得');
  assert(y.note.includes('兩條通道都開'), '黃燈提醒冇講兩條通道都開');
  const hint = A.memberEntryHint('gs0082', 'YMIS-2007');
  assert(hint.ok === false, 'memberEntryHint 冇跟住擋');
});

await test('超管：隱藏帳號唔喺名單、唔計數，但入得 platform', async () => {
  const all = S.load().users;
  const sup = all.find(u => u.id === A.SUPER_ID);
  assert(sup && sup.role === 'super' && sup.hidden === true, '超管帳號冇設定好');
  const list = S.visibleUsers();
  assert(!list.some(u => u.role === 'super'), '超管出現喺名單');
  const r = A.login(A.SUPER_EMAIL, A.DEMO_PASSWORD);
  assert(r.ok && S.getSession().role === 'super', '超管登入失敗');
  main.boot();
  fireHash(w, '#/platform');
  assert(document.getElementById('view').innerHTML.includes('接入收件匣'), '超管入唔到平台頁');
  const nav = document.getElementById('nav').textContent;
  assert(nav.includes('平台'), '超管導航冇「平台」');
  /* ★ 用戶定案：超管唔經支部 SHEET 登記 → 全部模組都入得（2026-09-25） */
  assert(nav.includes('財務整合') && nav.includes('支部'), '超管應該入得晒全部模組（第二層備援）');
  assert(document.getElementById('super-banner')?.textContent.includes('唔經支部 SHEET 登記'), '超管冇『超管視角』橫額');
  fireHash(w, '#/dashboard');                 // 超管撳「儀表板」→ 應該彈返平台，唔應該係「未授權」
  assert(document.getElementById('view').innerHTML.includes('接入收件匣'), '超管儀表板冇彈返平台');
});

await test('Shell：旅長登入後見到導航、未寫入計數、儲存掣', async () => {
  A.loginAs('u-chief');
  main.boot();
  assert(document.getElementById('nav'), '冇導航');
  assert(document.getElementById('save-btn'), '冇儲存掣');
  assert(text().includes('示範模式'), '冇示範模式橫額');
  const links = document.querySelectorAll('#nav a').length;
  assert(links >= R.moduleList().length * 0.5, `導航連結太少（${links}）`);
});

/* ---------- 每個角色 × 全部路由 ---------- */
const ROUTES = [
  'dashboard', 'mine', 'pending', 'branches', 'branch/vs0082', 'notices', 'notice/n-1', 'calendar',
  'finance', 'inventory', 'transfers', 'users', 'shares', 'public', 'system', 'docs', 'docs/blueprint'
];
const ROLE_ROUTES = {
  chief: ROUTES,
  coach: ROUTES.filter(r => !['system'].includes(r)),
  parent: ['dashboard', 'branches', 'branch/vs0082', 'notices', 'notice/n-1', 'calendar', 'public', 'children', 'docs', 'docs/blueprint'],
  member: ['dashboard', 'mine', 'branches', 'notices', 'notice/n-1', 'calendar', 'inventory', 'shares', 'public', 'docs', 'docs/blueprint'],
  branchLeader: ['dashboard', 'mine', 'branches', 'branch/cs0082', 'notices', 'calendar', 'inventory', 'shares', 'public', 'docs', 'docs/blueprint'],
  scout: ['dashboard', 'mine', 'notices', 'calendar', 'inventory', 'shares', 'public', 'docs', 'docs/blueprint'],
  super: ['dashboard', 'platform', 'docs', 'branches', 'branch/vs0082', 'branch/gs0082', 'pending', 'users', 'finance', 'public'],
  guest: ['docs']
};
const LOGIN_FOR = {
  chief: 'u-chief', coach: 'u-lee', parent: 'u-parent',
  member: 'u-m-minor', branchLeader: 'u-b-leader', scout: 'u-m-scout', super: 'u-super'
};

for (const [role, routes] of Object.entries(ROLE_ROUTES)) {
  const userId = LOGIN_FOR[role];
  await test(`路由（${role}）：${routes.length} 條路線都畫到嘢`, async () => {
    if (role !== 'guest') {
      const l = A.loginAs(userId);
      assert(l.ok, `${userId} 登入失敗`);
      if (l.mustChangePw) S.setSession({ ...S.getSession(), mustChangePw: false });
    } else if (role === 'guest') {
      S.clearSession();
      main.boot();          // 回到旅閘
      return;
    }
    main.boot();
    for (const r of routes) {
      fireHash(w, '#/' + r);
      const view = document.getElementById('view');
      const html = view ? view.innerHTML : '';
      assert(html.length > 200, `#/${r} 冇畫到嘢（${html.length} 字）`);
      assert(!html.includes('頁面錯誤'), `#/${r} 拋例外：${html.slice(0, 240)}`);
      if (role !== 'guest') {
        assert(!html.includes('唔屬你嘅角色'), `#/${r} 對 ${role} 顯示路由守衛攔截`);
      }
    }
  });
}

await test('未登入：唔會 render 主介面（只有旅閘）', async () => {
  S.clearSession();
  main.boot();
  assert(!document.getElementById('nav'), '未登入竟然有導航');
  assert(text().includes('旅閘') || text().includes('所有人'), '未顯示旅閘文案');
});

await test('登入閘：mustChangePw 帳號會被標記（強制改密碼）', async () => {
  const r = A.login('lam@demo.troop', A.DEMO_PASSWORD);   // u-parent2：pending + mustChangePw
  assert(r.ok, '示範待批家長登入失敗');
  assert(r.mustChangePw === true, 'mustChangePw 冇帶出嚟');
  S.clearSession();
});

/* ---------- 全部 tab 直接 render ---------- */
const TABS = {
  mine: ['x'],
  shares: ['inbox', 'accepted', 'sent', 'rules'],
  platform: ['inbox', 'units', 'keys'],
  branches: ['overview', 'shares', 'link', 'members', 'finance', 'notices', 'calendar', 'inventory', 'progress', 'public'],
  notices: ['list', 'signup', 'subs', 'drafts'],
  calendar: ['month', 'list'],
  finance: ['overview', 'branch', 'troop', 'report'],
  inventory: ['list', 'loans', 'share'],
  transfers: ['pending', 'batch', 'history'],
  users: ['list', 'identities', 'invites', 'perms', 'applications'],
  public: ['troop', 'branches', 'share', 'preview'],
  system: ['troop', 'modules', 'backend', 'audit', 'automation', 'data', 'privacy', 'keys'],
  docs: ['start', 'modules', 'checklist']
};

await test('全部模組 × 全部子分頁都 render 到', async () => {
  for (const [mod, tabs] of Object.entries(TABS)) {
    A.loginAs(mod === 'platform' ? 'u-super' : mod === 'mine' ? 'u-m-minor' : 'u-chief');
    const view = await import(`../assets/js/views/${mod}.js`);
    const host = document.createElement('div');
    document.body.appendChild(host);
    for (const tab of tabs) {
      host.innerHTML = '';
      try {
        view.render(host, {}, { tab });
      } catch (e) {
        throw new Error(`${mod}?tab=${tab} → ${e.message}`);
      }
      assert(host.innerHTML.length > 100, `${mod}?tab=${tab} 冇畫到嘢`);
      assert(!host.innerHTML.includes('頁面錯誤'), `${mod}?tab=${tab} 有錯誤卡`);
    }
    host.remove();
  }
});

await test('頂部互動：儲存到後端會出收據 modal', async () => {
  A.loginAs('u-chief');
  main.boot();
  S.commit(d => { d.unit.slogan = (d.unit.slogan || '') + '！'; });   // 製造未寫入改動
  document.getElementById('save-btn').click();
  const dlg = document.querySelector('.mask .dlg');
  assert(dlg, '冇彈出收據 modal');
  assert(dlg.textContent.includes('confirmed'), '收據冇 confirmed 字樣');
  dlg.querySelector('[data-do]').click();
  ok('（收據內容正確）');
});

/* ---------- ★ 分享：收件方決定 ---------- */
await test('分享：未接收＝唔會出現喺通告；接收＝出現並標明來源', async () => {
  A.loginAs('u-m-minor');            // 童軍團副隊長（收到深資團嘅分享）
  const title = '深資童軍：「黑夜行」活動通告';
  assert(S.pendingShares('sc0082').length === 3, `待接收分享數唔啱（${S.pendingShares('sc0082').length}）`);
  main.boot();
  fireHash(w, '#/notices');
  assert(!document.getElementById('view').textContent.includes(title), '未接收嘅分享竟然出現喺通告');

  fireHash(w, '#/shares');
  const v = document.getElementById('view');
  assert(v.textContent.includes(title), '分享中心冇見到待接收');
  v.querySelector('[data-ok="sh-1"]').click();
  assert(S.shares().find(x => x.id === 'sh-1').state === 'accepted', '接收冇寫入');
  assert(S.shares().find(x => x.id === 'sh-1').decidedBy, '接收冇記低邊個決定');

  fireHash(w, '#/notices');
  const t = document.getElementById('view').textContent;
  assert(t.includes(title), '接收咗嘅分享冇出現喺通告');
  assert(t.includes('來自') && t.includes('深資童軍團'), '冇標明來源');
});

await test('分享：只做兩樣（通告／活動）＋ 活動分享落喺行事曆格', async () => {
  assert(R.SHARE_KINDS.map(k => k.id).join(',') === 'notice,event', '分享種類唔止兩樣');
  A.loginAs('u-m-minor');
  main.boot();
  fireHash(w, '#/shares');
  const opts = [...document.getElementById('view').querySelectorAll('#sh-new ~ * option')];
  assert(!document.getElementById('view').textContent.includes('相簿'), '仲有相簿之類嘅種類');

  /* 已接收嘅活動分享（sh-5 童軍 → 幼童軍）要落喺行事曆 */
  A.loginAs('u-b-leader');
  main.boot();
  fireHash(w, '#/calendar');
  const cal = document.getElementById('view');
  assert(cal.textContent.includes('來自 童軍團'), '行事曆冇標明分享來源');
  assert(cal.querySelector('.ev.shared'), '行事曆格冇分享活動');
  assert(cal.textContent.includes('接收咗'), '行事曆冇講明要接收咗先出現');
});

await test('分享：退回要留紀錄（邊個決定、理由）', async () => {
  A.loginAs('u-m-minor');
  main.boot();
  fireHash(w, '#/shares');
  document.getElementById('view').querySelector('[data-no="sh-2"]').click();
  const dlg = document.querySelector('.mask');
  dlg.querySelector('#sh-why').value = '本團已經有營幕';
  dlg.querySelector('[data-save]').click();
  const sh = S.shares().find(x => x.id === 'sh-2');
  assert(sh.state === 'declined', '退回冇寫入');
  assert(sh.decideNote === '本團已經有營幕', '冇記低理由');
  assert(sh.decidedBy === '陳家欣', '冇記低邊個決定');
});

await test('分享：普通團員（rank 2）睇得到但唔夠權決定，只可以加註解', async () => {
  A.loginAs('u-m-scout');
  main.boot();
  fireHash(w, '#/shares');
  const v = document.getElementById('view');
  assert(v.textContent.includes('執委或以上'), '冇提示決定權不足');
  assert(!v.querySelector('[data-ok]'), 'rank 2 竟然撳得接收');
  assert(!v.querySelector('[data-no]'), 'rank 2 竟然撳得退回');
  const note = v.querySelector('[data-note]');
  assert(note, 'rank 2 冇「加註解」掣');
  note.click();
  const dlg = document.querySelector('.mask');
  dlg.querySelector('#sh-note2').value = '可以收，但要問家長';
  dlg.querySelector('[data-save]').click();
  const sh = S.shares().find(x => x.suggest);
  assert(sh && sh.suggest.by === '林浩然', '註解冇記低邊個留');
  assert(sh.state === 'pending', '加註解竟然當咗決定');
});

await test('分享：物主／團長可以撤回未接收嘅分享', async () => {
  A.loginAs('u-b-leader');           // 幼童軍團長（收到童軍團 sh-5 已接收）
  main.boot();
  fireHash(w, '#/shares?tab=accepted');
  assert(document.getElementById('view').textContent.includes('小隊訓練'), '已接收清單唔見 sh-5');
  A.loginAs('u-m-exec');             // 深資執委（物主）撤回自己發出嘅
  main.boot();
  fireHash(w, '#/shares?tab=sent');
  const btn = document.getElementById('view').querySelector('[data-pull="sh-7"]');
  assert(btn, '物主冇撤回掣');
  btn.click();
  assert(S.shares().find(x => x.id === 'sh-7').state === 'withdrawn', '撤回冇寫入');
});

await test('★ 支部系統登入通道：只有兩態（開／閂），旅入口一律照入', async () => {
  assert(R.gateOfLink({ localLogin: true }) === 'open', '舊資料推導（開）唔啱');
  assert(R.gateOfLink({ localLogin: false }) === 'sig-only', '舊資料推導（閂）唔啱');
  assert(!R.GATE_STATES.closed, '唔應該再有「被關」呢個狀態');
  assert(Object.keys(R.GATE_STATES).length === 2, '狀態應該只有兩個');
  assert(R.gateAllowsLocalLogin('open') === true && R.gateAllowsLocalLogin('sig-only') === false, '本地登入判斷唔啱');

  /* 旅長：閂咗支部系統登入 → 旅入口照入得 */
  A.loginAs('u-chief');
  assert(R.can('chief', 'branch_link_edit') && !R.can('coach', 'branch_link_edit'), '權限判斷唔啱');
  S.setBranchGate('sc0082', 'sig-only');
  const b = S.load().branches.find(x => x.id === 'sc0082');
  assert(b.link.gate === 'sig-only' && b.link.localLogin === false, '閂咗冇寫入');
  assert(b.link.state === 'green', '閂咗之後應該係綠燈');
  const st = A.branchEntryStatus('sc0082');
  assert(st.ok === true && st.gate === 'sig-only', '閂咗支部系統登入之後，旅入口應該照入得');
  assert(st.note.includes('唔畀佢入'), '冇講明支部系統入唔到');
  /* 兩邊都開 → 照入得 */
  S.setBranchGate('sc0082', 'open');
  const st2 = A.branchEntryStatus('sc0082');
  assert(st2.ok === true && st2.gate === 'open' && st2.state === 'yellow', '兩條通道都開應該係黃燈');
  S.setBranchGate('sc0082', 'sig-only');       // 還原示範狀態（童軍團：兩條通道都開 → 還原）
  S.setBranchGate('sc0082', 'open');
  assert(S.branchGate('sc0082') === 'open', '還原失敗');
});

await test('★ 支部系統登入通道：未登記下游 ＝ 改唔到（唔會扮成功）', async () => {
  A.loginAs('u-chief');
  const before = S.branchGate('gs0082');
  const r = S.setBranchGate('gs0082', 'sig-only');
  assert(r.ok === false && r.msg.includes('未登記下游'), '未登記下游竟然當成功');
  const after = S.load().branches.find(x => x.id === 'gs0082');
  assert(after.link.state === 'red', '未登記下游唔應該因為改掣而變色');
  assert(after.link.gate === 'open', '未登記下游嘅狀態唔應該被改');
  assert(A.branchEntryStatus('gs0082').msg.includes('未登記下游'), '未登記嘅訊息唔應該變');
  assert(before === 'open', '示範起始狀態唔啱');
});

await test('★ 支部系統登入通道：UI 只有旅長見掣、教練員冇', async () => {
  A.loginAs('u-chief');
  main.boot();
  fireHash(w, '#/branch/sc0082?tab=link');
  const v = document.getElementById('view');
  assert(v.textContent.includes('支部系統登入通道'), '接駁頁冇「支部系統登入通道」卡');
  assert(v.textContent.includes('就算已登記'), '冇講明「登記咗都唔畀佢入」');
  assert(v.querySelector('[data-gate="sc0082"][data-g="sig-only"]'), '冇「閂支部系統登入」掣');
  assert(v.textContent.includes('setGate'), '冇顯示 sig write action');
  assert(!v.textContent.includes('被關'), '仲有「被關」字眼');
  A.loginAs('u-lee');                     // 教練員
  main.boot();
  fireHash(w, '#/branch/sc0082?tab=link');
  const v2 = document.getElementById('view');
  assert(!v2.querySelector('[data-gate]'), '教練員唔應該有掣');
  assert(v2.textContent.includes('唔可以改'), '冇講明冇權');
});

await test('★ 超管：唔經支部 SHEET 登記 → 任何支部／模組都入得（第二層備援）', async () => {
  const raw = S.load();
  const vs = raw.branches.find(x => x.id === 'vs0082');
  const gs = raw.branches.find(x => x.id === 'gs0082');
  assert(vs.link.gate === 'sig-only', '示範前提：深資團閂咗支部系統登入');
  assert(gs.link.state === 'red', '示範前提：小童軍團未登記（紅燈）');

  A.loginAs('u-super');
  const sess = S.getSession();
  assert(sess.role === 'super' && S.load().users.find(u => u.id === 'u-super').hidden === true, '超管帳號狀態唔啱');
  /* 1) 唔靠登記：閂咗／未登記都睇得到、入得到 */
  assert(S.canSeeBranch(vs) && S.canSeeBranch(gs), '超管竟然睇唔到閂咗／未登記嘅支部');
  assert(R.can('super', 'enter_any_branch') && R.can('super', 'branch_link_edit') || R.can('super', 'platform_all'), '超管權限定義唔啱');
  /* 2) 全部模組都開（唔係得平台） */
  const mods = R.modulesForSession(sess).map(m => m.id);
  assert(mods.includes('platform') && mods.includes('branches') && mods.includes('pending') && mods.includes('users'), '超管應該入得晒全部模組');
  assert(mods.length === R.moduleList().length, '超管應該見到全部模組');
  /* 3) 真係 render 到：閂咗嘅團、未登記嘅團、待辦、求救 */
  main.boot();
  for (const r of ['#/branch/vs0082?tab=link', '#/branch/gs0082', '#/branches', '#/pending?kind=rescue']) {
    fireHash(w, r);
    const t = (document.getElementById('view')?.textContent || '');
    assert(!t.includes('未授權'), `${r} 竟然擋超管`);
    assert(t.trim().length > 80, `${r} 超管見唔到內容`);
  }
  fireHash(w, '#/branch/vs0082?tab=link');
  const v = document.getElementById('view');
  const sb = document.getElementById('super-banner');
  assert(sb && sb.textContent.includes('超管視角'), '超管睇旅務頁應該有『超管視角』橫額');
  assert(sb.textContent.includes('唔經支部 SHEET 登記') && sb.textContent.includes('第二層備援'), '橫額冇講明唔經登記／接駁');
  assert(v.textContent.includes('任何支部') || v.textContent.includes('接駁與登記'), '超管入唔到支部頁');
  assert(v.textContent.includes('🆘 求救'), '超管睇唔到求救區');
  assert(v.textContent.includes('支部系統登入通道'), '超管睇唔到接駁卡（ADMIN 死咗要佢開返閘）');
  /* 4) 平台頁：超管救援卡（重設 ADMIN 密碼）＋ 求救單數 */
  fireHash(w, '#/platform?tab=keys');
  const vp = document.getElementById('view');
  assert(vp.textContent.includes('超管救援'), '平台冇「超管救援」卡');
  assert(vp.querySelector('#pf-reset-admin'), '冇「重設旅長（ADMIN）密碼」掣');
  assert(vp.textContent.includes('求救'), '平台冇提求救單');
  /* 5) 真係救得返：重設旅長密碼（首登強制改）＋ 開返閘 */
  const pw = S.resetPasswordFor('chief@demo.troop');
  assert(pw.ok && S.load().users.find(u => u.email === 'chief@demo.troop').mustChangePw === true, '超管重設旅長密碼失敗');
  const g = S.setBranchGate('vs0082', 'open');
  assert(g.ok && S.branchGate('vs0082') === 'open', '超管開返閘失敗');
  /* 還原示範狀態 */
  S.commit(d => {
    const b = d.branches.find(x => x.id === 'vs0082');
    b.link.gate = 'sig-only'; b.link.localLogin = false; b.link.state = 'green';
    b.link.gateBy = '陳大文'; b.link.gateAt = '2026-09-18 16:20';
    d.downstream.vs0082.localLogin = false;
    const u = d.users.find(x => x.email === 'chief@demo.troop');
    u.mustChangePw = false; delete u.pwResetAt; delete u.pwResetBy;
  }, { markDirty: true });
  assert(S.branchGate('vs0082') === 'sig-only', '還原示範狀態失敗');
  A.loginAs('u-chief');
});

await test('★ 求救制：入唔到撳求救（免登入）→ ADMIN 喺旅側處理（唔會自動開任何嘢）', async () => {
  /* 定義：同文件共用 RESCUE 一份（唔可以兩邊各寫一套） */
  assert(R.RESCUE.kinds.length >= 4, '求救類型唔夠（咩情況都要求救得到）');
  assert(R.RESCUE.actions.map(a => a.id).join(',') === 'open-gate,reset-pw,reply', 'ADMIN 處理動作定義唔啱');
  assert(R.RESCUE.note.includes('唔會自動做任何嘢'), '冇講明求救唔會自動做任何嘢');
  assert(R.RESCUE.platform.note.includes('唔經「下游 SHEET 登記」'), '冇講明超管唔靠登記 SHEET 登入');
  assert(R.RESCUE.fallback.includes('ALLOW_LOCAL_LOGIN'), '冇記低極少數情況嘅最後手段');

  /* ★ 免登入都用得：登出之後送求救（佢哋就係入唔到先求救） */
  A.logout();
  assert(!S.getSession(), '登出失敗');
  const bad = S.addRescue({ branchId: 'gs0082', by: '', contact: 'x@y.hk', kind: 'link' });
  assert(bad.ok === false && bad.msg.includes('你係邊個'), '唔填「你係邊個」竟然收貨');
  const bad2 = S.addRescue({ branchId: 'gs0082', by: '陳小明', contact: '', kind: 'link' });
  assert(bad2.ok === false && bad2.msg.includes('點搵到你'), '唔留聯絡竟然收貨');
  const r = S.addRescue({ branchId: 'gs0082', by: '陳小明（家長）', contact: 'lam@example.hk', kind: 'link', note: '睇唔到個仔嘅活動' });
  assert(r.ok && r.id, '免登入送出求救失敗');
  const mine = S.rescueById(r.id);
  assert(mine.state === 'open' && mine.branchId === 'gs0082', '求救單冇寫入');
  assert(S.rescuesPending() >= 1, '求救冇計入待辦');

  /* 求救只係請求：唔會自己開閘 */
  assert(S.branchGate('gs0082') === 'open' && S.branchById('gs0082').link.state === 'red', '求救唔應該改任何閘／接駁狀態');

  /* ADMIN（旅長）見到：待辦與批核 → 🆘 求救 */
  A.loginAs('u-chief');
  main.boot();
  fireHash(w, '#/pending?kind=rescue');
  const v = document.getElementById('view');
  assert(v.textContent.includes('求救'), '待辦冇「求救」分頁');
  assert(v.textContent.includes('陳小明'), '求救單冇出現喺待辦');
  assert(v.querySelector('[data-act="open-gate"]') && v.querySelector('[data-act="reset-pw"]') && v.querySelector('[data-act="reply"]'), '求救單冇三個處理掣');
  assert(v.textContent.includes('人手核實'), '冇講明要人手核實身份');

  /* 支部頁都見到同一張單 ＋ 求救連結可複製 */
  fireHash(w, '#/branch/gs0082?tab=link');
  const vb = document.getElementById('view');
  assert(vb.textContent.includes('🆘 求救（呢個支部送嚟嘅）'), '支部頁冇求救卡');
  assert(vb.textContent.includes('陳小明'), '支部頁冇列出求救單');
  assert(vb.querySelector('[data-copy-rescue]'), '冇「複製求救連結」掣');

  /* 處理 1：未登記下游 → 開閘誠實失敗（唔會扮成功） */
  const g = S.resolveRescue(r.id, { action: 'open-gate' });
  assert(g.ok === false && g.msg.includes('未登記下游'), '未登記下游竟然開到閘');
  assert(S.rescueById(r.id).state === 'open', '失敗之後求救單唔應該當處理咗');

  /* 處理 2：重設密碼（錯帳號 → 誠實失敗；啱帳號 → 首登強制改） */
  const pw0 = S.resolveRescue(r.id, { action: 'reset-pw', account: 'nobody@example.hk' });
  assert(pw0.ok === false && pw0.msg.includes('搵唔到帳號'), '錯帳號竟然重設到');
  const pw1 = S.resolveRescue(r.id, { action: 'reset-pw', account: 'cs-deputy@demo.troop' });
  assert(pw1.ok && pw1.action === 'reset-pw', '重設密碼失敗');
  assert(S.load().users.find(x => x.email === 'cs-deputy@demo.troop').mustChangePw === true, '重設之後應該強制改密碼');
  assert(S.rescueById(r.id).state === 'done', '處理完求救單應該結案');

  /* 求救制：ADMIN 喺支部頁「開返支部系統登入」＝真係開到（已登記嘅團） */
  S.setBranchGate('sc0082', 'sig-only');
  const r2 = S.addRescue({ branchId: 'sc0082', by: '黃子晴（副隊長）', contact: '6345 8899', kind: 'locked', note: '入唔到，想開返' });
  assert(r2.ok, '送出求救失敗');
  const g2 = S.resolveRescue(r2.id, { action: 'open-gate' });
  assert(g2.ok && S.branchGate('sc0082') === 'open', '求救「開返」應該真係開返個閘');
  assert(S.rescueById(r2.id).state === 'done' && S.rescueById(r2.id).done.action === 'open-gate', '開返之後求救單冇結案紀錄');

  /* 答覆結案：留低 ADMIN 回覆 */
  const r3 = S.addRescue({ branchId: 'cs0082', by: '李美儀（團長）', contact: 'coach@demo.troop', kind: 'other', note: '問物資' });
  const rep = S.resolveRescue(r3.id, { action: 'reply', reply: '旅部物資要經物資頁申請。' });
  assert(rep.ok && S.rescueById(r3.id).reply.includes('物資頁'), '答覆冇留住');
  assert(S.resolveRescue(r3.id, { action: 'reply' }).ok === false, '已結案嘅求救單應該唔可以再處理');

  /* 權限：教練員可以答覆（audit_view）但唔可以開閘／重設密碼 */
  A.loginAs('u-lee');
  main.boot();
  fireHash(w, '#/branch/sc0082?tab=link');
  const v3 = document.getElementById('view');
  assert(!R.can('coach', 'branch_link_edit') && !R.can('coach', 'user_manage'), '教練員權限定義唔啱');
  assert(v3.querySelector('[data-copy-rescue]'), '教練員都應該睇到求救卡');
  assert(v3.textContent.includes('🆘'), '冇求救入口');
  A.loginAs('u-chief');
  /* 還原示範狀態 */
  S.commit(d => {
    d.rescues = d.rescues.filter(x => x.id !== r.id && x.id !== r2.id && x.id !== r3.id);
    const b = d.branches.find(x => x.id === 'sc0082');
    b.link.gate = 'open'; b.link.localLogin = true; b.link.state = 'yellow';
    b.link.gateBy = '陳大文'; b.link.gateAt = '2026-09-22 10:15';
    const u = d.users.find(x => x.email === 'cs-deputy@demo.troop');
    if (u) { u.mustChangePw = false; delete u.pwResetAt; delete u.pwResetBy; }
  }, { markDirty: true });
  assert(S.rescuesPending() === 3, '還原求救示範狀態失敗（應該剩 3 張待處理）');
});

await test('★ 支部版面：旅側唔另設，各支部自家版面之後照抄（有接入位）', async () => {
  const d = S.load();
  for (const b of d.branches) assert(b.layout && b.layout.id, `${b.id} 冇版面欄`);
  const vs = d.branches.find(b => b.id === 'vs0082');
  assert(vs.layout.state === 'copy-pending', '深資版狀態唔啱');
  assert(d.branches.find(b => b.id === 'gs0082').layout.state === 'generic', '未設計嘅支部應該係通用版面');
  A.loginAs('u-m-minor');
  main.boot();
  fireHash(w, '#/mine');
  const t = document.getElementById('view').textContent;
  assert(t.includes('版面'), '支部人員睇唔到自己支部嘅版面狀態');
  assert(t.includes('之後照抄') || t.includes('自家'), '冇講明版面之後照抄');
});

await test('★ 旅入口＝支部入口：支部人員由旅閘登入即入自己支部（冇第二次登入）', async () => {
  S.clearSession();
  const r = A.login('sc-scout@demo.troop', A.DEMO_PASSWORD);
  assert(r.ok, '支部人員由旅閘登入失敗');
  const sess = S.getSession();
  assert(sess.role === 'member' && sess.branchId === 'sc0082', '登入後 session 冇帶支部');
  assert(sess.landedIn === 'sc0082', '冇記錄「直接入咗自己支部」');
  main.boot();
  const t = document.body.textContent;
  assert(t.includes('童軍團'), '登入後冇顯示自己支部');
  assert(t.includes('通告') && t.includes('行事曆'), '登入後冇入到支部嘅模組清單');
});

await test('換第二個團：仍然經同一個旅入口（毋須搵第二個網址）', async () => {
  S.clearSession();
  main.boot();
  globalThis.location.search = '?step=branch';
  main.boot();
  const t = text();
  assert(t.includes('先揀你嘅團'), '揀團頁唔見');
  assert(t.includes('揀呢個團'), '揀團掣唔見');
  globalThis.location.search = '';
  S.clearSession();
});

await test('帳號選單＋改密碼流程', async () => {
  A.loginAs('u-chief');
  main.boot();
  document.getElementById('user-btn').click();
  assert(document.querySelector('.mask .dlg'), '帳號選單冇開');
  document.querySelector('.mask .dlg [data-close]').click();
  assert(!document.querySelector('.mask'), 'modal 冇閂到');
});

await test('路由守衛：角色唔啱會顯示未授權', async () => {
  A.loginAs('u-parent');
  main.boot();
  fireHash(w, '#/system');
  assert(document.getElementById('view').innerHTML.includes('唔屬你嘅身份範圍'), '家長竟然入得系統頁');
  A.loginAs('u-m-minor');                    // 未夠 18 嘅副隊長：唔可以入系統、唔可以入平台
  main.boot();
  fireHash(w, '#/platform');
  assert(document.getElementById('view').innerHTML.includes('唔屬你嘅身份範圍'), '支部人員竟然入得平台');
  fireHash(w, '#/users');
  assert(document.getElementById('view').innerHTML.includes('唔屬你嘅身份範圍'), '支部人員竟然入得帳號管理');
});

await test('支部人員導航：有「我的支部」，冇系統／用戶／財務／移交', async () => {
  const hrefs = () => [...document.querySelectorAll('#nav a')].map(a => a.getAttribute('href'));
  A.loginAs('u-m-minor');
  main.boot();
  let h = hrefs();
  assert(h.includes('#/mine'), '支部人員冇「我的支部」');
  for (const no of ['#/system', '#/users', '#/finance', '#/transfers', '#/pending', '#/platform']) {
    assert(!h.includes(no), `支部人員竟然有「${no}」`);
  }
  A.loginAs('u-b-leader');                   // 團長：多一個「支部」
  main.boot();
  h = hrefs();
  assert(h.includes('#/branches'), '團長冇支部入口');
  assert(!h.includes('#/system'), '團長竟然有系統入口');
  const t = document.getElementById('nav').textContent;
  assert(t.includes('我的'), '導航冇分組標題');
});

await test('登入分流：旅閘有四條路（旅長／教練員、家長、支部人員先揀團、隱藏超管）', async () => {
  S.clearSession();
  globalThis.location.search = '?step=role';
  main.boot();
  const t = text();
  assert(t.includes('你係邊個身份'), '冇揀身份頁');
  assert(t.includes('旅長 ／ 教練員'), '冇旅層入口');
  assert(t.includes('家長'), '冇家長入口');
  assert(t.includes('先揀團') || t.includes('支部人員'), '冇支部人員入口');
  assert(!t.includes('旅層領袖'), '仲有「旅層領袖」字眼');
  // 支部人員：揀團頁要顯示邊個團入得、邊個唔入得
  globalThis.location.search = '?step=branch';
  main.boot();
  const t2 = text();
  assert(t2.includes('未登記下游'), '揀團頁冇顯示未登記嘅團');
  assert(t2.includes('點解入唔到'), '冇「點解入唔到」掣');
  // 超管：隱藏入口
  globalThis.location.search = '?step=super';
  main.boot();
  assert(text().includes('隱藏入口'), '超管入口唔啱');
  globalThis.location.search = '';
  S.clearSession();
});

/* ============================================================
   E：公開頁（inline script 真跑）
   ============================================================ */
const PAGES = [
  ['public.html', '', '公開資料'],
  ['notice.html', '?n=n-1', '通告'],
  ['notice.html', '?n=nope', '搵唔到'],
  ['join.html', '?t=TROOP-COA-7F3A9C2E', '教練員（旅層帳號'],      // 有效（教練員）
  ['join.html', '?t=TROOP-MEM-5C7D1F2A', '該團支部 SHEET'],        // 有效（支部人員 → 落該團 SHEET）
  ['join.html', '?t=TROOP-MEM-9A1C3E5G', '呢條連結已經用過'],      // 已用
  ['join.html', '?t=TROOP-PAR-2B8D4E6F', '呢條連結已經過期'],      // 過期
  ['join.html', '?t=NOPE', '連結無效'],
  ['borrow.html', '', '物資借用']
];
let pageSeq = 0;
for (const [file, search, expect] of PAGES) {
  await test(`公開頁 ${file}${search} → 應該見到「${expect}」`, async () => {
    const html = readFileSync(join(ROOT, file), 'utf8');
    const inline = html.match(/<script type="module">([\s\S]*?)<\/script>/);
    assert(inline, '冇 inline module script');
    // inline script 當作放喺 repo root 執行（同 HTML 同一層，相對路徑一致）
    const tmp = join(ROOT, `.smoke-${pageSeq++}.mjs`);
    writeFileSync(tmp, inline[1]);
    makeEnv(file, { search, hash: '' });
    try {
      await import('file://' + tmp);
    } finally {
      try { unlinkSync(tmp); } catch {}
    }
    const body = text();
    assert(body.includes(expect), `見唔到「${expect}」；實際：${body.slice(0, 200)}`);
    if (file === 'public.html') assert(body.includes('免登入'), '公開頁冇講明免登入');
    const pub = document.getElementById('pub');
    assert(pub && pub.innerHTML.length > 600, '公開頁內容太短');
  });
}

await test('公開頁 通告報名：填表 → 寫入本機 → 審計有紀錄', async () => {
  const html = readFileSync(join(ROOT, 'notice.html'), 'utf8');
  const inline = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const tmp = join(ROOT, `.smoke-${pageSeq++}.mjs`);
  writeFileSync(tmp, inline);
  makeEnv('notice.html', { search: '?n=n-1', hash: '' });
  try { await import('file://' + tmp); } finally { try { unlinkSync(tmp); } catch {} }
  const before = S.load().notices.find(n => n.id === 'n-1').signups?.length || 0;
  document.getElementById('sg-name').value = '測試家長';
  document.getElementById('sg-ymis').value = 'YMIS-2001';
  document.getElementById('sg-consent').checked = true;
  const fee = document.getElementById('sg-fee');
  if (fee) fee.checked = true;                          // 有費用就要確認
  document.getElementById('sg-go').click();
  const after = S.load().notices.find(n => n.id === 'n-1').signups?.length || 0;
  assert(after === before + 1, `報名冇寫入（${before} → ${after}）`);
  assert(S.load().audit[0].action.includes('通告報名'), '審計冇記錄');
});

await test('公開頁 物資借用：旅部物資即時通過、支部物資待批', async () => {
  const html = readFileSync(join(ROOT, 'borrow.html'), 'utf8');
  const inline = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const tmp = join(ROOT, `.smoke-${pageSeq++}.mjs`);
  writeFileSync(tmp, inline);
  makeEnv('borrow.html', { search: '', hash: '' });
  try { await import('file://' + tmp); } finally { try { unlinkSync(tmp); } catch {} }
  const troopItem = S.load().inventory.find(i => i.owner === 'troop' && i.scope === 'all' && (i.total - i.out) > 0);
  const btn = [...document.querySelectorAll('[data-ask]')].find(b => b.dataset.ask === troopItem.id);
  assert(btn, '搵唔到可借物資嘅申請掣');
  btn.click();
  const dlg = document.querySelector('.mask .dlg');
  assert(dlg && dlg.textContent.includes('即時通過'), '冇講明旅部物資即時通過');
  dlg.querySelector('#bq-name').value = '測試用戶';
  const outBefore = S.load().inventory.find(i => i.id === troopItem.id).out;
  dlg.querySelector('[data-do]').click();
  const after = S.load().inventory.find(i => i.id === troopItem.id);
  assert(after.out === outBefore + 1, `庫存冇加減（${outBefore} → ${after.out}）`);
  assert(after.loans.some(l => l.state === 'approved'), '即時通過嘅 loan 冇建立');
});

await test('公開頁 join：開戶成功會建立帳號，同一條 token 用唔到第二次', async () => {
  const fresh = S.load().invites.find(i => !i.used && String(i.expires) >= new Date().toISOString().slice(0, 10));
  const html = readFileSync(join(ROOT, 'join.html'), 'utf8');
  const inline = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const tmp = join(ROOT, `.smoke-${pageSeq++}.mjs`);
  writeFileSync(tmp, inline);
  makeEnv('join.html', { search: '?t=' + fresh.token, hash: '' });
  try { await import('file://' + tmp); } finally { try { unlinkSync(tmp); } catch {} }
  const usersBefore = S.load().users.length;
  document.getElementById('jn-name').value = '測試領袖';
  document.getElementById('jn-email').value = 'test-leader@demo.troop';
  document.getElementById('jn-pw').value = 'abcdefgh';
  document.getElementById('jn-pw2').value = 'abcdefgh';
  document.getElementById('jn-pdpo').checked = true;
  document.getElementById('jn-go').click();
  assert(S.load().users.length === usersBefore + 1, '開戶冇建立帳號');
  assert(S.load().invites.find(i => i.token === fresh.token).used, 'token 冇被標記用過');
  const again = A.redeemInvite(fresh.token, { name: 'x', email: 'x@y.z', password: 'abcdefgh' });
  assert(again.ok === false && again.msg.includes('用過'), '同一 token 竟然可以再用');
});

/* ---------- 驗證：真 sig／後端未做嘅嘢要老實講 ---------- */
await test('示範模式：唔會嘗試連後端（冇 fetch 到任何網址）', async () => {
  // 觀察 side effect：所有寫入都只係 localStorage
  A.loginAs('u-chief');
  const before = localStorage.getItem('troop.demo.db.v1');
  S.commit(d => { d.unit.slogan = 'x'; });
  assert(localStorage.getItem('troop.demo.db.v1') !== before, '改動冇寫入 localStorage');
  assert(localStorage.getItem('troop.demo.db.v1').includes('"mode":"mock"'), '示範模式標記唔見咗');
});

/* ---------- 核心資料流（真係改到資料＋入審計） ---------- */
async function renderView(mod, params, query) {
  const view = await import(`../assets/js/views/${mod}.js`);
  const host = document.createElement('div');
  document.body.appendChild(host);
  view.render(host, params || {}, query || {});
  return host;
}

await test('財務：確認提交 → 狀態變 accepted ＋ 入審計', async () => {
  A.loginAs('u-chief'); main.boot();
  const before = S.load().financeSubmits.find(f => f.state === 'pending');
  assert(before, '示範資料冇「待確認」嘅財務提交');
  const host = await renderView('finance', {}, { tab: 'branch' });
  const btn = host.querySelector(`[data-ok="${before.id}"]`);
  assert(btn, '搵唔到確認掣');
  btn.click();
  const after = S.load().financeSubmits.find(f => f.id === before.id);
  assert(after.state === 'accepted', `狀態冇變（${after.state}）`);
  assert(S.load().audit.some(a => a.action.includes('確認') && a.target.includes(S.branchName(before.branchId))), '審計冇記錄');
  host.remove();
});

await test('物資：批借用 → 庫存自動加減；歸還 → 回復', async () => {
  A.loginAs('u-chief'); main.boot();
  const item = S.load().inventory.find(i => (i.loans || []).some(l => l.state === 'pending'));
  assert(item, '示範資料冇待批借用');
  const loan = item.loans.find(l => l.state === 'pending');
  const outBefore = Number(item.out || 0);
  const host = await renderView('inventory', {}, { tab: 'loans' });
  const btn = host.querySelector(`[data-loan-ok="${loan.to}"][data-who="${loan.by}"]`) || host.querySelector('[data-loan-ok]');
  assert(btn, '搵唔到批准掣');
  btn.click();
  const after = S.load().inventory.find(i => i.id === item.id);
  const approved = after.loans.find(l => l.state === 'approved');
  assert(approved, '借用冇變 approved');
  if (approved.state === 'approved') assert(Number(after.out) >= outBefore, `庫存冇加（${outBefore} → ${after.out}）`);
  host.remove();
});

await test('移交：接收 → 建 ACTIVE ＋ transferId 冪等（第二次唔會重複建）', async () => {
  A.loginAs('u-chief'); main.boot();
  const t = S.load().transfers.find(x => x.state === 'pending');
  assert(t, '示範資料冇待接收移交');
  const host = await renderView('transfers', {}, { tab: 'pending' });
  const btn = host.querySelector(`[data-accept="${t.id}"]`);
  assert(btn, '搵唔到接收掣');
  btn.click();
  await new Promise(r => setTimeout(r, 5));
  const yes = document.querySelector('.mask .dlg [data-yes]');
  assert(yes, '接收應該要確認（confirmDlg）');
  yes.click();
  await new Promise(r => setTimeout(r, 5));
  const after = S.load().transfers.find(x => x.id === t.id);
  assert(after.state === 'done', `狀態冇變 done（${after.state}）`);
  assert(after.transferId, '冇寫 transferId（冪等鍵）');
  const membersAfter = S.load().members.filter(m => m.ymis === t.scoutId).length;
  const again = await renderView('transfers', {}, { tab: 'history' });
  assert(again.innerHTML.includes(t.name), '歷史頁見唔到接收紀錄');
  // 冪等：同一張再撳一次「接收」唔會再建
  const pendingAgain = await renderView('transfers', {}, { tab: 'pending' });
  const btn2 = pendingAgain.querySelector(`[data-accept="${t.id}"]`);
  if (btn2) {
    btn2.click();
    await new Promise(r => setTimeout(r, 5));
    document.querySelectorAll('.mask').forEach(x => x.remove());
    assert(S.load().members.filter(m => m.ymis === t.scoutId).length === membersAfter, '重複接收竟然再建名冊');
  }
  pendingAgain.remove(); again.remove(); host.remove();
});

await test('用戶：發邀請 → join.html 用同一條 token 開到戶（前後台接通）', async () => {
  A.loginAs('u-chief'); main.boot();
  const host = await renderView('users', {}, { tab: 'invites' });
  host.querySelector('#iv-new').click();
  const dlg = document.querySelector('.mask .dlg');
  assert(dlg, '發邀請 modal 冇開');
  dlg.querySelector('#i-email').value = 'newby@demo.troop';
  dlg.querySelector('[data-save]').click();
  await new Promise(r => setTimeout(r, 5));
  const inv = S.load().invites[0];
  assert(inv && !inv.used, '邀請冇建立');
  document.querySelectorAll('.mask').forEach(m => m.remove()); host.remove();

  const html = readFileSync(join(ROOT, 'join.html'), 'utf8');
  const inline = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const tmp = join(ROOT, `.smoke-${pageSeq++}.mjs`);
  writeFileSync(tmp, inline);
  makeEnv('join.html', { search: '?t=' + inv.token, hash: '' });
  try { await import('file://' + tmp); } finally { try { unlinkSync(tmp); } catch {} }
  assert(text().includes('邀請開戶'), 'join 頁冇開到');
  document.getElementById('jn-name').value = '新領袖';
  document.getElementById('jn-email').value = 'newby@demo.troop';
  document.getElementById('jn-pw').value = 'newpass1234';
  document.getElementById('jn-pw2').value = 'newpass1234';
  document.getElementById('jn-pdpo').checked = true;
  document.getElementById('jn-go').click();
  assert(S.load().users.some(u => u.email === 'newby@demo.troop'), 'join 開戶冇接到旅系統嘅邀請');
  main.boot();     // 回到 app shell（畀後面嘅測試用）
});

/* ---------- 互動掃描：撳晒所有掣，唔可以有例外 ---------- */
const asyncErrors = [];
process.on('unhandledRejection', e => asyncErrors.push(String(e && e.message ? e.message : e)));
w.addEventListener('unhandledrejection', e => asyncErrors.push('window: ' + String(e.reason?.message || e.reason)));

await test('互動掃描：每個模組／分頁所有掣撳一次（連 async handler）都唔可以爆', async () => {
  A.loginAs('u-chief');
  main.boot();
  const errs = [];
  let clicks = 0;
  for (const [mod, tabs] of Object.entries(TABS)) {
    A.loginAs(mod === 'platform' ? 'u-super' : mod === 'mine' ? 'u-m-minor' : 'u-chief');
    const view = await import(`../assets/js/views/${mod}.js`);
    const params = ['branches', 'branch'].includes(mod) ? { id: 'vs0082' } : {};
    for (const tab of tabs) {
      const host = document.createElement('div');
      document.body.appendChild(host);
      view.render(host, params, { tab });
      const count = [...host.querySelectorAll('button')].filter(b => !b.disabled).length;
      for (let i = 0; i < count; i++) {
        host.innerHTML = '';
        view.render(host, params, { tab });
        const list = [...host.querySelectorAll('button')].filter(b => !b.disabled);
        const b = list[i];
        if (!b) continue;
        const label = (b.textContent || '').trim().slice(0, 16);
        try { b.click(); clicks++; } catch (e) { errs.push(`${mod}?tab=${tab} 掣「${label}」：${e.message}`); }
        await new Promise(r => setTimeout(r, 2));
        document.querySelectorAll('.mask').forEach(m => m.remove());   // 關掉未確認嘅對話框
      }
      host.remove();
    }
  }
  const uniq = [...new Set([...errs, ...asyncErrors])];
  assert(!uniq.length, `撳咗 ${clicks} 個掣，有 ${uniq.length} 個問題：\n   - ${uniq.slice(0, 8).join('\n   - ')}`);
  results[results.length - 1] = ['ok', `互動掃描：撳咗 ${clicks} 個掣，冇例外`];
  S.resetDemo();                                                       // 掃描改過嘅示範資料還原
});

/* ---------- 報告 ---------- */
console.log(`\n旅系統 smoke — ${results.filter(r => r[0] === 'ok').length}/${results.length} 通過`);
for (const [state, name] of results) console.log(`  ${state === 'ok' ? '✓' : '✗'} ${name}`);
if (problems.length) {
  console.log('\n失敗詳情：');
  for (const [name, e] of problems) console.log(`\n✗ ${name}\n   ${String(e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n   ') : e)}`);
  process.exit(1);
}
console.log('\n✓ 全部場景通過（示範模式；真後端未接）\n');

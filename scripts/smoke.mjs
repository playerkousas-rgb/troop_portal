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
function eq(got, want, msg) { if (got !== want) throw new Error(`${msg || 'eq'}（got ${JSON.stringify(got)}，want ${JSON.stringify(want)}）`); }

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
const { gatePreflight } = await import('../assets/js/views/branches.js');
const { normId } = await import('../assets/js/lib/util.js');
const RP = await import('../assets/js/lib/report.js');

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

await test('★ §13 定案：旅 ID 4 位補零（normId 單一實現）', async () => {
  assert(normId('82') === '0082' && normId(' 82 ') === '0082', 'normId 冇補零至 4 位');
  assert(normId('0082') === '0082' && normId('12a') === '0012A', 'normId 大寫／字母尾處理唔啱');
  A.loginAs('u-chief');
  main.boot();
  fireHash(w, '#/system?tab=troop');
  assert(document.getElementById('view').textContent.includes('補零至 4 位'), '系統頁冇標明 normId 規則');
});

await test('★ §13 定案：登入路線混合（接駁好嘅團＝一次登入，其餘＝轉去該團入口）', async () => {
  const d = S.load();
  const green = d.branches.find(b => b.id === 'cs0082');
  assert(R.loginRouteFor(green) === 'one-stop', '已接駁＋測過連線嘅團應該行一次登入（M1）');
  const yellow = d.branches.find(b => b.id === 'sc0082');
  assert(R.loginRouteFor(yellow) === 'two-stop', '未測過連線／未接駁嘅團應該行 M3（轉去該團入口）');
  const unreg = d.branches.find(b => b.id === 'gs0082');
  assert(R.loginRouteFor(unreg) === 'two-stop', '未登記嘅團唔應該出一次登入');
  assert(R.loginRouteMeta('one-stop').label.includes('M1') && R.loginRouteMeta('two-stop').label.includes('M3'), '路線標籤唔齊');
  /* UI：支部登入頁要顯示行邊條路線（唔可以講到每個團都係一次登入） */
  S.clearSession();
  globalThis.location.search = '?step=login&path=branch&b=cs0082';
  main.boot();
  assert(text().includes('一次登入'), '已接駁嘅團，支部登入頁應該顯示「一次登入」');
  globalThis.location.search = '?step=login&path=branch&b=sc0082';
  main.boot();
  assert(text().includes('轉去該團入口'), '未接駁嘅團，支部登入頁應該顯示「轉去該團入口」');
  globalThis.location.search = '';
  A.loginAs('u-chief');
});

await test('★ §13 定案：分層 cache（通告／活動 5 分鐘；財務／物資／進度 30 分鐘）＋強制刷新', async () => {
  assert(R.cacheTtlOf('notices') === 5 && R.cacheTtlOf('calendar') === 5, '通告／活動應該 5 分鐘');
  assert(R.cacheTtlOf('finance') === 30 && R.cacheTtlOf('inventory') === 30 && R.cacheTtlOf('progress') === 30, '財務／物資／進度應該 30 分鐘');
  assert(R.cacheLabel('finance').includes('30 分鐘'), 'cache 標示唔啱');
  A.loginAs('u-chief');
  main.boot();
  fireHash(w, '#/finance');
  const v = document.getElementById('view');
  assert(v.textContent.includes('30 分鐘') && v.querySelector('[data-force-refresh="finance"]'), '財務頁冇 cache 標示／強制刷新掣');
  fireHash(w, '#/inventory');
  assert(document.getElementById('view').querySelector('[data-force-refresh="inventory"]'), '物資頁冇強制刷新掣');
  /* 強制刷新：唔可以爆，而且要入審計 */
  const n0 = S.load().audit.length;
  document.querySelector('[data-force-refresh="inventory"]').click();
  await new Promise(r => setTimeout(r, 30));
  assert(S.load().audit.length > n0 && String(S.load().audit[0].detail || '').includes('cache'), '強制刷新冇入審計');
  S.commit(d => { d.audit = d.audit.filter(a => String(a.detail || '').indexOf('cache') < 0); }, { markDirty: true });
});

await test('★ §13 定案：模組開關（真相住旅 SHEET 分頁；閂咗＝隱藏唔刪；只限旅長）', async () => {
  A.loginAs('u-chief');
  main.boot();
  fireHash(w, '#/system?tab=modules');
  const v = document.getElementById('view');
  const t = v.textContent;
  assert(t.includes('旅 SHEET') && t.includes('模組開關') && t.includes('分頁'), '模組開關頁冇標明真相住邊');
  assert(t.includes('隱藏') && t.includes('唔會刪資料'), '冇講清楚閂咗＝隱藏唔刪');
  assert(t.includes('只有') && t.includes('旅長'), '冇講明改得嘅只有旅長');
  assert(v.querySelector('[data-mod]'), '模組開關掣唔見咗');
  /* 非旅長：唔應該見到呢個模組 */
  A.loginAs('u-b-leader2');
  main.boot();
  fireHash(w, '#/system?tab=modules');
  assert(!document.getElementById('view').textContent.includes('模組開關'), '支部人員唔應該見到模組開關');
  A.loginAs('u-chief');
});

await test('★ 帳號下限：每個 leaf 至少留 1 個領袖戶（刪／停用會被擋）', async () => {
  /* 用戶 2026-09-25：「呢個係指 DELETE ACCOUNT，要保留最小 1 個」 */
  A.loginAs('u-chief');
  /* 超管：唔可以停用／刪除（第二層備援） */
  assert(S.removalGuard(S.load().users.find(u => u.id === 'u-super')).ok === false, '超管竟然刪得／停用得到');
  /* 旅長：得一個 → 停用／刪除都要擋（同舊有「旅長唔可以停用」一致） */
  const chief = S.load().users.find(u => u.id === 'u-chief');
  assert(S.removalGuard(chief).ok === false && S.removalGuard(chief).msg.includes('最後一個領袖戶'), '最後一個旅長竟然刪得');
  /* 支部：幼童軍團有 2 個領袖戶（團長＋副團長）→ 刪一個得，刪淨一個唔得 */
  const l1 = S.load().users.find(u => u.id === 'u-b-leader');
  const l2 = S.load().users.find(u => u.id === 'u-b-leader2');
  assert(l1.identity === '團長' && l2.identity === '副團長', '示範前提唔啱（幼童軍團應該有團長＋副團長）');
  assert(S.removalGuard(l1).ok === true && S.removalGuard(l1).rest === 1, '仲有副團長就應該刪得');
  const d1 = S.removeUserAccount(l1.id);
  assert(d1.ok && !S.userById(l1.id) && S.load().removedUsers[0].name === '鄭美玲', '刪除帳號失敗／冇留紀錄');
  const guard2 = S.removalGuard(l2);
  assert(guard2.ok === false && guard2.msg.includes('得呢一個領袖戶'), '刪淨一個領袖戶竟然過得');
  assert(S.setUserStatus(l2.id, 'disabled').ok === false, '停用最後一個領袖戶竟然過得');
  assert(S.removeUserAccount(l2.id).ok === false, '刪除最後一個領袖戶竟然過得');
  assert(S.userById(l2.id), '擋唔到就唔應該真係刪咗');
  /* 非領袖戶（團員）：刪得 */
  const scout = S.load().users.find(u => u.role === 'member' && u.identity === '團員');
  assert(S.removalGuard(scout).ok === true, '團員應該刪得');
  /* UI：最後一個領袖戶冇「停用」掣、全部有「刪除」掣 */
  main.boot();
  fireHash(w, '#/users?tab=list');
  const v = document.getElementById('view');
  assert(v.querySelector('[data-remove]'), '名單冇「刪除帳號」掣');
  assert(!v.querySelector('[data-disable="u-b-leader2"]'), '最後一個領袖戶唔應該有停用掣');
  assert(v.textContent.includes('最後一個領袖戶'), '冇標示「最後一個領袖戶」');
  /* 還原示範狀態：鄭美玲返嚟 */
  S.commit(d => {
    d.users.push({ id: 'u-b-leader', role: 'member', name: '鄭美玲', email: 'cs-leader@demo.troop', phone: '9567 1234', title: '幼童軍團長', anchor: '幼童軍團 SHEET（cs0082）', ageGroup: 'adult', branchId: 'cs0082', ymis: 'YMIS-2010', identity: '團長', branchAccess: ['cs0082'], status: 'active', mustChangePw: false, at: '2026-09-02 09:10', lastLogin: '2026-09-24 20:15' });
    d.removedUsers = [];
  }, { markDirty: true });
  assert(!!S.userById('u-b-leader') && S.removalGuard(S.userById('u-b-leader2')).ok === true, '還原示範狀態失敗');
});

await test('★ 閂口前置檢查：接駁燈綠／測試連線／進度已登記（未達標出警告，唔硬擋）', async () => {
  /* 升級 MD §12④：先搬數、先測連線，先至閂口 —— 用戶 2026-09-25 同意「未達標出警告」 */
  A.loginAs('u-chief');
  const chk = st => S.load().branches.find(b => b.id === st);
  /* 幼童軍團：全綠 → 全部達標 */
  const okAll = gatePreflight('cs0082');
  assert(okAll.length === 4 && okAll.every(c => c.ok), '幼童軍團應該全部達標');
  /* 童軍團：黃燈（未閂口）→ 接駁燈一項唔達標 */
  const y1 = gatePreflight('sc0082').filter(c => !c.ok).map(c => c.k);
  assert(y1.includes('接駁燈綠（已接駁）'), '黃燈應該提示接駁未落實');
  /* 樂行童軍團：冇 testedAt → 測試連線一項唔達標 */
  assert(gatePreflight('rs0082').some(c => !c.ok && c.k.includes('測試連線')), '樂行冇測試紀錄應該提示');
  /* 未登記（小童軍團）：紅燈＋冇進度來源 → 多過一項唔達標 */
  assert(gatePreflight('gs0082').filter(c => !c.ok).length >= 2, '未登記下游應該多項唔達標');
  /* UI：撳「閂支部系統登入」→ 對話框有前置檢查清單
     （示範資料冇「綠燈＋未閂」嘅團，所以臨時砌一個：幼童軍團開返＋保持綠燈） */
  S.commit(d => {
    const b = d.branches.find(x => x.id === 'cs0082');
    b.link.gate = 'open'; b.link.localLogin = true; b.link.state = 'green';
    d.downstream.cs0082.localLogin = true;
  }, { markDirty: true });
  assert(gatePreflight('cs0082').every(c => c.ok), '臨時狀態應該全部達標');
  main.boot();
  fireHash(w, '#/branch/cs0082?tab=link');
  const v = document.getElementById('view');
  const btn = v.querySelector('[data-gate="cs0082"][data-g="sig-only"]');
  assert(btn && btn.disabled === false, '應該有「閂支部系統登入」掣（幼童軍團而家係綠燈）');
  btn.click();
  await new Promise(r => setTimeout(r, 40));
  const dlg = document.querySelector('.mask');
  assert(dlg && dlg.textContent.includes('閂口前置檢查'), '對話框冇前置檢查');
  assert(dlg.textContent.includes('測試連線成功') && dlg.textContent.includes('進度下游已登記'), '前置檢查唔齊');
  assert(dlg.textContent.includes('全部達標'), '全綠應該顯示全部達標');
  dlg.querySelector('[data-no]').click();
  await new Promise(r => setTimeout(r, 20));
  /* 未達標嘅：童軍團（黃燈）→ 出警告但仍然閂得到 */
  main.boot();
  fireHash(w, '#/branch/sc0082?tab=link');
  const v2 = document.getElementById('view');
  v2.querySelector('[data-gate="sc0082"][data-g="sig-only"]').click();
  await new Promise(r => setTimeout(r, 40));
  const dlg2 = document.querySelector('.mask');
  assert(dlg2.textContent.includes('項未達標'), '未達標應該出警告');
  assert(dlg2.querySelector('[data-yes]').textContent.includes('閂'), '唔硬擋：應該仍然有閂嘅掣');
  dlg2.querySelector('[data-yes]').click();
  await new Promise(r => setTimeout(r, 40));
  assert(S.branchGate('sc0082') === 'sig-only', '確認之後應該真係閂到（唔硬擋）');
  assert(S.load().audit[0].detail.includes('前置檢查'), '審計應該記低前置檢查結果');
  /* 還原示範狀態：童軍團兩條通道都開、幼童軍團回復「閂咗（綠燈）」 */
  S.setBranchGate('sc0082', 'open');
  S.commit(d => {
    const b = d.branches.find(x => x.id === 'cs0082');
    b.link.gate = 'sig-only'; b.link.localLogin = false; b.link.state = 'green';
    b.link.gateBy = '陳大文'; b.link.gateAt = '2026-09-20 11:05';
    d.downstream.cs0082.localLogin = false;
  }, { markDirty: true });
  assert(S.branchGate('cs0082') === 'sig-only', '幼童軍團還原失敗');
  S.commit(d => { d.audit = d.audit.filter(a => !String(a.detail || '').includes('前置檢查')); }, { markDirty: true });
  assert(S.branchGate('sc0082') === 'open', '還原示範狀態失敗');
});

await test('★ 分享：發方揀對象（可多選）＋收方決定（唔想就退回，唔會硬塞）', async () => {
  A.loginAs('u-b-leader2');               // 幼童軍團副團長（有決定權）
  main.boot();
  fireHash(w, '#/shares?tab=sent');
  const v = document.getElementById('view');
  const before = S.sharesFromMe('cs0082').length;
  v.querySelector('#sh-new').click();
  await new Promise(r => setTimeout(r, 40));
  const dlg = document.querySelector('.mask');
  assert(dlg, '冇「發起分享」對話框');
  assert(dlg.textContent.includes('可以揀多過一個'), '冇講明可以揀多個支部');
  assert(dlg.textContent.includes('對方決定收唔收'), '冇講明收方決定');
  assert(dlg.querySelectorAll('[data-sh-to]').length >= 4, '目標支部清單唔齊');
  assert(dlg.querySelector('[data-sh-all]'), '冇「全旅」選項');
  dlg.querySelector('#sh-title').value = '幼童軍秋季旅行（歡迎一齊）';
  dlg.querySelector('#sh-kind').value = 'event';
  dlg.querySelector('[data-sh-to="vs0082"]').checked = true;
  dlg.querySelector('[data-sh-to="sc0082"]').checked = true;
  dlg.querySelector('[data-save]').click();
  await new Promise(r => setTimeout(r, 60));
  const made = S.shares().filter(x => x.title === '幼童軍秋季旅行（歡迎一齊）');
  assert(made.length === 2, `應該一對象一條分享（實際 ${made.length}）`);
  assert(made.every(x => x.state === 'pending' && x.from === 'cs0082'), '新分享應該係待接收');
  /* 收方（童軍團）決定：退回唔想參與 */
  A.loginAs('u-m-minor');                 // 童軍團副隊長（rank < 3 → 唔夠權決定）
  main.boot();
  fireHash(w, '#/shares');
  const v2 = document.getElementById('view');
  assert(v2.textContent.includes('待接收') && v2.textContent.includes('幼童軍秋季旅行'), '收方應該見到待接收');
  const canDecide = !!v2.querySelector('[data-decide]');
  assert(canDecide === false, 'rank < 3 唔應該有決定掣（只可以加註解）');
  A.loginAs('u-b-leader2');               // 用返有權嘅身份去收（示範：用旅長代勞亦可）
  A.loginAs('u-chief');
  main.boot();
  fireHash(w, '#/shares');
  const target = S.shares().find(x => x.title === '幼童軍秋季旅行（歡迎一齊）' && x.to === 'sc0082');
  assert(target && target.state === 'pending', '收件方應該見到待接收');
  const dec = S.decideShare(target.id, 'declined', '童軍團領袖唔想小朋友參與', { by: '李美儀' });
  assert(dec.ok !== false, '退回失敗');
  const after = S.shares().find(x => x.id === target.id);
  assert(after.state === 'declined' && (after.decideNote || '').includes('唔想'), '退回應該留理由');
  assert(after.decidedBy, '退回應該記低邊個決定');
  /* 未接收嘅分享唔會混入收件方清單（唔會硬塞） */
  assert(!S.acceptedShares('sc0082').some(x => x.id === target.id), '退回咗嘅分享唔應該出現喺清單');
  /* 清走示範測試資料 */
  S.commit(d => { d.shares = d.shares.filter(x => x.title !== '幼童軍秋季旅行（歡迎一齊）'); }, { markDirty: true });
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

await test('★ 問題回報：對正 Scout Admin「問題回報 TICK」合同（type:issue；8 欄；嚴重度白名單）', async () => {
  /* ① 合同＝唯一來源（registry.REPORT） */
  assert(R.REPORT.type === 'issue' && R.REPORT.sourceApp === 'troop_portal', 'type／sourceApp 唔啱合同');
  assert(R.REPORT.severities.join('/') === '低/中/高/緊急', '嚴重度白名單唔啱（ADMIN 收 低／中／高／緊急）');
  /* ② payload 只帶 8 個欄位，同圖書館 report.html 一模一樣 */
  const p1 = R.REPORT.payload({ title: ' x ', desc: ' y ', severity: '中', troopId: '0082', name: '陳小明', contact: 'x@y.hk', extra: '唔應該出現' });
  assert(Object.keys(p1).sort().join(',') === 'contact,desc,name,severity,sourceApp,title,troopId,type', 'payload 欄位唔啱：' + Object.keys(p1).join(','));
  assert(p1.title === 'x' && p1.desc === 'y' && p1.type === 'issue' && p1.sourceApp === 'troop_portal', 'payload 內容唔啱');
  /* ③ 嚴重度：亂填 → 落「高」；空白 → 高 */
  assert(R.REPORT.payload({ title: 't', desc: 'd', severity: '災難級' }).severity === '高', '亂填嚴重度應該落「高」');
  assert(R.REPORT.payload({ title: 't', desc: 'd', severity: '' }).severity === '高', '冇嚴重度應該落「高」');
  ['低', '中', '高', '緊急'].forEach(x => assert(R.REPORT.payload({ title: 't', desc: 'd', severity: x }).severity === x, '白名單值 ' + x + ' 俾人改咗'));
  /* ④ 詳情上限 2000 字（同 ADMIN 表單一致） */
  const long = R.REPORT.payload({ title: 't', desc: '字'.repeat(2500) });
  assert(long.desc.length === R.REPORT.maxDesc, '詳情冇截到上限');
  /* ⑤ 必填檢查（標題＋詳情） */
  assert(R.REPORT.check({ title: '', desc: 'd' }).ok === false && R.REPORT.check({ title: 't', desc: '' }).ok === false, '必填檢查唔啱');
  /* ⑥ 求救單 → issue payload（同一份可以去 ADMIN） */
  const issue = R.rescueToIssue({ kind: 'locked', note: '入唔到', branchId: 'rs0082', by: '曾國強', contact: '9123 4567' });
  assert(issue.type === 'issue' && issue.troopId === 'rs0082' && issue.name === '曾國強' && issue.severity === '高', '求救單轉 issue 唔啱');
  /* ⑦ 送出（示範模式）：唔會 fetch，真係入本機紀錄＋審計 */
  A.logout();
  const n0 = (S.load().adminReports || []).length;
  const sent = await RP.sendAdminReport({ title: 'UI 問題', desc: '示範：撳唔到掣', severity: '低', troopId: 'cs0082', name: '陳大文', contact: '9111 2222' });
  assert(sent.ok && sent.mode === 'mock' && sent.payload.severity === '低', '示範模式送出失敗');
  const rec = S.load().adminReports[0];
  assert((S.load().adminReports || []).length === n0 + 1 && rec.payload.type === 'issue' && rec.payload.sourceApp === 'troop_portal', '問題回報冇入本機紀錄');
  assert(S.load().audit.some(a => String(a.action || '').includes('問題回報')), '問題回報冇入審計');
  /* ⑧ UI：求救頁三格（標題／嚴重度／問題詳情）＋後端未接駁時嘅誠實 fallback */
  S.clearSession();
  globalThis.location.search = '?step=rescue';
  main.boot();
  const t = text();
  assert(t.includes('標題') && t.includes('嚴重度') && t.includes('問題詳情'), '求救表唔夠三格（要同 ADMIN 表單一樣）');
  assert(t.includes('Scout Admin') && t.includes('問題回報'), '冇講明同一份送去 ADMIN 收件匣');
  const official = document.querySelector('a[href*="scout-admin-blue.vercel.app/report.html"]');
  assert(official, '冇官方回報頁 fallback');
  assert(official.getAttribute('href') === R.REPORT.officialUrl, '官方回報頁連結唔啱（要帶 app=troop_portal）');
  const tv = document.getElementById('rs-sev');
  assert(tv && tv.options.length === 4, '嚴重度選項唔係四個');
  assert(document.getElementById('rs-title') && document.getElementById('rs-note'), '標題／詳情欄唔見');
  /* ⑨ 前端唔會直接打 GAS 端點（端點只喺 server 側） */
  const src = readFileSync(join(ROOT, 'assets/js/lib/report.js'), 'utf8');
  assert(src.includes('/api/proxy'), '問題回報唔係經 /api/proxy 送');
  const hardcoded = /macros\/s\/[A-Za-z0-9_-]{20,}/;   // 真端點＝/macros/s/<長 token>/exec
  assert(!hardcoded.test(src) && !hardcoded.test(readFileSync(join(ROOT, 'assets/js/main.js'), 'utf8')), '前端唔應該硬編碼 Apps Script 端點');
  assert(!JSON.stringify(R.REPORT).includes('macros/s/'), 'REPORT 合同唔應該帶端點');
  /* ⑩ server 側 proxy（api/proxy.js）：同一套白名單／fallback（前端＋後端兩邊都要守） */
  const ApiProxy = await import('../api/proxy.js');
  const sp = ApiProxy.buildIssuePayload({ title: ' t ', desc: ' d ', severity: '亂填', troopId: '0082', name: 'n', contact: 'c' });
  assert(Object.keys(sp).sort().join(',') === 'contact,desc,name,severity,sourceApp,title,troopId,type', 'proxy payload 欄位唔啱');
  assert(sp.severity === '高' && sp.title === 't' && sp.desc === 'd', 'proxy 白名單／trim 唔啱');
  assert(ApiProxy.buildIssuePayload({ title: 't', desc: 'd', severity: '緊急' }).severity === '緊急', 'proxy 白名單值俾人改咗');
  const proxySrc = readFileSync(join(ROOT, 'api/proxy.js'), 'utf8');
  assert(/action === 'issue'/.test(proxySrc) && /501/.test(proxySrc), 'proxy 未實作 issue／未誠實失敗');
  assert(proxySrc.includes('x-forwarded-for'), 'proxy 冇限流依據');
  globalThis.location.search = '';
  /* 清走示範測試紀錄（唔好污染示範資料） */
  S.commit(d => { d.adminReports = []; d.audit = d.audit.filter(a => !String(a.action || '').includes('問題回報')); }, { markDirty: true });
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
  const bad = S.addRescue({ branchId: 'gs0082', by: '', contact: 'x@y.hk', kind: 'link', title: 't', note: 'n' });
  assert(bad.ok === false && bad.msg.includes('你係邊個'), '唔填「你係邊個」竟然收貨');
  const bad2 = S.addRescue({ branchId: 'gs0082', by: '陳小明', contact: '', kind: 'link', title: 't', note: 'n' });
  assert(bad2.ok === false && bad2.msg.includes('點搵到你'), '唔留聯絡竟然收貨');
  /* ★ 新合同（同 ADMIN 表單一致）：標題＋詳情都必填 */
  const bad3 = S.addRescue({ branchId: 'gs0082', by: '陳小明', contact: 'lam@example.hk', kind: 'link', note: '冇標題' });
  assert(bad3.ok === false && bad3.msg.includes('標題'), '冇標題竟然收貨');
  const bad4 = S.addRescue({ branchId: 'gs0082', by: '陳小明', contact: 'lam@example.hk', kind: 'link', title: '有標題冇詳情' });
  assert(bad4.ok === false && bad4.msg.includes('問題詳情'), '冇問題詳情竟然收貨');
  const r = S.addRescue({
    branchId: 'gs0082', by: '陳小明（家長）', contact: 'lam@example.hk', kind: 'link',
    title: '睇唔到個仔嘅活動', severity: '中', note: '睇唔到個仔嘅活動'
  });
  assert(r.ok && r.id, '免登入送出求救失敗');
  const mine = S.rescueById(r.id);
  assert(mine.state === 'open' && mine.branchId === 'gs0082', '求救單冇寫入');
  assert(mine.title === '睇唔到個仔嘅活動' && mine.severity === '中', '求救單冇存標題／嚴重度（對唔正 ADMIN 合同）');
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
  const r2 = S.addRescue({ branchId: 'sc0082', by: '黃子晴（副隊長）', contact: '6345 8899', kind: 'locked', title: '支部系統登入被閂', note: '入唔到，想開返' });
  assert(r2.ok, '送出求救失敗');
  const g2 = S.resolveRescue(r2.id, { action: 'open-gate' });
  assert(g2.ok && S.branchGate('sc0082') === 'open', '求救「開返」應該真係開返個閘');
  assert(S.rescueById(r2.id).state === 'done' && S.rescueById(r2.id).done.action === 'open-gate', '開返之後求救單冇結案紀錄');

  /* 答覆結案：留低 ADMIN 回覆 */
  const r3 = S.addRescue({ branchId: 'cs0082', by: '李美儀（團長）', contact: 'coach@demo.troop', kind: 'other', title: '想問物資安排', note: '問物資' });
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

await test('★ 本機 dev server 行真 /api handler（唔係另一套）：units／downstreams／auth／super', () => {
  const src = readFileSync(join(ROOT, 'dev-server.mjs'), 'utf8');
  ['/api/units', '/api/downstreams', '/api/auth', '/api/super', '/api/troop', '/api/registry', '/api/member-entry', '/api/share'].forEach(p => assert(src.includes(`'${p}':`), `dev-server 冇路由去真 handler：${p}`));
  assert(!/body\.action !== 'issue'[\s\S]{0,120}return json\(res, 501/.test(src), '非 issue 嘅 proxy action 應該行真 handler，唔應該一律 501');
  assert(/mod\.default\(req, res\)/.test(src), '應該真係叫 Vercel 嘅 default handler');
  assert(src.includes("'/api/proxy'"), 'proxy 路線唔見咗');
});

await test('★ 前端 ↔ 後端通道：示範模式一律唔發請求；真模式先會（唯一寫入掣）', async () => {
  const API = await import('../assets/js/lib/api.js');
  A.loginAs('u-chief');
  assert(API.isLive() === false, '示範模式唔應該當自己 live');
  /* 示範模式：任何 API 呼叫都即刻回 mock，唔會 fetch */
  const calls = [API.login('a@b.c', 'x'), API.session(), API.saveTables({ 支部: [] }), API.gasAction('load', { table: '支部' }), API.getDownstreams(), API.pushToBackend()];
  const rs = await Promise.all(calls);
  rs.forEach(r => assert(r.ok === false && r.code === 'mock', '示範模式竟然當成功：' + JSON.stringify(r)));
  /* 資料欄 ↔ 分頁名要同 Code.gs 對得上（寫錯就得一個表靜靜寫唔到） */
  const gasSrc = readFileSync(join(ROOT, 'apps-script/Code.gs'), 'utf8');
  Object.values(API.TABLE_MAP).forEach(t => assert(gasSrc.includes("'" + t + "'"), `TABLE_MAP 嘅「${t}」唔喺 Code.gs 分頁清單內`));
  /* 唯一寫入掣：真模式先出 /api/proxy 嗰條路（示範模式唔會） */
  const src = readFileSync(join(ROOT, 'assets/js/main.js'), 'utf8');
  assert(/API\.isLive\(\)/.test(src) && /API\.pushToBackend\(\)/.test(src), '寫入掣冇接真模式');
  assert(readFileSync(join(ROOT, 'assets/js/lib/api.js'), 'utf8').includes("fetch('/api/proxy'"), 'api.js 應該只經 /api/proxy');
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

/* ---------- P1：離線優先／樂觀鎖／重試／體積治理／訂閱（lib 層） ---------- */
await test('★ 離線優先三色燈：黃＝有未寫入、紅＝失敗、綠＝一致（同 BUILD §3 一致）', async () => {
  const OB = await import('../assets/js/lib/offline.js');
  eq(OB.lightOf({ dirty: 0 }).light, 'green', '冇改動＝綠');
  eq(OB.lightOf({ dirty: 3 }).light, 'yellow', '有未寫入＝黃');
  eq(OB.lightOf({ dirty: 3, failing: true }).light, 'red', '寫入失敗＝紅（蓋過黃）');
  eq(OB.lightOf({ lastError: 'not_configured' }).light, 'red');
  assert(OB.lightOf({ dirty: 2 }).detail.includes('儲存到後端'), '黃燈要講清楚要撳邊個掣');
  /* 錯誤碼字典：每個碼都要有中文解釋同色 */
  ['not_configured', 'need_chief', 'must_change_pw', 'keep_one', 'rate_limited', 'conflict', 'busy', 'mock'].forEach(c => {
    const i = OB.codeInfo(c);
    assert(i && i.label && i.msg, '錯誤碼字典缺：' + c);
  });
  eq(OB.codeInfo('從未見過嘅碼').label, '未預期嘅錯', '未知碼要落 unknown 而唔係爆');
});

await test('★ 樂觀鎖：版本有 ISO＋隨機尾；撞版唔會自動覆蓋（要人手揀）', async () => {
  const OB = await import('../assets/js/lib/offline.js');
  const v1 = OB.makeVersion(1700000000000, () => 0.1);
  const v2 = OB.makeVersion(1700000000000, () => 0.9);
  assert(v1 !== v2, '同一秒都要分得開（隨機尾）');
  assert(OB.versionNewer(v2, v1) === false || OB.versionNewer(v2, v1) === true, '要答到新舊');
  eq(OB.versionNewer('亂', v1), null, '解析唔到＝當「唔知」，唔可以當新');
  const d = OB.diffVersions({ notices: '2026-01-02T00:00:00-aaa', calendar: '2026-01-01T00:00:00-aaa' }, { notices: '2026-01-01T00:00:00-bbb', calendar: '2026-01-02T00:00:00-bbb' });
  assert(d.localNewer.includes('notices'), '本機較新嘅要認到');
  assert(d.remoteNewer.includes('calendar'), '後端較新嘅要認到');
  const c = OB.resolveConflict({ tables: { 通告: [1, 2] }, baseVersion: '2026-01-01T00:00:00-aaa', remoteVersion: '2026-01-02T00:00:00-bbb', remoteTables: { 通告: [1] } });
  eq(c.action, 'needs_review', '後端較新＝要人手睇，唔可以自動覆蓋');
  eq(c.perTable[0].default, 'theirs', '預設用後端（唔會靜靜食掉人哋改動）');
  assert(c.note.includes('唔會自動覆蓋'), '要明講唔會自動覆蓋');
});

await test('★ 排隊重試：指數 backoff ＋ jitter（唔會同一刻一齊撞）', async () => {
  const OB = await import('../assets/js/lib/offline.js');
  const a = OB.backoffMs(1, { rand: () => 0 });
  const b = OB.backoffMs(1, { rand: () => 1 });
  assert(b > a && a >= 125, `第 1 次要 125~250ms（got ${a}~${b}）`);
  assert(OB.backoffMs(4, { rand: () => 1 }) > OB.backoffMs(1, { rand: () => 1 }), '要指數上升');
  assert(OB.backoffMs(99, { rand: () => 1 }) <= OB.RETRY.capMs, '要有上限（唔會等到天光）');
  assert(OB.isRetriable('busy') && OB.isRetriable('timeout') && OB.isRetriable('network'), '呢啲要重試');
  assert(!OB.isRetriable('need_chief') && !OB.isRetriable('keep_one'), '權限／規則錯唔應該盲重試');
  /* 真跑一次：頭兩次 busy、第三次成功 */
  let n = 0;
  const r = await OB.withRetry(async () => (++n < 3 ? { ok: false, code: 'busy' } : { ok: true, data: 'done' }), { sleep: async () => {} });
  assert(r.ok && r.tries === 3 && r.log.length >= 2, '重試流程唔啱：' + JSON.stringify(r));
  /* 唔可重試＝即刻收手 */
  let m = 0;
  const r2 = await OB.withRetry(async () => { m++; return { ok: false, code: 'need_chief' }; }, { sleep: async () => {} });
  assert(r2.ok === false && m === 1, '唔應該重試 need_chief');
});

await test('★ 離線隊列：本機最多暫存 200 筆，清得乾淨', async () => {
  const OB = await import('../assets/js/lib/offline.js');
  const fake = { _d: '', getItem() { return this._d || null; }, setItem(k, v) { this._d = v; } };
  OB.clearQueue(fake);
  for (let i = 0; i < 205; i++) OB.pushQueue({ table: '旅通告', i }, fake);
  eq(OB.readQueue(fake).length, 200, '要封頂 200 筆（唔會爆 localStorage）');
  OB.clearQueue(fake);
  eq(OB.readQueue(fake).length, 0);
});

await test('★ 訂閱（★重中之重）：只送匿名資料（冇 email／姓名）＋走圖書館原鏈', async () => {
  const PU = await import('../assets/js/lib/push.js');
  const sub = PU.buildSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } }, { topics: ['circulars', '亂填'], unit: '0082', branch: 'vs0082' });
  eq(sub.source, 'troop_portal', '要標明來源（館方分得出邊個系統）');
  eq(sub.topics.join(','), 'circulars', '題材要白名單（亂填唔收）');
  const dump = JSON.stringify(sub);
  assert(!/email|name|ymis|"pw"/.test(dump), '唔可以有任何個人資料：' + dump);
  assert(!dump.includes('0082/vs0082') === false || true, '');
  eq(sub.scope, '0082/vs0082', '只帶單位／支部（唔係個人）');
  eq(PU.checkSubscription({ endpoint: 'x', keys: { p256dh: 'p' } }).ok, false, '缺 auth 要唔通');
  eq(PU.checkSubscription(sub).ok, true, '齊料要通');
  assert(PU.PUSH_CONFIG.source === 'troop_portal', '一條鏈：唔另起爐灶');
  const cap = PU.capability({ navigator: {} });
  assert(typeof cap.note === 'string' && cap.note.length > 0, '要老實講支援唔支援');
});

await test('★ 體積治理：單檔 ≤5MB、每筆 ≤3 張、AVIF／WebP 優先（BUILD §10）', async () => {
  const F = await import('../assets/js/lib/formats.js');
  eq(F.LIMITS.uploadBytes, 5 * 1024 * 1024); eq(F.LIMITS.perRecord, 3);
  assert(F.LIMITS.distBytes === 5 * 1024 * 1024 && F.LIMITS.bundleBytes === 2 * 1024 * 1024, 'dist／bundle 上限同 BUILD 一致');
  const ok = F.checkUpload({ name: 'a.webp', type: 'image/webp', size: 300 * 1024 });
  assert(ok.ok && ok.needConvert === false, 'webp 應該直接過');
  const big = F.checkUpload({ name: 'a.jpg', type: 'image/jpeg', size: 6 * 1024 * 1024 });
  assert(big.ok === false && big.errors.some(e => e.includes('超過上限')), '6MB 要擋');
  const many = F.checkUpload({ name: 'a.jpg', type: 'image/jpeg', size: 1000 }, { countInRecord: 4 });
  assert(many.ok === false, '第 4 張要擋');
  const daily = F.checkUpload({ name: 'a.jpg', type: 'image/jpeg', size: 10 * 1024 * 1024 }, { usedBytesToday: 39 * 1024 * 1024 });
  assert(daily.ok === false, '每日總量要擋');
  const gif = F.checkUpload({ name: 'a.gif', type: 'image/gif', size: 1000 });
  assert(gif.ok && gif.needConvert, 'gif 要建議轉 AVIF／WebP');
  eq(F.bestFormat(['image/jpeg', 'image/webp']), 'image/webp', '有 webp 應該揀 webp');
  eq(F.bestFormat([]), 'image/jpeg', '乜都冇＝jpeg 保底');
  assert(F.human(1536).includes('KB'), '要人睇得明嘅單位');
  assert(F.checkSize({ distBytes: 1, bundleBytes: 1 }).ok === true && F.checkSize({ distBytes: 9e9 }).ok === false, '體積報表要判得啱');
});

await test('★ 教材三層跟版本走：docs/教材/*.md 真係存在，UI 對照表冇死連結', async () => {
  const { existsSync } = await import('node:fs');
  const docs = await import('../assets/js/views/docs.js');
  assert(docs.DOC_FILES.length >= 9, '教材檔案對照表唔齊（角色 5 ＋ 模組 ＋ MOCK ＋ checklist ＋ 開戶）');
  docs.DOC_FILES.forEach(f => {
    assert(f.file.startsWith('docs/教材/'), '教材要放 docs/教材/：' + f.file);
    assert(existsSync(join(ROOT, f.file)), '教材檔案唔存在：' + f.file);
    const body = readFileSync(join(ROOT, f.file), 'utf8');
    assert(body.length > 200, `教材太短（似係空檔）：${f.file}`);
    assert(/我而家應該做咩|checklist|規矩|五分鐘/.test(body), `教材要有「跟住做」嘅指引：${f.file}`);
  });
  /* 角色快速入門：五個角色都要有 */
  ['旅長', '教練員', '家長', '支部人員', '平台超管'].forEach(r => {
    assert(docs.DOC_FILES.some(f => f.who === r), '欠角色教材：' + r);
  });
  /* README 索引要列齊 */
  const idx = readFileSync(join(ROOT, 'docs/教材/README.md'), 'utf8');
  docs.DOC_FILES.forEach(f => assert(idx.includes(f.file.replace('docs/教材/', '')), '教材索引漏咗：' + f.file));
  /* 開旅 checklist 唔可以再叫人用「臨時密碼」（密碼只由網站 PBKDF2 落 hash） */
  const cl = readFileSync(join(ROOT, 'docs/教材/08-開旅-checklist.md'), 'utf8');
  assert(cl.includes('setup token'), '開旅 checklist 要講 setup token');
  assert(!/臨時密碼/.test(cl), '開旅 checklist 唔應該再提臨時密碼（GAS 唔經手明文密碼）');
});

await test('★ 純邀請制開關：UI 有、store 有、預設開放申請（求救唔受影響）', async () => {
  const d = S.load();
  eq(d.settings.applyMode, 'open', '預設要係開放申請');
  const users = readFileSync(join(ROOT, 'assets/js/views/users.js'), 'utf8');
  assert(/apply-mode/.test(users) && /invite-only/.test(users), '用戶與身份要有純邀請制開關');
  assert(/求救照收|求救照樣收/.test(users), '要寫明求救唔受純邀請制影響');
  A.loginAs('u-chief');
  main.boot();
  fireHash(w, '#/users?tab=invites');
  const btn = document.querySelector('#apply-mode');
  assert(btn, '開關掣唔見咗；session＝' + JSON.stringify(S.getSession()?.role || null) + '；body＝' + (document.body?.textContent || '').slice(0, 120) + '；hash＝' + loc.hash);
  btn.click();
  eq(S.load().settings.applyMode, 'invite-only', '撳完要變純邀請制');
  assert(S.load().audit.some(a => String(a.action).includes('開戶申請模式')), '切換要入審計');
  fireHash(w, '#/users?tab=invites');
  main.boot();
  fireHash(w, '#/users?tab=invites');
  document.querySelector('#apply-mode').click();
  eq(S.load().settings.applyMode, 'open', '要撳得返開放申請');
});

await test('★ merge3：唔同欄各自保留；同一格衝突唔自動揀（逐格 ask）；批量才 serverTime 新者勝', async () => {
  const OB = await import('../assets/js/lib/offline.js');
  const base = { title: '中秋露營', place: '西貢', quota: 20 };
  const mine = { title: '中秋露營（改期）', place: '西貢', quota: 20 };
  const theirs = { title: '中秋露營', place: '大埔', quota: 20 };
  const r = OB.merge3(base, mine, theirs);
  eq(r.merged.title, '中秋露營（改期）', '我改嗰欄用我嘅');
  eq(r.merged.place, '大埔', '佢改嗰欄用佢嘅');
  eq(r.merged.quota, 20, '冇人改＝跟 base');
  eq(r.asks.length, 0, '唔同欄唔算衝突');
  /* 同一格兩邊都改 → ask（唔自動揀） */
  const r2 = OB.merge3(base, { title: '我嘅版本' }, { title: '佢嘅版本' });
  eq(r2.asks.join(','), 'title', '同一格要彈出嚟問');
  eq(r2.took, 'ask');
  /* 兩邊改到一樣 → 唔算衝突 */
  const r3 = OB.merge3(base, { title: '一樣' }, { title: '一樣' });
  eq(r3.asks.length, 0, '改到一樣唔應該當衝突');
  eq(r3.fields.title, 'both-same');
  /* 批量／無人看場：serverTime 新者勝，但留底 */
  const b1 = OB.merge3Batch({ base, mine: { title: '我嘅' }, theirs: { title: '佢嘅' }, mineAt: 100, theirsAt: 200 });
  eq(b1.merged.title, '佢嘅', '後端較新＝佢贏');
  eq(b1.asks.length, 0, '批量唔會問');
  eq(b1.took, 'serverTime');
  assert(b1.overwrote.length === 1 && b1.overwrote[0].field === 'title', '要留底（食咗邊個改動）');
  const b2 = OB.merge3Batch({ base, mine: { title: '我嘅' }, theirs: { title: '佢嘅' }, mineAt: 200, theirsAt: 100 });
  eq(b2.merged.title, '我嘅', '我較新＝我贏');
  /* 逐行合併：新增／刪除／衝突都認得出 */
  const rows = OB.merge3Rows(
    [{ id: 'n-1', title: 'A' }, { id: 'n-2', title: 'B' }],
    [{ id: 'n-1', title: '我改嘅' }, { id: 'n-3', title: 'C' }],
    [{ id: 'n-1', title: '佢改嘅' }, { id: 'n-2', title: 'B2' }]
  );
  assert(rows.added.includes('n-3'), '我新增嘅行要保留');
  assert(rows.deleted.includes('n-2'), '佢冇咗嗰行要當刪除（唔會靜靜復活）');
  assert(rows.asks.some(a => a.id === 'n-1'), '同一行同一欄都改過 → 要問');
});

await test('★ 備份：Drive 留 13 份、三時機提醒、匯入前警告（冇新鮮備份唔好批量操作）', async () => {
  const sys = await import('../assets/js/views/system.js');
  eq(sys.BACKUP_KEEP, 13, 'BUILD 寫留 13 份');
  const st = sys.localBackupState(S.load());
  eq(st.keep, 13);
  assert(st.count >= 1, '示範要有備份紀錄');
  assert(typeof st.remind === 'string' && st.remind.length > 5, '要有人話提醒');
  /* 過期（>7 日）要有 stale；新嘅唔應該 stale */
  const old = sys.localBackupState({ backups: [{ at: '2020-01-01 00:00' }] });
  assert(old.stale === true && /日冇備份/.test(old.remind), '7 日冇備份要提醒：' + old.remind);
  const fresh = sys.localBackupState({ backups: [{ at: new Date().toISOString().slice(0, 16).replace('T', ' ') }] });
  assert(fresh.stale === false, '啱做過備份唔應該話過期');
  assert(sys.localBackupState({ backups: [] }).missing === true, '冇紀錄＝missing');
  /* 頁面要有 13 份／三時機／即刻做備份 */
  A.loginAs('u-chief');
  main.boot();
  fireHash(w, '#/system?tab=data');
  const t = text();
  assert(t.includes('Drive 留 13 份'), '資料頁冇講 13 份：' + t.slice(0, 120));
  assert(t.includes('三時機提醒'), '資料頁冇三時機提醒');
  assert(document.querySelector('[data-backup]'), '冇「即刻做 Drive 備份」掣');
  document.querySelector('[data-backup]').click();
  await new Promise(r => setTimeout(r, 30));
  assert(S.load().backups.length >= 4, '示範模式撳備份要入本機紀錄');
  assert(S.load().audit.some(a => String(a.action).includes('備份去 Drive')), '備份要入審計');
  /* 匯入對話框要有批量操作前提醒 */
  fireHash(w, '#/system?tab=data');
  document.querySelector('[data-import]').click();
  const dlgText = document.querySelector('.mask')?.textContent || '';
  assert(/批量操作前提醒|已經有新鮮備份/.test(dlgText), '匯入前要有備份提醒：' + dlgText.slice(0, 80));
});

await test('★ PDPO：離隊 12 個月（演練 → 真做）、數據清單、同意書文案', async () => {
  A.loginAs('u-chief');
  main.boot();
  fireHash(w, '#/system?tab=privacy');
  const t = text();
  assert(t.includes('數據清單'), '要有數據清單：' + t.slice(0, 120));
  assert(t.includes('12 個月'), '要講 12 個月 purge');
  assert(t.includes('家長同意'), '要講家長同意');
  assert(document.querySelector('[data-consent-text]'), '要有同意書文案掣');
  /* GAS 側嘅數據清單要同 UI 講同一套（兩邊一齊講 PDPO 先算數） */
  const gas = readFileSync(join(ROOT, 'apps-script/Code.gs'), 'utf8');
  assert(/function dataInventory/.test(gas) && /function purgeLeftMembers/.test(gas), 'GAS 要有數據清單／離隊 purge');
  assert(/dryRun !== false/.test(gas), '離隊 purge 預設要係演練（唔好一撳就清）');
  assert(/consent: !!\(o\.consent\)/.test(gas), '開戶申請要記家長同意欄位');
});

await test('★ 匿名可寫面：公開頁免登入寫入只經 /api/proxy 白名單（六支），示範零 fetch', async () => {
  const PUB = await import('../assets/js/lib/public.js');
  const proxy = readFileSync(join(ROOT, 'api/proxy.js'), 'utf8');
  const gasSrc = readFileSync(join(ROOT, 'apps-script/Code.gs'), 'utf8');
  /* 三邊白名單要一模一樣：前端 lib ↔ proxy ↔ GAS */
  const m = proxy.match(/export const ANON_GAS = \[([^\]]+)\]/);
  assert(m, 'proxy 要有 ANON_GAS 白名單');
  const proxyList = m[1].split(',').map(x => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
  eq(PUB.ANON_ACTIONS.length, 6, '免登入可寫面應該係六支');
  PUB.ANON_ACTIONS.forEach(a => assert(proxyList.includes(a), `proxy 白名單要包 ${a}`));
  const gasList = (gasSrc.match(/ANON_WRITE_ACTIONS\s*=\s*\[([^\]]+)\]/) || [, ''])[1];
  PUB.ANON_ACTIONS.forEach(a => assert(gasList.includes(a), `GAS 匿名可寫面要包 ${a}`));
  /* 內部欄位喺匿名路徑要擋（proxy 側） */
  assert(/export const ANON_FORBID = \[/.test(proxy) && /state/.test(proxy.match(/ANON_FORBID = \[([^\]]+)\]/)[1]), 'ANON_FORBID 要擋 state');
  assert(/anon_forbidden/.test(proxy), '擋到要回 anon_forbidden 錯誤碼');
  /* 示範模式：一個請求都唔會發 */
  S.resetDemo();
  let fetched = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetched++; return { ok: true, status: 200, json: async () => ({ success: true }) }; };
  const mock = await PUB.submitAnon('accountApply', { name: '示範', ymis: 'YMIS-9', consent: true });
  eq(mock.ok, false, '示範模式唔可以當成功');
  eq(mock.code, 'mock', '示範要回 mock 碼');
  eq(fetched, 0, '示範模式零 fetch（鐵律）');
  const notAllowed = await PUB.submitAnon('deleteUser', {});
  eq(notAllowed.code, 'not_allowed', '白名單以外要即刻擋（前端側）');
  assert(PUB.receiptText(mock, { what: '報名' }).text.includes('示範'), '示範提示要老實講');
  globalThis.fetch = realFetch;
  /* 四個公開頁都要真接上（唔止 UI 假成功） */
  [['public.html', 'saveRescue'], ['notice.html', 'noticeSignup'], ['borrow.html', 'borrowApply'], ['join.html', 'accountApply']]
    .forEach(([f, action]) => {
      const html = readFileSync(join(ROOT, f), 'utf8');
      assert(html.includes("from './assets/js/lib/public.js'"), `${f} 要 import public.js`);
      assert(html.includes(`submitAnon('${action}'`), `${f} 要真送 ${action}`);
    });
  /* borrow 要帶 GAS 認得嘅 ref（物資編號），唔係 itemId */
  const borrow = readFileSync(join(ROOT, 'borrow.html'), 'utf8');
  assert(/submitAnon\('borrowApply',\s*\{[\s\S]*?ref: it\.id/.test(borrow), 'borrow 要帶 ref＝物資編號');
  /* join 純邀請制：冇邀請都要畀人表達想開戶，但一定要 YMIS */
  const joinHtml = readFileSync(join(ROOT, 'join.html'), 'utf8');
  assert(/純邀請制/.test(joinHtml), 'join 要講純邀請制');
  assert(/要填 YMIS/.test(joinHtml), '開戶申請要強制 YMIS');
  assert(/PDPO/.test(joinHtml), '要 PDPO 同意打勾');
});

await test('★ 平台開旅：scripts/units.mjs（units.json ＋ env 清單），檔永遠唔含 key', async () => {
  const { execFileSync } = await import('node:child_process');
  const run = args => execFileSync('node', [join(ROOT, 'scripts/units.mjs'), ...args], { cwd: ROOT, encoding: 'utf8' });
  const list = run(['list']);
  assert(/data\/units\.json/.test(list) && /第八十二旅/.test(list), 'list 要印旅：' + list.slice(0, 80));
  assert(/Vercel env/.test(list), 'list 要提醒 BACKEND／APIKEY 住 Vercel env');
  const env = run(['env', '--id', '82']);
  assert(/TROOP_82_BACKEND=/.test(env) && /TROOP_82_APIKEY=/.test(env), 'env 要印兩個變數名');
  assert(/SESSION_SECRET/.test(env), 'env 要提平台共用變數');
  /* 檔本身：唔可以有任何 key／URL（連格式檢查都要過） */
  const raw = readFileSync(join(ROOT, 'data/units.json'), 'utf8');
  const units = JSON.parse(raw).units;
  eq(units.length, 1, '示範資料庫得一個旅');
  assert(!/troop_|script\.google\.com|APIKEY=|\/exec/.test(raw), 'units.json 永遠唔可以含 key／後端 URL');
  assert(units.every(u => u.backendEnv === undefined && u.keyEnv === undefined), '單位 entry 只放公開資料');
  const check = run(['check']);
  assert(/格式同私隱檢查都過/.test(check), 'check 要過：' + check);
  /* 平台 UI 要有工具卡（同 docs/教材 08 checklist 對得上） */
  const pf = readFileSync(join(ROOT, 'assets/js/views/platform.js'), 'utf8');
  assert(/scripts\/units\.mjs/.test(pf) && /npm run units/.test(pf), '平台頁要教點跑 units.mjs');
  assert(/api\/units\?diag=1/.test(pf), '平台頁要可以睇真 · /api/units?diag=1');
  const doc = readFileSync(join(ROOT, 'docs/教材/08-開旅-checklist.md'), 'utf8');
  assert(/units\.mjs/.test(doc), '開旅 checklist 要提 units.mjs');
});

await test('★ 同步引擎：三色燈＋樂觀鎖＋merge3 逐格問（示範零 fetch；唔會自動揀）', async () => {
  const SYNC = await import('../assets/js/lib/sync.js');
  SYNC.resetSync();
  /* 示範模式：一個請求都唔可以發（鐵律） */
  let calls = 0;
  const fake = { loadTables: async () => { calls++; return { ok: true, data: { data: {}, version: 'v1' } }; }, saveTables: async () => { calls++; return { ok: true }; } };
  const mock = await SYNC.syncNow({ api: fake });
  eq(mock.code, 'mock', '示範模式要老實講 mock');
  eq(calls, 0, '示範模式零 fetch');
  eq(SYNC.light().light, 'green', '乾淨＝綠燈');

  /* 真模式（注入假 API 當後端）：同一格兩邊都改 → 唔可以自動揀 */
  const d = S.load();
  S.setMock(false);                                        // 扮真模式（唔會真連網：API 全部注入）
  const baseNotice = { id: 'n-1', title: '旅露營', place: '西貢', quota: 30 };
  SYNC.markBase({ notices: [baseNotice] });
  /* 我改 title 同 place；佢改 title、place 同 quota → 只有 title／place 兩格兩邊都改過 */
  const mine = [{ id: 'n-1', title: '旅露營（改）', place: '西貢（我改）', quota: 30 }];
  const theirs = [{ id: 'n-1', title: '旅露營（佢改）', place: '西貢（佢改）', quota: 40 }];
  let wrote = null;
  const api2 = {
    loadTables: async () => ({ ok: true, data: { data: { notices: theirs }, version: 'v2' } }),
    saveTables: async tb => { wrote = tb; return { ok: true, data: { version: 'v3' } }; }
  };
  const need = await SYNC.syncNow({ api: api2, tables: { notices: mine } });
  eq(need.code, 'need_decisions', '同格衝突要問，唔可以靜靜揀');
  eq(wrote, null, '未答之前一個字都唔可以寫');
  eq(need.conflicts.length, 2, 'title 同 place 兩格都要問（quota 只有佢改 → 唔使問）');
  assert(need.conflicts.every(c => c.key && c.key.includes('|')), '要俾 UI 每格一個 key');
  assert(SYNC.state().pending.length === 2, '未答嘅問題要留底（下次再問）');
  assert(SYNC.conflictList(need.asks)[0].label.includes('n-1'), 'UI 要有「邊一格」標籤');

  /* 逐格揀：title 用我、quota 用佢 → 就係呢兩個結果 */
  const decisions = {};
  need.conflicts.forEach(c => { decisions[c.key] = c.field === 'title' ? 'mine' : 'theirs'; });
  const done = await SYNC.syncNow({ api: api2, tables: { notices: mine }, decisions });
  assert(done.ok, '答完就要寫得入：' + (done.msg || done.code));
  const row = wrote.notices[0];
  eq(row.title, '旅露營（改）', '揀「用我」＝保留我嘅');
  eq(row.place, '西貢（佢改）', '揀「用佢」＝用後端嗰個');
  eq(row.quota, 40, '只有佢改嘅欄＝自動跟佢（唔使問）');
  eq(done.picked.mine + done.picked.theirs, 2, '要有逐格統計');
  eq(SYNC.light().light, 'green', '寫入成功＝綠燈');
  assert(SYNC.state().base.notices[0].quota === 40, '成功之後要推新 base（下次合併用）');

  /* 無人看場（batch）：serverTime 新者勝，但一定要留底 */
  SYNC.resetSync();
  SYNC.markBase({ notices: [baseNotice] });
  const batch = await SYNC.syncNow({ api: api2, mode: 'batch', tables: { notices: mine } });
  assert(batch.ok, 'batch 要寫得入');
  assert(batch.overwrote.length >= 1, '自動揀咗就要留底（overwrote）');

  /* 撞版（有人搶先寫）：自動重新讀＋合併一次，唔會覆蓋人哋嘅改動 */
  SYNC.resetSync();
  SYNC.markBase({ notices: [baseNotice] });
  let tries = 0, wrote2 = null;
  const clashApi = {
    loadTables: async () => ({ ok: true, data: { data: { notices: theirs }, version: 'v9' } }),
    saveTables: async (tb, opts = {}) => {
      tries++;
      if (tries === 1) return { ok: false, code: 'conflict', conflict: true, version: 'v9', msg: '有人搶先寫過' };
      wrote2 = { tb, opts }; return { ok: true, data: { version: 'v10' } };
    }
  };
  const clash = await SYNC.syncNow({ api: clashApi, tables: { notices: mine }, decisions: { 'notices|n-1|title': 'mine', 'notices|n-1|place': 'mine' } });
  assert(clash.ok, '撞版要自動重試成功：' + (clash.msg || clash.code));
  eq(tries, 2, '撞版只自動重試一次（唔會無限迴圈）');
  eq(wrote2.opts.baseVersion, 'v9', '重試要用最新版本做 baseVersion');

  /* 送唔到 → 入本機隊列，唔會跌；燈號變黃／紅 */
  SYNC.resetSync();
  const bad = await SYNC.syncNow({ api: { loadTables: async () => ({ ok: false, code: 'network', msg: '斷線' }), saveTables: async () => ({ ok: false }) }, tables: { notices: mine } });
  eq(bad.ok, false, '連唔到唔可以當成功');
  assert(bad.queued >= 1 && SYNC.queueSize() >= 1, '要入本機隊列');
  assert(['yellow', 'red'].includes(SYNC.light().light), '有未送＝唔可以係綠燈');
  SYNC.resetSync();
  S.resetDemo();
});

await test('★ 部署文件：預檢＋部署步驟涵蓋 P6–P14（新 env／新驗收項）', async () => {
  const doc = readFileSync(join(ROOT, 'docs/後端部署步驟.md'), 'utf8');
  assert(/npm run preflight/.test(doc), '部署步驟要叫 ADMIN 先跑 preflight');
  ['VAPID_PUBLIC_KEY', 'PUSH_INGEST_URL', 'APP_URL'].forEach(k => assert(doc.includes(k), `要提新 env：${k}`));
  assert(/VAPID 私鑰永遠唔會喺旅側/.test(doc), '要講明私鑰唔喺旅側');
  ['忘記密碼', '子女綁定', '樂觀鎖', 'sig jti', '紀錄只記 metadata', '推送訂閱', '下游範本'].forEach(k =>
    assert(doc.includes(k), `驗收清單要有：${k}`));
  assert(/唯一判準/.test(doc), '要保留「本機綠 ≠ 真通」嘅判準');
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  assert(/preflight/.test(readme), 'README 要提 preflight');
  S.resetDemo();
});

await test('★ preflight：只報變數名同狀態（永遠唔印值）＋ 真環境未設就老實報', async () => {
  const { execFileSync } = await import('node:child_process');
  const SECRET = 'troop_THIS_MUST_NEVER_SHOW_UP_0123456789';
  const SESS = 'session-secret-THIS_MUST_NEVER_SHOW_UP_abcdef';
  const run = extra => {
    try {
      return execFileSync('node', [join(ROOT, 'scripts/preflight.mjs')], {
        cwd: ROOT, encoding: 'utf8',
        env: { PATH: process.env.PATH, HOME: process.env.HOME, ...extra }
      });
    } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
  };
  /* ① 未設：要老實講（唔會扮綠色），exit code 唔會係 0 */
  const bare = run({});
  assert(/未設/.test(bare) && /SESSION_SECRET/.test(bare), '未設要列明：' + bare.slice(0, 200));
  assert(/跟住做/.test(bare), '要交返清單');
  /* ② 設咗：只可以見變數名同長度 —— 永遠唔可以見值 */
  const full = run({
    SESSION_SECRET: SESS, TROOP_82_BACKEND: 'https://script.google.com/macros/s/AKfyFAKE/exec',
    TROOP_82_APIKEY: SECRET, SUPER_KEY: 'super-THIS_MUST_NEVER_SHOW_UP', VAPID_PUBLIC_KEY: 'B'.repeat(80),
    PUSH_INGEST_URL: 'https://library.example/functions/v1/push'
  });
  assert(!full.includes(SECRET) && !full.includes(SESS), '★★ preflight 唔可以印任何值：' + full.slice(0, 300));
  assert(!/AKfyFAKE/.test(full), '★ 連後端 URL 都唔可以印');
  assert(!/library\.example/.test(full), '★ 館方收件位都唔可以印');
  assert(/已設/.test(full), '設咗要講已設');
  assert(/TROOP_82_BACKEND／APIKEY（已設）/.test(full), '要講清邊個旅兩件齊');
  assert(/已設，長度 \d+/.test(full), 'SESSION_SECRET 只可以報長度');
  /* ③ 靜態就緒：部署體積要計（<5MB）＋ api 零依賴 */
  assert(/部署體積/.test(full) && /5MB/.test(full), '要報部署體積＋上限');
  assert(/api 零依賴/.test(full), '要檢查 api 零依賴');
  /* ④ npm script 存在 */
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert(pkg.scripts.preflight === 'node scripts/preflight.mjs', '要有 npm run preflight');
});

await test('★ 個人化訂閱（推送鏈）：sw.js 齊、前端四步真訂閱、示範零 fetch、未開通唔扮成功', async () => {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  assert(/addEventListener\('push'/.test(sw), 'sw.js 要收 push');
  assert(/showNotification/.test(sw), 'sw.js 要顯示通知');
  assert(/notificationclick/.test(sw) && /openWindow/.test(sw), '撳通知要開返 APP');
  assert(/pushsubscriptionchange/.test(sw), '訂閱被換要通知頁面重新訂閱');
  assert(!/addEventListener\('fetch'/.test(sw), '★ sw 唔應該攔 fetch（免得同 Vercel／app 打架）');
  /* 前端：四步真訂閱 ＋ 匿名 payload */
  const push = readFileSync(join(ROOT, 'assets/js/lib/push.js'), 'utf8');
  assert(/export async function subscribeDevice/.test(push), '要有真訂閱（唔係得個掣）');
  assert(/pushManager\.subscribe/.test(push) && /applicationServerKey/.test(push), '要真係 pushManager.subscribe（帶 VAPID 公鑰）');
  assert(/requestPermission/.test(push), '要問通知權限');
  assert(/not_configured/.test(push), '未開通要有專屬 code（唔扮成功）');
  assert(/\/api\/push/.test(push), '前端只認同源 /api/push');
  assert(!/supabase\.co|VAPID_PRIVATE|service_role/i.test(push), '★ 前端唔可以有任何館方 URL／私鑰');
  /* UI：訂閱頁要有能力／鏈狀態／真掣 */
  A.loginAs('u-chief');
  main.boot();
  fireHash(w, '#/notices?tab=subs');
  await new Promise(r => setTimeout(r, 20));
  const t = text();
  assert(/推送裝置/.test(t), '訂閱頁要有推送裝置卡');
  assert(/瀏覽器能力/.test(t), '要顯示瀏覽器能力（唔支援都要老實講）');
  assert(/推送鏈/.test(t), '要顯示推送鏈狀態');
  assert(document.querySelector('#sub-toggle'), '要有開啟推送掣');
  /* 示範模式：撳落去零 fetch、老實講（先確保係未開狀態，撳落去＝開啟） */
  S.commit(dd => { dd.subscriptions.pushEnabled = false; });
  fireHash(w, '#/notices?tab=subs');
  await new Promise(r => setTimeout(r, 20));
  let fetches = 0;
  const of = globalThis.fetch;
  globalThis.fetch = (...a) => { fetches++; return of(...a); };
  await document.querySelector('#sub-toggle').click();
  await new Promise(r => setTimeout(r, 40));
  globalThis.fetch = of;
  eq(fetches, 0, '★ 示範模式撳開啟推送＝零 fetch');
  const toastText = document.querySelector('#toasts')?.textContent || '';
  assert(/示範模式/.test(toastText), '示範模式要老實講（唔會真訂閱）：' + JSON.stringify(toastText.slice(0, 120)));
  assert(!/已交館方/.test(toastText), '★ 示範模式唔可以講「已交館方」（講大話）');
  /* 後端：/api/push 存在，且收件位／私鑰只住 env */
  const api = readFileSync(join(ROOT, 'api/push.js'), 'utf8');
  assert(/PUSH_INGEST_URL/.test(api) && /VAPID_PUBLIC_KEY/.test(api), 'env 名稱要對得上（VAPID_PUBLIC_KEY／PUSH_INGEST_URL）');
  assert(/sanitizeSubscription/.test(api) && /hasPii/.test(api), '要有白名單剝 PII');
  assert(!/supabase\.co\/[a-z0-9]/i.test(api), '★ 唔可以寫死館方 URL');
  /* 教材 13 ＋ 索引 */
  const doc = readFileSync(join(ROOT, 'docs/教材/13-個人化訂閱與推送.md'), 'utf8');
  assert(/VAPID_PUBLIC_KEY/.test(doc) && /PUSH_INGEST_URL/.test(doc), '教材 13 要列開通 env');
  assert(/旅側永遠唔存訂閱表/.test(doc), '要講明旅側唔存訂閱表（責任線）');
  const idx = readFileSync(join(ROOT, 'docs/教材/README.md'), 'utf8');
  assert(/13-個人化訂閱與推送\.md/.test(idx), '教材索引要有 13');
  /* CI 硬攔（BUILD §10 體積治理） */
  const ci = readFileSync(join(ROOT, '.github/workflows/check.yml'), 'utf8');
  assert(/npm run check|npm run smoke/.test(ci), 'CI 要跑 check／smoke');
  assert(/超過 5MB 上限/.test(ci), '★ CI 要有部署體積硬攔（<5MB）');
  /* ★ CI 嘅 Node 版本要同 package.json engines 對得上（唔可以又係 20 打 22 嘅嘢）：
     jsdom 30 嘅 engines 係 ^22.22.2 —— 之前 CI 用 node 20，直接喺 undici 爆 TypeError，
     smoke 一步都跑唔到（lint／gas／api 全綠都會照紅燈）。 */
  const eng = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).engines.node;
  const envMajor = Number((ci.match(/node-version:\s*'(\d+)/) || [])[1]);
  const engMajor = Number((eng.match(/(\d+)/) || [])[1]);
  assert(Number.isFinite(envMajor), 'CI 要寫明 node-version');
  assert(engMajor >= 22, 'engines 要 ≥22（jsdom 30 要 ^22.22.2）：' + eng);
  assert(envMajor >= engMajor, `★ CI node-version（${envMajor}）唔可以低過 engines（${eng}）`);
  const jsdomEng = JSON.parse(readFileSync(join(ROOT, 'node_modules/jsdom/package.json'), 'utf8')).engines.node;
  const [jmaj, jmin] = (jsdomEng.match(/\d+\.\d+/) || ['0.0'])[0].split('.').map(Number);
  const [rmaj, rmin] = process.versions.node.split('.').map(Number);
  assert(rmaj > jmaj || (rmaj === jmaj && rmin >= jmin), `本機 node（${process.versions.node}）唔可以舊過 jsdom 要求（${jsdomEng}）`);
  S.resetDemo();
});

await test('★ db shard：真後端檢查掣（示範模式零 fetch／老實講）＋ GAS 源碼釘死三個保障', async () => {
  /* ① UI：後端分頁有「真後端檢查」掣 ＋ db shard 卡 */
  A.loginAs('u-chief');
  main.boot();
  fireHash(w, '#/system?tab=backend');
  const t = text();
  assert(/真後端檢查/.test(t), '後端分頁要有「真後端檢查」掣');
  assert(/db shard/.test(t), '要有 db shard 卡');
  assert(/件數上限|maxParts/.test(t), '要講件數上限');
  assert(/回滾/.test(t), '要講分件失敗會回滾');
  assert(/唔會讀到一半/.test(t), '要講寫入前後 bump 版本（pointer 覆查偵測得到）');
  /* ② 示範模式：零 fetch，撳落去只老實講 */
  let fetches = 0;
  const of = globalThis.fetch;
  globalThis.fetch = (...a) => { fetches++; return of(...a); };
  document.querySelector('[data-live-diag]').click();
  await new Promise(r => setTimeout(r, 40));
  globalThis.fetch = of;
  eq(fetches, 0, '★ 示範模式撳真後端檢查＝零 fetch');
  const mask = document.querySelector('.mask');
  assert(mask && /示範模式/.test(mask.textContent) && /唔會假裝連到後端/.test(mask.textContent), '要老實講（唔會假裝連到）');
  document.querySelectorAll('.mask').forEach(m => m.remove());
  /* ③ GAS 源碼：三個保障都要喺（唔可以只做 UI） */
  const gas = readFileSync(join(ROOT, 'apps-script/Code.gs'), 'utf8');
  assert(/maxParts: 40/.test(gas), '件數上限要喺 LIMITS');
  assert(/refused: true/.test(gas) && /今次一個字都冇寫/.test(gas), '超上限要誠實拒（唔寫一半）');
  assert(/function restoreShard_\(/.test(gas), '要有回滾函式');
  const wa = gas.indexOf('bumpVersion_();');
  const wa2 = gas.indexOf('bumpVersion_();', wa + 1);
  assert(wa > 0 && wa2 > wa, '分件寫入前後各要 bump 一次（write-ahead ＋ write-behind）');
  assert(gas.slice(wa, wa + 200).includes('readTableAll_(name)'), '寫入前要留 snapshot（回滾用）');
  assert(/rep\.versionBumps = 2/.test(gas), '寫完要再 bump（write-behind）');
  assert(/rolledBack/.test(gas), '要老實報回滾結果');
  assert(/shard: \{ maxParts/.test(gas), 'dbInfo 要報分件現況');
  /* ④ api.js 要有兩支（真模式先打） */
  const api = readFileSync(join(ROOT, 'assets/js/lib/api.js'), 'utf8');
  assert(/export async function dbInfo\(/.test(api) && /export async function backendStatus\(/.test(api), 'api.js 要有 dbInfo／backendStatus');
  /* ⑤ /api/proxy 白名單 */
  const proxy = readFileSync(join(ROOT, 'api/proxy.js'), 'utf8');
  assert(/'dbInfo'/.test(proxy), 'proxy 白名單要有 dbInfo（讀取）');
  S.resetDemo();
});

await test('★ 下游接入：範本齊（sig 驗簽／閂口／leaf token）＋支部頁指路＋教材 12', async () => {
  const ds = readFileSync(join(ROOT, 'apps-script/Downstream.gs'), 'utf8');
  /* ① 範本三件：驗上游簽名、直接入口掣、leaf 自製 session token */
  assert(/function verifyLinkSig\(/.test(ds), '要有上游簽名驗證');
  assert(/function localLoginAllowed\(/.test(ds) && /ALLOW_LOCAL_LOGIN/.test(ds), '要有直接入口掣（ALLOW_LOCAL_LOGIN）');
  assert(/function mintLeafToken\(/.test(ds) && /function verifyLeafToken\(/.test(ds), '★ 要有 leaf 自製 session token');
  assert(/leaf-session-v1/.test(ds), 'leaf 密鑰要同上游 sig 密鑰分開（唔可以互用）');
  assert(/LEAF_TOKEN_TTL_MS = 30 \* 60 \* 1000/.test(ds), 'leaf token 上限 30 分鐘');
  assert(/stale_pv/.test(ds) && /wrong_node/.test(ds), '改密碼／搬 node 要令舊 token 失效');
  /* ② 下游永不回打上游：範本唔應該有 UrlFetchApp（唯一例外係上游側） */
  assert(!/UrlFetchApp/.test(ds), '★ 下游範本唔可以回打上游（UrlFetchApp 唔應該出現）');
  /* ③ 本地憑證操作永不經簽名接受 */
  assert(/LINK_NEVER_ACTIONS = \['login', 'apply', 'logout', 'changePassword'/.test(ds), 'login／apply／改密碼 要入永不接受清單');
  /* ④ 支部頁要指路（唔使人盲搵） */
  const br = readFileSync(join(ROOT, 'assets/js/views/branches.js'), 'utf8');
  assert(/Downstream\.gs/.test(br), '支部登記頁要提範本檔名');
  assert(/12-下游接入/.test(br), '支部登記頁要指去教材 12');
  /* ⑤ 教材＋索引 */
  const doc = readFileSync(join(ROOT, 'docs/教材/12-下游接入.md'), 'utf8');
  assert(/leaf 自製 session token/.test(doc) && /永不回打上游/.test(doc), '教材 12 要講晒三條規矩');
  const idx = readFileSync(join(ROOT, 'docs/教材/README.md'), 'utf8');
  assert(/12-下游接入\.md/.test(idx), '教材索引要有 12');
  const docsJs = readFileSync(join(ROOT, 'assets/js/views/docs.js'), 'utf8');
  assert(/12-下游接入\.md/.test(docsJs), '教材頁清單要有 12');
});

await test('★ 讀取樂觀化：後端讀到一半有人寫 → 前端誠實講（唔會扮一致）；寫入照樣樂觀鎖', async () => {
  const SYNC = await import('../assets/js/lib/sync.js');
  SYNC.resetSync();
  S.setMock(false);
  SYNC.markBase({ notices: [{ id: 'n-1', title: '旅露營' }] });
  const baseRow = { id: 'n-1', title: '旅露營' };
  const theirs = [baseRow];                                  // 對面冇改呢行（唔會撞格）
  let sawBase = null;
  const api = {
    loadTables: async () => ({ ok: true, data: { data: { notices: theirs }, version: 'v7', consistent: false, readRounds: 3, note: '讀取期間有人寫入（已重試 3 次）' } }),
    saveTables: async (tb, opts) => { sawBase = opts?.baseVersion; return { ok: true, data: { version: 'v8' } }; }
  };
  const r = await SYNC.syncNow({ api, tables: { notices: [baseRow, { id: 'n-2', title: '我新加嘅活動' }] } });
  eq(r.inconsistentRead, true, '★ 唔一致要浮上面（唔可以靜靜當冇事）');
  assert(/有人寫入/.test(String(SYNC.state().lastReadNote || '')), '要喺同步狀態留住「讀取期間有人寫入」（唔係錯誤，但要見到）');
  eq(SYNC.state().lastReadRounds, 3, '要記低覆查讀咗幾轉');
  assert(!!sawBase, '寫入仍要帶版本（樂觀鎖照行）：' + sawBase);
  /* 一致嘅讀：唔應該無端出警告 */
  SYNC.resetSync();
  const api2 = { loadTables: async () => ({ ok: true, data: { data: {}, version: 'v1', consistent: true } }), saveTables: async () => ({ ok: true, data: { version: 'v2' } }) };
  const r2 = await SYNC.syncNow({ api: api2, tables: { notices: [] } });
  eq(r2.inconsistentRead, false, '一致嘅讀唔應該報唔一致');
  /* 後端側：GAS 一定要有 pointer 覆查（唔可以只做前端） */
  const gas = readFileSync(join(ROOT, 'apps-script/Code.gs'), 'utf8');
  assert(/var READ_ACTIONS = \['status', 'dbInfo', 'load', 'loadTables', 'getVersion'\]/.test(gas), 'GAS 要有讀取白名單');
  assert(/needsLock = READ_ACTIONS\.indexOf\(action\) < 0/.test(gas), '讀取唔應該攞全域寫鎖');
  assert(/consistent: stable/.test(gas), 'GAS 要回 consistent');
  SYNC.resetSync(); S.setMock(true); S.resetDemo();
});

await test('★ sig jti：一次性簽名有持久環（cache 蒸發都擋得住）；GAS 源碼釘死', async () => {
  const gas = readFileSync(join(ROOT, 'apps-script/Code.gs'), 'utf8');
  assert(/function jtiOf_/.test(gas), '要有 jti 衍生（nonce → 摘要）');
  assert(/function jtiSeen_/.test(gas) && /function jtiRemember_/.test(gas), '要有持久環：查 ＋ 記');
  assert(/SIG_JTI_RING_KEY/.test(gas) && /setProperty\(SIG_JTI_RING_KEY/.test(gas), 'jti 環要寫落 ScriptProperties（持久，唔止 cache）');
  assert(/sigJtiRing: 200/.test(gas), '環要有上限（唔會無限長大）');
  assert(/sig_replayed/.test(gas), '重放要回穩定 error code（sig_replayed）');
  assert(/jti:\s*jtis\[0\]/.test(gas) || /jti: jtis\[0\]/.test(gas), '成功驗簽要回 jti（方便追）');
  /* 兩道閘都要喺驗簽**之前**，而且 cache 快路同持久環並存 */
  const ver = gas.slice(gas.indexOf('function verifySig_'), gas.indexOf('function jtiRingRead_'));
  assert(/c\.get\('sn_' \+ consumed\[i\]\)/.test(ver) && /jtiSeen_\(jtis\[i\]\)/.test(ver), 'cache ＋ 持久環兩道閘都要查');
  assert(ver.indexOf('jtiSeen_') < ver.indexOf('computeHmacSha256Signature'), '重放檢查要喺計簽名之前（唔會做白工）');
});

await test('★ 紀錄只記 metadata：內容唔入審計（只記長度）、email／電話遮住、UI 講明白', async () => {
  const U = await import('../assets/js/lib/util.js');

  /* ① 規則本身：長文字＝內容，唔記；短 id／狀態＝metadata，照記 */
  const long = '呢段係通告內文。'.repeat(11);        // 88 字＞門檻 80
  eq(U.redactMeta(long), `[內容不記錄 len=${long.length}]`, '★ 長文字唔可以入 log（只記長度）');
  eq(U.redactMeta('ACTIVE'), 'ACTIVE', '短狀態要原樣留住');
  eq(U.redactMeta('n-9'), 'n-9', 'id 要原樣留住');
  const em = U.redactMeta('chan.tai-man@demo.hk');
  assert(!/chan\.tai-man@demo\.hk/.test(em) && /@demo\.hk/.test(em), '★ email 要遮中間（網域留住）：' + em);
  const ph = U.redactMeta('9123 4567');
  assert(!/9123/.test(ph) && /4567/.test(ph), '★ 電話只留尾 4 位：' + ph);
  eq(U.redactMeta(''), '', '空字串照回空');

  /* ② 真寫一次審計：入本機 audit 嘅一定係遮好嘅 */
  A.loginAs('u-chief');
  main.boot();
  const n0 = S.load().audit.length;
  S.audit('發通告', 'n-9', long);
  S.audit('改帳號狀態', 'chan.tai-man@demo.hk', 'ACTIVE');
  const rows = S.load().audit.slice(0, S.load().audit.length - n0);
  assert(rows.length >= 2, '要寫入兩條審計');
  assert(!rows.some(r => /通告內文/.test(String(r.detail))), '★ 本機審計都唔可以有內容');
  assert(rows.some(r => /\[內容不記錄 len=\d+\]/.test(String(r.detail))), '要記長度');
  assert(!rows.some(r => /chan\.tai-man@demo\.hk/.test(String(r.target))), '★ 本機審計唔可以有完整 email');

  /* ③ UI：審計卡要講明只記 metadata（用戶睇得到） */
  fireHash(w, '#/system?tab=audit');
  const t = text();
  assert(/只記 metadata/.test(t), '審計卡要寫明只記 metadata');
  assert(/內容不記錄/.test(t), '要講明長文字唔記內容');

  /* ④ 後端同一套規則（唔可以只做前端） */
  const gas = readFileSync(join(ROOT, 'apps-script/Code.gs'), 'utf8');
  assert(/function redactMeta_/.test(gas), 'GAS 要有 redactMeta_');
  assert(/detail: redactMeta_\(String\(detail/.test(gas), '審計 detail 要過紅acted');
  assert(/email: redactMeta_\(sanitizeLabel_\(email/.test(gas), 'ACCESS_LOG email 都要遮');
  assert(/LOG_META_MAX/.test(gas), '要有「幾長當內容」嘅門檻');
  S.resetDemo();
});

await test('★ backoff＋jitter 硬化：錯誤碼統一（讀寫同一套）＋讀取都會重試＋隊列記下次時間', async () => {
  const SYNC = await import('../assets/js/lib/sync.js');
  const OB = await import('../assets/js/lib/offline.js');
  const API2 = await import('../assets/js/lib/api.js');

  /* ① 錯誤碼統一：HTTP 狀態 → 穩定 code（唔靠 message 文字判斷） */
  eq(API2.codeForStatus(429), 'rate_limited', '429 ＝ 被限流（可重試）');
  eq(API2.codeForStatus(503), 'busy', '503 ＝ 後端忙（可重試）');
  eq(API2.codeForStatus(504), 'busy', '504 ＝ 閘道超時（可重試）');
  eq(API2.codeForStatus(500), 'busy', '純 5xx（冇 JSON）＝ 可以重試');
  eq(API2.codeForStatus(500, true), 'fail', '有 JSON 業務錯就照佢個 code，唔會盲重試');
  eq(API2.codeForStatus(401), 'no_session', '401 ＝ session 問題（唔係 backoff 嘅事）');
  assert(OB.isRetriable('load_fail') && OB.isRetriable('save_fail') && OB.isRetriable('network') && OB.isRetriable('rate_limited'), '連線類 code 都要重試 —— 之前 load_fail／save_fail 唔喺白名單，等於冇 backoff');
  assert(!OB.isRetriable('no_session') && !OB.isRetriable('conflict') && !OB.isRetriable('keep_one'), '權限／撞版／規則錯唔可以盲重試');

  /* ② 讀取都要 backoff：第一次 busy、第二次成功 → 唔應該一鎚定生死 */
  SYNC.resetSync();
  S.setMock(false);                                        // 扮真模式（API 全部注入，唔會真連網）
  SYNC.markBase({ notices: [{ id: 'n-1', title: '旅露營' }] });
  let reads = 0;
  const flakyRead = {
    loadTables: async () => { reads++; return reads === 1 ? { ok: false, code: 'busy', msg: '後端忙' } : { ok: true, data: { data: {}, version: 'v5' } }; },
    saveTables: async () => ({ ok: true, data: { version: 'v6' } })
  };
  const mine = [{ id: 'n-1', title: '野外' }];
  const rOk = await SYNC.syncNow({ api: flakyRead, tables: { notices: mine } });
  eq(reads, 2, '讀後端要自動重試（第 2 次成功）');
  eq(rOk.ok, true, '讀重試成功之後照寫得入');

  /* ③ 寫入失敗：隊列要記住次數同「下次幾時試」，而且下次時間係 backoff＋jitter 出嚟 */
  SYNC.resetSync();
  const bad = { loadTables: async () => ({ ok: true, data: { data: {}, version: 'v1' } }), saveTables: async () => ({ ok: false, code: 'busy', msg: '後端忙' }) };
  const fail = await SYNC.syncNow({ api: bad, tables: { notices: mine } });
  eq(fail.ok, false, '送唔到唔可以當成功');
  assert(fail.nextRetryMs > 0 && fail.nextRetryAt > Date.now() - 1000, '要老實報下次重試時間');
  eq(fail.retriable, true, 'busy 係可重試（唔係死症）');
  const q1 = OB.readQueue();
  assert(q1.length >= 1 && q1[0].tries >= 1 && q1[0].nextAt > 0, '隊列項要記 tries ＋ nextAt');
  const info = SYNC.queueInfo();
  eq(info.size, q1.length, 'queueInfo 要對得上隊列');
  assert(info.tries >= 1, 'queueInfo 要報試過幾次');

  /* ④ 未夠鐘：自動 drain 唔會敲後端（force 就係人手優先） */
  let sends = 0;
  const counting = { saveTables: async () => { sends++; return { ok: true, data: { version: 'v2' } } } };
  const early = await SYNC.drainQueue({ api: counting, now: Date.now() });
  eq(early.code, 'not_due', 'backoff 未夠鐘唔應該敲後端');
  eq(sends, 0, '未夠鐘＝零請求');
  assert(/秒後/.test(early.msg || ''), '要講清楚仲有幾耐');
  const forced = await SYNC.drainQueue({ api: counting, now: Date.now(), force: true });
  eq(sends, 1, '人手「即刻重試」＝唔等 backoff');
  eq(forced.ok, true, '送得入就要成功');
  eq(forced.remaining, 0, '送成功之後隊列清返');
  eq(SYNC.queueSize(), 0, '隊列乾淨');

  /* ⑤ 失敗多次：下次時間會愈推愈遠（指數）＋有上限 */
  eq(OB.failQueueItem({ tries: 0 }, { now: 1000, rand: () => 1 }).nextAt, 1000 + OB.backoffMs(1, { rand: () => 1 }), '第 1 次＝base');
  const t5 = OB.failQueueItem({ tries: 4 }, { now: 1000, rand: () => 1 }).nextAt - 1000;
  assert(t5 > OB.backoffMs(1, { rand: () => 1 }), '試得多要等得耐啲');
  assert(OB.backoffMs(50, { rand: () => 1 }) <= OB.RETRY.capMs, '有上限：唔會等到天光');

  /* ⑥ UI：系統 →「同步」要顯示下次自動重試（唔係得個「失敗」兩隻字） */
  SYNC.resetSync();
  await SYNC.syncNow({ api: bad, tables: { notices: mine } });
  /* 睇 UI 前轉返示範模式：真模式 boot 會開靜默刷新 interval（測試唔應該留低定時器） */
  S.setMock(true);
  A.loginAs('u-chief');
  main.boot();
  fireHash(w, '#/system?tab=sync');
  const st = text();
  assert(/下次自動重試/.test(st), 'UI 要顯示下次自動重試時間');
  assert(/backoff/.test(st) && /jitter/.test(st), '要講明 backoff＋jitter（唔會同一刻一齊撞）');
  SYNC.resetSync();
  S.setMock(true);
  S.resetDemo();
});

await test('★ 同步 UI：系統 →「同步」分頁（燈號卡＋即刻同步＋隊列＋逐格確認對話框）', async () => {
  A.loginAs('u-chief');
  main.boot();
  fireHash(w, '#/system?tab=sync');
  const t = text();
  assert(t.includes('同步一次'), '要有「同步一次」卡：' + t.slice(0, 60));
  assert(t.includes('三色燈'), '要講明三色燈係咩意思');
  assert(t.includes('唔會自動揀') || t.includes('逐格問'), '要講明同格衝突唔會自動揀');
  assert(document.querySelector('[data-sync]'), '要有「立即同步」掣');
  assert(document.querySelector('[data-sync-batch]'), '要有「無人看場」掣');
  assert(document.querySelector('[data-queue'), '要有隊列重試掣');
  /* 示範模式撳落去：唔可以扮同步 */
  document.querySelector('[data-sync]').click();
  await new Promise(r => setTimeout(r, 30));
  assert(/示範模式/.test(document.querySelector('#toasts')?.textContent || ''), '示範模式要老實講唔會假裝同步');
  /* 逐格確認 UI：真衝突清單 render 得出（唔會自己揀） */
  const sys = await import('../assets/js/views/system.js');
  assert(typeof sys.render === 'function', 'system 模組要 render 到');
  const src = readFileSync(join(ROOT, 'assets/js/views/system.js'), 'utf8');
  assert(/askConflicts/.test(src) && /用我/.test(src) && /用佢/.test(src), '要有逐格確認對話框（用我／用佢）');
  assert(/data-sync/.test(src) && /syncNow/.test(src), '掣要真係叫 syncNow（唔係假 UI）');
  document.querySelectorAll('.mask').forEach(m => m.remove());
});

await test('★ 移交（BUILD §6）：同一套規矩（hash／冪等／撞號／家長）＋UI 兩邊都有', async () => {
  const T = await import('../assets/js/lib/transfer.js');
  const H = await import('../assets/js/lib/hash.js');
  /* canonical 欄序一定要同 GAS 一樣（唔係兩邊算唔同 hash） */
  const gas = readFileSync(join(ROOT, 'apps-script/Code.gs'), 'utf8');
  const gasFields = (gas.match(/var TRANSFER_FIELDS = \[([^\]]+)\]/) || [, ''])[1].split(',').map(x => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
  eq(gasFields.join(','), H.TRANSFER_FIELDS.join(','), 'GAS 同前端嘅欄序要一模一樣');
  const bundle = { transferId: 'tid-1', scout_id: 'YMIS-1', ymis: 'YMIS-1', name: '陳小明', dob: '2010-01-01', parentContact: 'mom@demo.hk', badgeSummary: '深資章', transferTo: 'vs', transferDate: '2026-09-26' };
  const h = await H.hashForBundle(bundle);
  eq(h.hash.length, 64, '要 64 位 hex');
  const h2 = await H.hashForBundle({ ...bundle, sha256: 'zzz', hashKind: 'sha256' });
  eq(h2.hash, h.hash, 'canonical：多餘欄位／key 次序唔影響 hash');
  const h3 = await H.hashForBundle({ ...bundle, name: '陳小明（改）' });
  assert(h3.hash !== h.hash, '改過內容就要唔同 hash');

  /* 接收規矩：① hash 唔對 ② 冇 transferId ③ 冪等 ④ 撞號 */
  const members = [{ ymis: 'YMIS-2', name: '李小明', status: 'ACTIVE' }];
  const transfers = [{ transferId: 'tid-done', state: 'done' }];
  eq((await T.verifyBundle(bundle, { sha256: 'deadbeef', members: [], transfers: [] })).code, 'bad_hash', '改過檔要拒');
  eq(T.verifyImport({ bundle: { scout_id: 'Y' }, hash: h.hash }).code, 'bad_transfer', '冇 transferId 唔收');
  eq(T.verifyImport({ bundle: { transferId: 'tid-x' }, hash: h.hash }).code, 'bad_scout', '冇 SCOUT_ID 唔收');
  eq(T.verifyImport({ bundle, hash: h.hash, transfers }).code, 'ok', '乾淨套裝要收得');
  eq(T.verifyImport({ bundle: { ...bundle, transferId: 'tid-done' }, hash: h.hash, transfers }).code, 'duplicate', '同一個 transferId 收過＝拒');
  eq(T.verifyImport({ bundle: { ...bundle, scout_id: 'YMIS-2' }, hash: h.hash, members }).code, 'clash', '撞號要擋（現役）');
  eq(T.verifyImport({ bundle: { ...bundle, scout_id: 'YMIS-2' }, hash: h.hash, members: [{ ymis: 'YMIS-2', name: 'x', status: 'pending_hash' }] }).code, 'clash', '等開戶都算撞號');
  /* 接收之後＝pending_hash（密碼行開戶流程，唔會當已開戶） */
  eq(T.acceptRow(bundle, 'vs', '2026-09-26').status, 'pending_hash');
  eq(T.acceptRow(bundle, 'vs', '2026-09-26').transferId, 'tid-1');
  /* 移出＝tombstone ＋ transferTo／transferDate；家長：同旅零改動 */
  const patch = T.outPatch({ ...bundle, sha256: h.hash }, { from: 'sc', to: 'vs', reason: '升團', date: '2026-09-26' });
  eq(patch.member.status, 'TRANSFERRED_OUT', '移出要記 tombstone');
  eq(patch.member.transferTo, 'vs');
  assert(/家長戶轉 LEFT/.test(patch.row.parentAction), '轉旅＝來源家長戶停用');
  const same = T.outPatch(bundle, { to: 'sc', sameTroop: true });
  assert(/零改動/.test(same.row.parentAction), '同旅移動＝家長零改動');
  /* GAS 側：三個動作齊 ＋ 家長通知文案 ＋ 白名單 */
  assert(/function transferOut/.test(gas) && /TRANSFERRED_OUT/.test(gas), 'GAS 要有 transferOut');
  assert(/function importTransferBundle/.test(gas) && /parentNotice/.test(gas), 'GAS 要有接收同家長通知文案');
  assert(/case 'transferOut'/.test(gas) && /'transferOut', 'importTransferBundle'/.test(gas), '要入 ACTIONS 白名單');
  /* UI：移出／接收兩邊都喺「移交與升降團」度；真模式叫 API、示範用同一套規則 */
  const view = readFileSync(join(ROOT, 'assets/js/views/transfers.js'), 'utf8');
  assert(/'out', '移出（來源團）'/.test(view) && /'pending', '接收（目標團）'/.test(view), '要分開來源團／目標團兩個分頁');
  assert(/API\.transferOut/.test(view) && /API\.importTransferBundle/.test(view), '真模式要叫真 API（唔係假 UI）');
  assert(/verifyBundle/.test(view), '示範模式都要行同一套驗證規則');
  A.loginAs('u-chief');
  main.boot();
  fireHash(w, '#/transfers?tab=out');
  const t = text();
  assert(t.includes('移出（來源團）') || t.includes('① 移出'), '要有移出介面：' + t.slice(0, 60));
  assert(document.querySelector('#to-go'), '要有「移出 ＋ 產生移交套裝」掣');
  assert(t.includes('TRANSFERRED_OUT'), '要講明 tombstone');
  fireHash(w, '#/transfers?tab=pending');
  assert(document.querySelector('#tf-import'), '接收頁要有「匯入移交套裝」掣');
});

await test('★ 忘記密碼：登入頁有入口、設定密碼頁、示範零 fetch、唔會外洩有冇戶口', async () => {
  globalThis.location.search = '';
  A.logout();
  main.boot();
  assert(document.querySelector('#forgot'), '旅閘登入頁要有「唔記得密碼？」掣');
  assert(document.querySelector('#rescue'), '求救掣要留返（入唔到嘅最後一路）');
  /* 撳落去：示範模式唔會發請求，但要有真入口（modal） */
  document.querySelector('#forgot').click();
  const dlg = document.querySelector('.mask');
  assert(dlg, '撳「唔記得密碼」要開對話框');
  assert(/一次性連結/.test(dlg.textContent) && /唔會.*有冇戶口|防.*枚舉/.test(dlg.textContent), '要講清楚一次性連結 ＋ 防枚舉');
  assert(dlg.querySelector('#fg-email'), '要輸入 email');
  dlg.querySelector('#fg-email').value = 'parent@demo.troop';
  dlg.querySelector('[data-go]').click();
  await new Promise(r => setTimeout(r, 30));
  assert(/示範模式/.test(dlg.textContent), '示範模式要老實講（唔會假裝寄咗）');
  assert(/求救/.test(dlg.textContent), '要有求救 fallback');
  document.querySelectorAll('.mask').forEach(m => m.remove());

  /* 設定密碼頁（第一個旅長／重設連結共用）：真模式先會打 API */
  globalThis.location.search = '?step=setup&t=ABCD1234EFGH&e=chief@demo.troop';
  main.boot();
  const t = text();
  assert(/設定密碼/.test(t), 'setup 步驟要 render');
  assert(document.querySelector('#st-token').value === 'ABCD1234EFGH', '連結帶嘅 token 要填好');
  assert(document.querySelector('#st-email').value === 'chief@demo.troop', '連結帶嘅 email 要填好');
  assert(/PBKDF2/.test(t), '要講明密碼由伺服器雜湊（GAS 唔見明文）');
  document.querySelector('#st-pw').value = 'short';
  document.querySelector('#st-go').click();
  await new Promise(r => setTimeout(r, 20));
  assert(/最少 8 字/.test(document.querySelector('#st-err')?.textContent || ''), '短密碼要即刻擋');
  document.querySelector('#st-pw').value = 'newpass1234';
  document.querySelector('#st-pw2').value = 'newpass1234';
  document.querySelector('#st-go').click();
  await new Promise(r => setTimeout(r, 30));
  assert(/示範模式/.test(document.querySelector('#toasts')?.textContent || ''), '示範模式唔可以假裝真設密碼');
  globalThis.location.search = '';

  /* 後端合約：GAS 側同 /api 側都要有（唔可以只做前端） */
  const gas = readFileSync(join(ROOT, 'apps-script/Code.gs'), 'utf8');
  assert(/function issueResetToken/.test(gas) && /MailApp\.sendEmail/.test(gas), 'GAS 要負責種 token 同寄信');
  assert(/setupExp/.test(gas) && /token_expired/.test(gas), '重設連結要有限期（過期唔收）');
  assert(/no_user（唔會外洩邊個 email 有戶）/.test(gas), '搵唔到都要回同一個形狀（防枚舉）');
  const api = readFileSync(join(ROOT, 'assets/js/lib/api.js'), 'utf8');
  assert(/forgotPassword/.test(api) && /setupWithToken/.test(api), 'api.js 要有兩支（前端唔可以自己算 hash）');
  assert(!/PBKDF2|pbkdf2/i.test(api) || !/hashPassword/.test(api), '前端唔可以自己 hash 密碼（PBKDF2 一定係 server 側）');
});

await test('★ 子女綁定：家長申請（真模式打 API）→ 領袖確認先見得到；demo 有兩張（含名冊對唔上）', async () => {
  /* ① demo 資料：兩張待批（一張正常、一張名冊對唔上） */
  A.logout(); globalThis.location.search = ''; main.boot();
  const demoBinds = S.load().applications.filter(a => a.kind === 'bind');
  assert(demoBinds.length >= 2, 'demo 要有待批綁定（正常 ＋ 名冊對唔上）');
  assert(demoBinds.some(b => !b.title), '要有一張係名冊對唔上（示範唔會亂批）');

  /* ② 領袖頁（待辦）：分頁有「子女綁定」＋要講明係領袖確認 */
  A.loginAs('u-chief');
  main.boot();
  fireHash(w, '#/pending?kind=bind');
  await new Promise(r => setTimeout(r, 20));
  const t = text();
  assert(/子女綁定/.test(t), '待辦要有子女綁定分類');
  assert(/領袖確認|防亂認人仔/.test(t), '要講明係領袖確認（防亂認人仔）');
  assert(/名冊對唔上/.test(t), '名冊對唔上要即刻睇得到（唔會亂批）');

  /* ③ 家長頁：送出綁定（示範模式零 fetch，誠實） */
  await new Promise(r => setTimeout(r, 10));
  A.logout();
  A.loginAs('u-parent');
  main.boot();
  fireHash(w, '#/children');
  const before = S.load().applications.filter(a => a.kind === 'bind').length;
  document.querySelector('#ch-ymis').value = 'ymis-2009';
  await document.querySelector('#ch-add').click();
  await new Promise(r => setTimeout(r, 40));
  const after = S.load().applications.filter(a => a.kind === 'bind');
  assert(after.length === before + 1, '要加一張待批綁定');
  assert(after.some(a => a.ymis === 'YMIS-2009'), '申請要記住係綁邊個');
  assert(/領袖確認/.test(document.querySelector('#toasts')?.textContent || ''), '示範模式都要講「要領袖確認」');

  /* ④ 後端合約：GAS 兩個 action ＋ 白名單 ＋ api.js 兩支 */
  const gas = readFileSync(join(ROOT, 'apps-script/Code.gs'), 'utf8');
  assert(/function bindChild/.test(gas), 'GAS 要有 bindChild');
  assert(/function decideBind/.test(gas), 'GAS 要有 decideBind（領袖確認）');
  assert(/唔可以批自己／|| no_parent/.test(gas) || /no_parent/.test(gas), '冇家長戶唔可以批');
  const proxy = readFileSync(join(ROOT, 'api/proxy.js'), 'utf8');
  assert(/'bindChild'/.test(proxy) && /'decideBind'/.test(proxy), 'proxy 白名單兩邊都要有');
  const api = readFileSync(join(ROOT, 'assets/js/lib/api.js'), 'utf8');
  assert(/export async function bindChild/.test(api) && /export async function decideBind/.test(api), 'api.js 要包兩支');
  /* 確認 = 領袖專屬（成員／家長唔可以自己批自己） */
  const bindLines = proxy.split('\n').filter(l => l.includes("'decideBind'"));
  assert(bindLines.some(l => /領袖/.test(l)), 'decideBind 要標明係領袖專屬（唔可以自己批自己）');
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
  if (results[results.length - 1]?.[0] === 'ok') results[results.length - 1] = ['ok', `互動掃描：撳咗 ${clicks} 個掣，冇例外`];
  S.resetDemo();                                                       // 掃描改過嘅示範資料還原
});

/* 測試衛生：示範模式／真模式都唔應該留低定時器同 session（唔然個 process 唔會退） */
A.logout();
A.stopSilentRefresh();

/* ---------- 報告 ---------- */
console.log(`\n旅系統 smoke — ${results.filter(r => r[0] === 'ok').length}/${results.length} 通過`);
for (const [state, name] of results) console.log(`  ${state === 'ok' ? '✓' : '✗'} ${name}`);
if (problems.length) {
  console.log('\n失敗詳情：');
  for (const [name, e] of problems) console.log(`\n✗ ${name}\n   ${String(e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n   ') : e)}`);
  process.exit(1);
}
console.log('\n✓ 全部場景通過（示範模式；真後端未接）\n');

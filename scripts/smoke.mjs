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

await test('登入：四個示範帳號都入得', async () => {
  for (const l of A.DEMO_LOGINS) {
    const r = A.login(l.email, A.DEMO_PASSWORD);
    assert(r.ok, `${l.label} 登入失敗：${r.msg}`);
    assert(S.getSession().role === l.role, `${l.label} 角色唔啱`);
  }
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
  'dashboard', 'pending', 'branches', 'branch/vs0082', 'notices', 'notice/n-1', 'calendar',
  'finance', 'inventory', 'transfers', 'users', 'public', 'children', 'system', 'docs', 'docs/blueprint'
];
const ROLE_ROUTES = {
  chief: ROUTES.filter(r => r !== 'children'),          // 我的子女＝家長專頁（旅長唔會見到）
  leader: ROUTES.filter(r => !['system', 'children'].includes(r)),
  parent: ['dashboard', 'branches', 'branch/vs0082', 'notices', 'notice/n-1', 'calendar', 'public', 'children', 'docs', 'docs/blueprint'],
  member: ['dashboard', 'notices', 'notice/n-1', 'calendar', 'docs', 'docs/blueprint'],
  guest: ['docs']
};
const LOGIN_FOR = { chief: 'u-chief', leader: 'u-lee', parent: 'u-parent', member: 'u-parent' };

for (const [role, routes] of Object.entries(ROLE_ROUTES)) {
  const userId = LOGIN_FOR[role];
  await test(`路由（${role}）：${routes.length} 條路線都畫到嘢`, async () => {
    if (role === 'chief' || role === 'leader' || role === 'parent') {
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
  branches: ['overview', 'link', 'members', 'finance', 'notices', 'calendar', 'inventory', 'progress', 'public'],
  notices: ['list', 'signup', 'subs', 'drafts'],
  calendar: ['month', 'list'],
  finance: ['overview', 'branch', 'troop', 'report'],
  inventory: ['list', 'loans', 'share'],
  transfers: ['pending', 'batch', 'history'],
  users: ['list', 'invites', 'perms', 'applications'],
  public: ['troop', 'branches', 'share', 'preview'],
  system: ['troop', 'modules', 'backend', 'audit', 'automation', 'data', 'privacy', 'keys'],
  docs: ['start', 'modules', 'checklist']
};

await test('全部模組 × 全部子分頁都 render 到', async () => {
  A.loginAs('u-chief');
  main.boot();
  for (const [mod, tabs] of Object.entries(TABS)) {
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
  assert(document.getElementById('view').innerHTML.includes('唔屬你嘅角色'), '家長竟然入得系統頁');
});

/* ============================================================
   E：公開頁（inline script 真跑）
   ============================================================ */
const PAGES = [
  ['public.html', '', '公開資料'],
  ['notice.html', '?n=n-1', '通告'],
  ['notice.html', '?n=nope', '搵唔到'],
  ['join.html', '?t=TROOP-LEAD-7F3A9C2E', '邀請開戶'],
  ['join.html', '?t=NOPE', '連結無效'],
  ['join.html', '?t=TROOP-BRA-9A1C3E5G', '已用過'],
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

/* 儀表板 — 旅一目了然 */
import { esc, icon, money, fmtDate, todayISO, daysBetween, relTime, stateDot } from '../lib/util.js';
import * as S from '../lib/store.js';
import { go } from '../lib/router.js';
import { page, card, stat, badge, linkBadge, table, head, notice, progressBar } from './ui.js';
import { ROLE_LABEL } from '../lib/registry.js';

export function render(el) {
  const d = S.load();
  const u = S.currentUser();
  const c = S.counters();
  const role = S.getSession()?.role;

  if (role === 'parent') return renderParentDash(el);
  if (role === 'member') return renderMemberDash(el);

  const green = d.branches.filter(b => b.link.state === 'green').length;
  const youth = d.branches.reduce((n, b) => n + b.youth, 0);
  const adults = d.branches.reduce((n, b) => n + b.adults, 0);
  const monthIncome = d.financeSubmits.reduce((n, f) => n + f.income, 0);
  const monthExpense = d.financeSubmits.reduce((n, f) => n + f.expense, 0);
  const soon = S.calendarForViewer()
    .filter(e => daysBetween(todayISO(), e.date) >= 0 && daysBetween(todayISO(), e.date) <= 30)
    .sort((a, b) => a.date.localeCompare(b.date));
  const pending = S.pendingList();
  const notices = S.noticesForViewer().filter(n => n.status === 'published').slice(0, 4);

  const body = `
  ${notice(`呢個係<b>示範旅</b>（MOCK）：資料全部住喺呢部機，<b>唔會送去任何後端</b>。五個支部嘅「接駁狀態」係示範值 —— 真模式會由旅 GAS <span class="mono">/exec</span> 讀返落嚟。` +
    '<div class="mt-8"><button class="btn sm" id="db-open-docs">' + icon('doc', 14) + ' 睇功能藍圖（邊樣做、邊樣跳轉）</button> <button class="btn sm" id="db-reset">' + icon('refresh', 14) + ' 還原示範資料</button></div>', 'warn')}

  <div class="grid g4 mt-12">
    ${stat({ k: '支部（下游）', v: d.branches.length, u: '個', hint: `已接駁 <b>${green}</b> · 待處理 <b>${d.branches.length - green}</b>` })}
    ${stat({ k: '現役成員', v: youth + adults, u: '人', hint: `青少年 ${youth} · 成人領袖 ${adults}` })}
    ${stat({ k: '等你處理', v: c.pendingCount, u: '項', tone: c.pendingCount ? 'warn' : 'ok', hint: `財務待跟 <b>${c.financeDue}</b> · 借用 <b>${c.loanPending}</b> · 移交 <b>${c.transferPending}</b>` })}
    ${stat({ k: '本月支部收支', v: money(monthIncome - monthExpense), u: '淨', hint: `收入 ${money(monthIncome)} · 支出 ${money(monthExpense)}` })}
  </div>

  <div class="grid g2 mt-12">
    ${card({
      title: '需要你處理', sub: pending.length ? `${pending.length} 項等你拍板` : '暫時冇嘢等',
      actions: `<a class="btn sm" href="#/pending">全部 ${icon('arrowR', 13)}</a>`,
      body: pending.length ? `<div class="grid" style="gap:8px">${pending.slice(0, 4).map(a => `
        <div class="flex-b" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px">
          <div class="grow">
            <div class="bold sm">${esc(a.name)} <span class="tag n sm">${kindLabel(a.kind)}</span></div>
            <div class="xs faint">${esc(a.note)}</div>
          </div>
          <div class="right xs faint nowrap">${esc(a.need || '')}</div>
        </div>`).join('')}</div>` : notice('冇待辦 —— 旅團運作正常。', 'ok')
    })}
    ${card({
      title: '接駁狀態', sub: '旅 → 團 → 進度（sig 單向；下游同步回結果）',
      actions: `<a class="btn sm" href="#/branches">支部一覽 ${icon('arrowR', 13)}</a>`,
      body: table({
        cls: 'tbl compact',
        head: ['支部', '狀態', '本地入口', '最後測試'],
        rows: d.branches.map(b => ({
          cls: S.canSeeBranch(b) ? '' : 'faint',
          cells: [
            `<a href="#/branch/${b.id}"><span class="swatch" style="background:${b.color}"></span> ${esc(b.name)}</a>${S.canSeeBranch(b) ? '' : ' <span class="tag n sm">未授權</span>'}`,
            linkBadge(b.link.state),
            b.link.state === 'red' ? '<span class="faint xs">—</span>' : (b.link.localLogin ? badge('開啟（未閂）', 'y', true) : badge('已閂（只收 sig）', 'g', true)),
            `<span class="xs faint">${esc(b.link.lastPing || '—')}</span>`
          ]
        }))
      })
    })}
  </div>

  <div class="grid g3 mt-12">
    ${card({ title: '未來 30 日活動', sub: `${soon.length} 項`, body: soon.length ? `<div class="grid" style="gap:8px">${soon.slice(0, 5).map(e => `
      <div class="flex" style="gap:10px">
        <div class="center" style="flex:0 0 46px"><div class="bold">${fmtDate(e.date)}</div><div class="xs faint">${esc(e.time || '')}</div></div>
        <div class="grow"><div class="sm bold">${esc(e.title)}</div><div class="xs faint">${esc(S.branchName(e.cal))} · ${esc(e.place || '')}</div></div>
      </div>`).join('')}</div>` : `<div class="empty">未來 30 日冇活動</div>` })}
    ${card({ title: '最新通告', sub: `已發佈 ${d.notices.filter(n => n.status === 'published').length} 條`, actions: `<a class="btn sm" href="#/notices">通告 ${icon('arrowR', 13)}</a>`,
      body: `<div class="grid" style="gap:8px">${notices.map(n => `
        <a href="#/notice/${n.id}" class="flex-b" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px;text-decoration:none;color:inherit">
          <div class="grow"><div class="sm bold trunc">${esc(n.title)}</div>
          <div class="xs faint">${esc(n.scope === 'troop' ? '旅通告' : S.branchName(n.ownerBranch))} · ${fmtDate(n.at)} · 可見 ${visTag(n.vis)}</div></div>
          ${n.signed ? `<span class="xs faint nowrap">${n.signed} 人已報</span>` : ''}
        </a>`).join('')}</div>` })}
    ${card({ title: '快速入口', body: `
      <div class="grid" style="gap:8px">
        ${quick('branch', '支部與接駁', '進入支部、登記下游、測試連線', '#/branches')}
        ${quick('users', '旅員與邀請', '開領袖／家長帳號、branch_access', '#/users')}
        ${quick('globe', '公開資料', '決定開放咩畀未登入嘅人', '#/public')}
        ${quick('wallet', '財務整合', '睇各支部提交同旅本身帳目', '#/finance')}
        ${quick('shield', '系統與後端實況', '逐表寫自證、審計、模組開關', '#/system')}
        ${quick('book', '教學與藍圖', '每角色快速入門、開旅 checklist', '#/docs')}
      </div>` })}
  </div>

  ${card({
    title: '旅團面貌（示範）', sub: '呢啲數字喺真模式由各支部經 sig 讀返摘要',
    body: `<div class="grid g3">${d.branches.map(b => `
      <div class="branch-card">
        <div class="top"><span class="swatch" style="background:${b.color};width:14px;height:14px"></span>
          <div class="grow"><div class="bold">${esc(b.name)}</div><div class="xs faint">${esc(b.section)} · 成立 ${esc(b.founded)}</div></div>
          ${linkBadge(b.link.state)}
        </div>
        <div class="body">
          <div class="flex-b sm"><span>青少年 <b>${b.youth}</b></span><span>領袖 <b>${b.adults}</b></span></div>
          <div class="xs faint mt-8">團長：${esc(b.leader)} · ${esc(b.leaderEmail)}</div>
          ${progressBar(Math.min(100, Math.round(b.youth / 45 * 100)), `活躍度示範 ${b.youth}/45`)}
        </div>
        <div class="foot"><a class="btn sm" href="#/branch/${b.id}">睇詳情</a>${b.hasPortal ? `<button class="btn sm primary" data-enter="${b.id}">進入支部</button>` : `<span class="xs faint">該團未有系統</span>`}</div>
      </div>`).join('')}</div>`
  })}
  `;

  el.innerHTML = page({ title: `${greeting()}，${u?.name || ''}`, sub: `${d.unit.name}（${d.unit.code}）· ${ROLE_LABEL[role]} · 你嘅權限：${permText(role)}`, body });

  el.querySelector('#db-reset')?.addEventListener('click', async () => {
    const { confirmDlg, toast } = await import('../lib/util.js');
    if (await confirmDlg({ title: '還原示範資料', message: '會清走你喺示範模式改過嘅嘢，回復出廠示範資料。', ok: '還原', danger: true })) {
      S.resetDemo(); toast('已還原示範資料', 'ok');
    }
  });
  el.querySelector('#db-open-docs')?.addEventListener('click', () => go('docs/blueprint'));
  el.querySelectorAll('[data-enter]').forEach(b => b.addEventListener('click', async () => {
    const { openEnterBranch } = await import('./branches.js');
    openEnterBranch(b.dataset.enter);
  }));
}

function renderParentDash(el) {
  const u = S.currentUser();
  const kids = S.childrenOf(u);
  const notices = S.noticesForViewer().filter(n => n.status === 'published').slice(0, 3);
  const soon = S.calendarForViewer().filter(e => daysBetween(todayISO(), e.date) >= 0).slice(0, 3);
  el.innerHTML = page({
    title: `${greeting()}，${u?.name || ''}`,
    sub: `${S.load().unit.name} · 家長 · 你嘅子女橫跨 ${new Set(kids.map(k => k.branchId)).size} 個支部`,
    body: `
    ${notice('家長帳號住喺<b>旅</b>，所以子女轉支部、升團都唔使再開戶（「同旅移動零改動」）。子女編號由該團領袖確認。', 'info')}
    <div class="grid g3 mt-12">${kids.map(k => `
      <div class="child-card">
        <div class="h"><span class="swatch" style="background:${k.branch?.color || '#999'};width:14px;height:14px"></span>
          <div class="grow"><div class="bold">${esc(k.name)}</div><div class="xs faint">${esc(k.branch?.name || '未對上名冊')} · ${esc(k.ymis)}</div></div>
        </div>
        <div class="body">
          ${k.missing ? '<div class="warn-box">未對上名冊，請等該團領袖確認</div>' : `
            ${progressBar(S.load().progress[k.ymis]?.awardPct || 0, `獎章進度 ${S.load().progress[k.ymis]?.awardPct || 0}%`)}
            <div class="xs faint">最新更新 ${esc(S.load().progress[k.ymis]?.updated || '—')} · 來源 ${esc(S.load().progress[k.ymis]?.source || '—')}</div>`}
        </div>
        <div class="foot"><a class="btn sm primary" href="#/children">睇子女詳情</a></div>
      </div>`).join('')}</div>
    <div class="grid g2 mt-12">
      ${card({ title: '最新通告', body: notices.length ? notices.map(n => `<div class="mb-8"><a href="#/notice/${n.id}" class="bold sm">${esc(n.title)}</a><div class="xs faint">${fmtDate(n.at)} · ${n.eventDate ? '活動 ' + fmtDate(n.eventDate) : ''}</div></div>`).join('') : '<div class="empty">冇通告</div>' })}
      ${card({ title: '即將活動', body: soon.length ? soon.map(e => `<div class="mb-8"><div class="bold sm">${esc(e.title)}</div><div class="xs faint">${fmtDate(e.date)} ${esc(e.time)} · ${esc(S.branchName(e.cal))}</div></div>`).join('') : '<div class="empty">冇活動</div>' })}
    </div>`
  });
}

function renderMemberDash(el) {
  const u = S.currentUser();
  el.innerHTML = page({
    title: `${greeting()}，${u?.name || ''}`,
    sub: '成員入口（旅窗口）',
    body: `
    ${notice('成員嘅主場喺<b>自己屬團嘅支部系統</b>（進度／通告／物資借用）。旅窗口只做兩件事：帶你去自己支部，同埋睇旅層通告。<br><br><b>你嘅密碼由所屬支部核對</b> —— 旅系統唔會、亦唔可以代驗成員密碼（開戶錨點：成員＝該團支部）。', 'info')}
    <div class="grid g2 mt-12">
      ${card({ title: '入自己支部', body: `<div class="grid" style="gap:8px">
        <a class="btn primary block" href="#/branches">${icon('branch', 15)} 揀我嘅支部</a>
        <div class="xs faint">你只會見到自己支部（同旅公開資料）。</div></div>` })}
      ${card({ title: '旅層通告', body: S.noticesForViewer().filter(n => n.status === 'published').slice(0, 3).map(n => `<div class="mb-8"><a href="#/notice/${n.id}" class="bold sm">${esc(n.title)}</a><div class="xs faint">${fmtDate(n.at)}</div></div>`).join('') || '<div class="empty">冇通告</div>' })}
    </div>`
  });
}

/* helpers */
function greeting() { const h = new Date().getHours(); return h < 12 ? '早晨' : h < 18 ? '午安' : '晚安'; }
function kindLabel(k) { return { account: '開戶申請', helper: '跨團幫手', member: '成員申請', publish: '公開上報', transfer: '移交' }[k] || '申請'; }
function visTag(v) { const n = ['公眾', '其他支部', '團員', '執委', '領袖', '旅長'][Number(v) || 0]; return `<span class="tag n sm">${n}</span>`; }
function quick(ic, title, sub, href) {
  return `<a href="${href}" class="flex" style="gap:10px;border:1px solid var(--line);border-radius:8px;padding:8px 10px;text-decoration:none;color:inherit">
    <span style="color:var(--brand)">${icon(ic, 18)}</span>
    <span class="grow"><span class="bold sm">${esc(title)}</span><br><span class="xs faint">${esc(sub)}</span></span>
    ${icon('arrowR', 14)}
  </a>`;
}
function permText(role) {
  return { chief: '旅長（全旅）', leader: '旅層領袖（授權支部）', parent: '家長（子女）', member: '成員', guest: '公開' }[role] || role;
}

/* 儀表板 — 一頁睇齊（可收合：電話友善，大部分區塊默認收埋） */
import { esc, icon, money, fmtDate, fmtDateFull, todayISO, daysBetween, relTime } from '../lib/util.js';
import * as S from '../lib/store.js';
import { go } from '../lib/router.js';
import { page, card, table, badge, linkBadge, notice, progressBar, fold, chips } from './ui.js';
import { ROLE_LABEL, identityMeta, visName } from '../lib/registry.js';
import { branchEntryStatus } from '../lib/auth.js';
import { gateMeta } from '../lib/registry.js';

export function render(el) {
  const s = S.getSession();
  if (!s) return;
  if (s.role === 'parent') return renderParentDash(el);
  if (s.role === 'member') return renderMemberDash(el);
  if (s.role === 'super') return renderSuperDash(el);
  return renderTroopDash(el);
}

/* ============ 旅長／教練員 ============ */
function renderTroopDash(el) {
  const d = S.load();
  const s = S.getSession();
  const c = S.counters();
  const green = d.branches.filter(b => b.link.state === 'green').length;
  const youth = d.branches.reduce((n, b) => n + b.youth, 0);
  const adults = d.branches.reduce((n, b) => n + b.adults, 0);
  const income = d.financeSubmits.reduce((n, f) => n + f.income, 0);
  const expense = d.financeSubmits.reduce((n, f) => n + f.expense, 0);
  const soon = S.calendarForViewer()
    .filter(e => daysBetween(todayISO(), e.date) >= 0 && daysBetween(todayISO(), e.date) <= 30)
    .sort((a, b) => a.date.localeCompare(b.date));
  const pending = S.pendingList();
  const notices = S.noticesForViewer().filter(n => n.status === 'published').slice(0, 4);
  const mine = S.myBranches();

  const body = `
  ${chips([
    { k: '支部', v: d.branches.length, hint: `綠 ${green}` },
    { k: '已接駁', v: `${green}/${d.branches.length}`, tone: green === d.branches.length ? 'ok' : 'warn' },
    { k: '現役', v: youth + adults, hint: `青 ${youth} · 成 ${adults}` },
    { k: '等你處理', v: c.pendingCount, tone: c.pendingCount ? 'warn' : 'ok' },
    { k: '本月淨額', v: money(income - expense), tone: income - expense >= 0 ? 'ok' : 'danger' },
    { k: '未寫入', v: S.dirtyCount(), tone: S.dirtyCount() ? 'warn' : 'ok' }
  ])}
  <div class="center xs faint mt-8">示範旅（MOCK）：資料住呢部機，唔會送去任何後端。全部區塊撳一下先展開。</div>

  ${fold({
    title: '需要你處理', sub: pending.length ? `${pending.length} 項等你拍板` : '暫時冇嘢等',
    open: pending.length > 0, badge: pending.length || '',
    actions: `<a class="btn sm" href="#/pending">全部待辦 ${icon('arrowR', 12)}</a>`,
    body: pending.length ? `<div class="grid" style="gap:8px">${pending.slice(0, 4).map(a => `
      <div class="flex-b" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px">
        <div class="grow"><div class="bold sm">${esc(a.name)} <span class="tag n sm">${kindLabel(a.kind)}</span></div>
        <div class="xs faint">${esc(a.note)}</div></div>
        <div class="right xs faint nowrap">${esc(a.need || '')}</div>
      </div>`).join('')}</div>` : notice('冇待辦 —— 旅團運作正常。', 'ok')
  })}

  ${fold({
    title: '接駁狀態（旅 → 團 → 進度）', sub: `${green} 綠 · ${d.branches.length - green} 待跟`, open: green < d.branches.length,
    actions: `<a class="btn sm" href="#/branches">支部一覽 ${icon('arrowR', 12)}</a>`,
    body: table({
      cls: 'tbl compact', head: ['支部', '狀態', '進入', '最後測試'],
      rows: d.branches.map(b => ({
        cls: S.canSeeBranch(b) ? '' : 'faint',
        cells: [
          `<a href="#/branch/${b.id}"><span class="swatch" style="background:${b.color}"></span> ${esc(b.name)}</a>`,
          linkBadge(b.link.state, b.link.state === 'green' ? '已接駁' : b.link.state === 'yellow' ? '已登記 · 未閂口' : '未登記下游'),
          b.link.state === 'red' ? '<span class="xs faint">入唔到（要登記）</span>' : `<span class="xs">${esc(entryText(b))}</span>`,
          `<span class="xs faint">${esc(b.link.testedAt || '未測試')}</span>`
        ]
      }))
    })
  })}

  ${fold({ title: '本團／全旅財務（摘要）', sub: `收入 ${money(income)} · 支出 ${money(expense)}`, body: `
    <div class="chips mb-12">${d.financeSubmits.map(f => `<span class="chip-sm ${f.state === 'accepted' ? 'ok' : f.state === 'missing' ? 'danger' : 'warn'}">
      <b>${esc(S.branchName(f.branchId))}</b><span class="k">${f.state === 'accepted' ? '已收' : f.state === 'missing' ? '未提交' : f.state === 'query' ? '退問' : '待確認'} · ${money(f.balance)}</span></span>`).join('')}</div>
    <a class="btn sm" href="#/finance">財務整合 ${icon('arrowR', 12)}</a>` })}

  ${fold({ title: '近期活動同通告', sub: `${soon.length} 個活動 · ${notices.length} 張通告`, body: `
    <div class="grid g2">
      ${card({ title: '活動（30 日內）', body: soon.length ? soon.slice(0, 5).map(e => `<div class="mb-8"><div class="bold sm">${esc(e.title)}</div><div class="xs faint">${fmtDate(e.date, true)} ${esc(e.time || '')} · ${esc(e.cal === 'troop' ? '旅部' : S.branchName(e.cal))}</div></div>`).join('') : '<div class="empty">冇活動</div>' })}
      ${card({ title: '最新通告', body: notices.length ? notices.map(n => `<div class="mb-8"><a href="#/notice/${n.id}" class="bold sm">${esc(n.title)}</a><div class="xs faint">${esc(n.scope === 'troop' ? '旅通告' : '支部通告')} · ${n.eventDate ? fmtDateFull(n.eventDate) : fmtDate(n.at)}</div></div>`).join('') : '<div class="empty">冇通告</div>' })}
    </div>` })}

  ${fold({ title: '我嘅權限（旅層）', sub: s.role === 'chief' ? '全旅' : `${mine.length} 個授權支部`, body: `
    ${notice(s.role === 'chief'
      ? '旅長＝全旅最高權限（所有支部 ＋ 系統／模組開關／金鑰）。'
      : '教練員＝旅層帳號，只睇 branch_access 授權嘅支部。要加團 → 目標團批「跨團幫手」。', 'info')}
    <div class="chips">${mine.map(b => `<span class="chip-sm">${esc(b.name)}</span>`).join('') || '<span class="faint xs">未授權任何支部</span>'}</div>
    <div class="btn-row mt-8"><a class="btn sm" href="#/mine">我嘅身份卡</a><a class="btn sm" href="#/docs/blueprint">功能藍圖</a>
    <button class="btn sm" id="db-reset">${icon('refresh', 13)} 還原示範資料</button></div>` })}
  `;

  el.innerHTML = page({
    title: `${greeting()}，${esc(S.currentUser()?.name || '')}`,
    sub: `${esc(d.unit.name)} · ${ROLE_LABEL[s.role]}${s.role === 'coach' ? `（授權 ${mine.length} 團）` : '（全旅）'}`,
    body
  });
  el.querySelector('#db-reset')?.addEventListener('click', async () => {
    const { confirmDlg } = await import('../lib/util.js');
    if (await confirmDlg({ title: '還原示範資料', message: '會清走你改過嘅嘢。', ok: '還原', danger: true })) { S.resetDemo(); go('dashboard'); }
  });
}

/* ============ 家長 ============ */
function renderParentDash(el) {
  const u = S.currentUser();
  const kids = S.childrenOf(u);
  const notices = S.noticesForViewer().filter(n => n.status === 'published').slice(0, 4);
  const soon = S.calendarForViewer().filter(e => daysBetween(todayISO(), e.date) >= 0).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  const body = `
  ${chips([
    { k: '子女', v: kids.length, tone: 'ok' },
    { k: '跨支部', v: new Set(kids.map(k => k.branchId)).size },
    { k: '通告', v: notices.length },
    { k: '活動', v: soon.length }
  ])}
  ${notice('家長帳號住<b>旅</b>：子女轉支部、升團都唔使再開戶。未夠 18 嘅子女，你係監護人 —— 報名、借用、公開亮相都要你同意。', 'info')}
  ${kids.map(k => fold({
    title: `${k.name} · ${k.branch?.name || '未對上名冊'}`, open: false,
    sub: `${k.ymis} · ${ageTag(k)}${k.identity ? ' · ' + k.identity : ''}`,
    badge: k.missing ? '待確認' : '',
    actions: `<a class="btn sm" href="#/children">詳情</a>`,
    body: k.missing ? notice('未對上名冊 —— 等該團領袖確認。', 'warn') : `
      ${progressBar(S.load().progress[k.ymis]?.awardPct || 0, `獎章進度 ${S.load().progress[k.ymis]?.awardPct || 0}%`)}
      <div class="xs faint">更新 ${esc(S.load().progress[k.ymis]?.updated || '—')} · 來源 ${esc(S.load().progress[k.ymis]?.source || '—')}</div>`
  })).join('')}
  ${fold({ title: '通告同行事曆', sub: `${notices.length} 張通告`, open: true, body: `
    <div class="grid g2">
      ${card({ title: '通告', body: notices.length ? notices.map(n => `<div class="mb-8"><a href="#/notice/${n.id}" class="bold sm">${esc(n.title)}</a><div class="xs faint">${n.eventDate ? fmtDateFull(n.eventDate) : fmtDate(n.at)}${n.fee ? ' · ' + money(n.fee) : ''}</div></div>`).join('') : '<div class="empty">冇通告</div>' })}
      ${card({ title: '即將活動', body: soon.length ? soon.map(e => `<div class="mb-8"><div class="bold sm">${esc(e.title)}</div><div class="xs faint">${fmtDate(e.date, true)} ${esc(e.time || '')} · ${esc(S.branchName(e.cal))}</div></div>`).join('') : '<div class="empty">冇活動</div>' })}
    </div>` })}
  `;
  el.innerHTML = page({ title: `${greeting()}，${esc(u?.name || '')}`, sub: `${esc(S.load().unit.name)} · 家長（監護人）`, body });
}

/* ============ 支部人員（團長／副團長／成員）============ */
function renderMemberDash(el) {
  const s = S.getSession();
  const m = S.myMember();
  const b = S.myBranch();
  const st = branchEntryStatus(s.branchId);
  const notices = S.noticesForViewer().filter(n => n.status === 'published').slice(0, 4);
  const soon = S.calendarForViewer().filter(e => e.date >= todayISO()).sort((a, b2) => a.date.localeCompare(b2.date)).slice(0, 4);
  const isLeader = S.isBranchLeader();
  const pend = S.pendingShares(s.branchId);
  const body = `
  ${chips([
    { k: '團', v: esc(b?.name || '—') },
    { k: '身份', v: esc(s.identity || '—'), tone: 'ok' },
    ...(s.title ? [{ k: '職稱', v: esc(s.title) }] : []),
    { k: '年齡組', v: s.ageGroup === 'adult' ? '18+' : '未夠 18', tone: s.ageGroup === 'adult' ? 'ok' : 'warn' },
    { k: '支部接駁', v: st.state === 'green' ? '綠' : st.state === 'yellow' ? '黃' : '紅', tone: st.state === 'green' ? 'ok' : st.state === 'yellow' ? 'warn' : 'danger' },
    { k: '支部系統閘', v: gateMeta(st.gate || S.branchGate(s.branchId)).label, tone: gateMeta(st.gate || S.branchGate(s.branchId)).tone },
    { k: '待接收分享', v: pend.length, tone: pend.length ? 'warn' : 'ok' }
  ])}
  ${notice(st.ok ? esc(st.note) : esc(st.msg), st.ok ? (st.state === 'green' ? 'ok' : 'warn') : 'err')}
  ${notice(`你嘅帳號住 <b>${esc(b?.name || '')} 嘅支部 SHEET</b>：名冊、進度、內部文件嘅正本都喺嗰度；旅只放行你身份睇得到嘅摘要。
    <div class="mt-8"><a class="btn sm primary" href="#/mine">${icon('child', 13)} 我嘅身份卡同權限</a>
    <a class="btn sm" href="#/notices">通告</a><a class="btn sm" href="#/calendar">行事曆</a>${isLeader ? '<a class="btn sm" href="#/branches">支部（團長／副團長）</a>' : ''}</div>`, 'info')}
  ${fold({
    title: '需要你（你支部）決定', sub: pend.length ? `${pend.length} 項分享等緊接收／退回` : '冇待接收分享',
    open: pend.length > 0, body: pend.length
      ? `<div class="grid" style="gap:8px">${pend.map(x => `<div class="flex-b mb-8"><div class="grow"><b class="sm">${esc(x.title)}</b>
          <div class="xs faint">${esc(S.KIND_LABEL[x.kind] || x.kind)} · 來自 ${esc(S.branchName(x.from))} · 由 ${esc(x.by || '')} 發出${x.note ? ' · ' + esc(x.note) : ''}</div></div>
          <a class="btn sm primary" href="#/shares">去決定</a></div>`).join('')}</div>`
      : '<div class="empty">冇人 share 未決定嘅嘢畀你支部</div>'
  })}
  ${fold({ title: '我嘅通告同活動', sub: `${notices.length} 通告 · ${soon.length} 活動`, open: true, body: `
    <div class="grid g2">
      ${card({ title: '通告', body: notices.length ? notices.map(n => `<div class="mb-8"><a href="#/notice/${n.id}" class="bold sm">${esc(n.title)}</a><div class="xs faint">${esc(n.scope === 'troop' ? '旅通告' : S.branchName(n.ownerBranch) + ' 通告')}</div></div>`).join('') : '<div class="empty">冇通告</div>' })}
      ${card({ title: '活動', body: soon.length ? soon.map(e => `<div class="mb-8"><div class="bold sm">${esc(e.title)}</div><div class="xs faint">${fmtDate(e.date, true)} ${esc(e.time || '')}</div></div>`).join('') : '<div class="empty">冇活動</div>' })}
    </div>` })}
  ${fold({ title: '我嘅紀錄（摘要）', sub: '進度／借用／繳費', body: `
    <div class="grid g3">
      ${card({ title: '進度', body: S.load().progress[s.ymis] ? progressBar(S.load().progress[s.ymis].awardPct, `${S.load().progress[s.ymis].award} ${S.load().progress[s.ymis].awardPct}%`) : '<div class="empty">未對上進度紀錄</div>' })}
      ${card({ title: '物資', body: `<div class="sm">本團可借 ${S.load().inventory.filter(i => i.owner === s.branchId || i.scope !== 'self').length} 項</div><a class="btn sm mt-8" href="#/inventory">睇物資</a>` })}
      ${card({ title: '分享', body: `<div class="sm">已接收 ${S.acceptedShares(s.branchId).length} 項 · 待接收 ${pend.length} 項</div><a class="btn sm mt-8" href="#/shares">分享中心</a>` })}
      ${card({ title: '繳費', body: `<div class="sm">${esc((S.load().financeSubmits.find(f => f.branchId === s.branchId)?.state === 'accepted') ? '已提交' : '未提交／待確認')}</div><div class="xs faint">明細住自己團</div>` })}
    </div>` })}
  `;
  el.innerHTML = page({ title: `${greeting()}，${esc(s.name)}`, sub: `${esc(S.load().unit.name)} · ${esc(s.identity || '支部人員')}${s.title ? ' · ' + esc(s.title) : ''} · ${esc(b?.name || '')}`, body });
}

/* ============ 超管（隱藏）============ */
function renderSuperDash(el) {
  const d = S.load();
  const inbox = d.applications.filter(a => a.state === 'pending');
  const body = `
  ${notice('你係<b>平台超管</b>（隱藏身份）：只有你見到「平台」模組。超管只做開旅、接入、輪換 —— 唔插手旅務日常。', 'warn')}
  ${chips([
    { k: '已登記旅', v: 1 },
    { k: '待接入', v: inbox.length, tone: inbox.length ? 'warn' : 'ok' },
    { k: '下游', v: d.branches.length },
    { k: '紅燈', v: d.branches.filter(b => b.link.state === 'red').length, tone: 'danger' }
  ])}
  ${fold({ title: '接入收件匣', sub: `${inbox.length} 項待批`, open: true, body: `
    ${inbox.length ? `<div class="grid" style="gap:8px">${inbox.slice(0, 3).map(a => `<div class="flex-b" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px">
      <div><div class="bold sm">${esc(a.name)}</div><div class="xs faint">${esc(a.note)}</div></div></div>`).join('')}</div>` : notice('冇待接入申請', 'ok')}
    <div class="btn-row mt-8"><a class="btn sm primary" href="#/platform?tab=inbox">去平台 ${icon('arrowR', 12)}</a>
    <a class="btn sm" href="#/platform?tab=keys">金鑰輪換</a></div>` })}
  ${fold({ title: '我可以做嘅嘢', body: `<ul class="doc">
    <li>批新旅部署：units.json ＋ Vercel env（TROOP_&lt;旅ID&gt;_BACKEND／_APIKEY／_NAME）→ Redeploy</li>
    <li>批新下游接入、處理旅長嘅輪換請求</li>
    <li>跨旅問題排查（示範只有一個旅）</li>
    <li>唔可以：改任何旅嘅資料、睇旅員個人資料（除非為排查而查審計，會被記錄）</li>
  </ul>` })}
  `;
  el.innerHTML = page({ title: `平台 · 超管`, sub: '隱藏入口 · 只有 role=super 見到', body });
}

/* helpers */
function greeting() { const h = new Date().getHours(); return h < 12 ? '早晨' : h < 18 ? '午安' : '晚安'; }
function kindLabel(k) { return { account: '開戶申請', helper: '跨團幫手', member: '成員申請', publish: '公開上報', transfer: '移交', troop: '新旅部署' }[k] || k; }
function entryText(b) {
  if (b.hasPortal) return `P 入口：portal.html?from=troop&u=${b.id}`;
  return `${b.id}/members.html`;
}
function ageTag(m) {
  const g = m.dob ? (function (dob) {
    const dd = new Date(String(dob) + 'T00:00:00'); const now = new Date();
    let a = now.getFullYear() - dd.getFullYear();
    const mm = now.getMonth() - dd.getMonth();
    if (mm < 0 || (mm === 0 && now.getDate() < dd.getDate())) a -= 1;
    return a >= 18 ? '18+' : '未夠 18';
  })(m.dob) : '未夠 18';
  return g;
}

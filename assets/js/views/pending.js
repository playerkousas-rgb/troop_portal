/* 待辦與批核 — 所有等旅長／旅層領袖拍板嘅事集中一頁 */
import { esc, icon, fmtDate, toast, promptDlg } from '../lib/util.js';
import * as S from '../lib/store.js';
import { go } from '../lib/router.js';
import { page, card, table, badge, notice, tabs, stat } from './ui.js';

const KINDS = [
  { id: 'all', label: '全部' },
  { id: 'account', label: '開戶申請' },
  { id: 'member', label: '成員申請' },
  { id: 'helper', label: '跨團幫手' },
  { id: 'publish', label: '公開上報' },
  { id: 'finance', label: '財務提交' },
  { id: 'transfer', label: '移交接收' }
];

export function render(el, params, query = {}) {
  const d = S.load();
  const kind = query.kind || 'all';

  const items = [];
  d.applications.forEach(a => items.push({ kind: a.kind, at: a.at, name: a.name, sub: a.note, need: a.need, state: a.state, id: a.id, src: 'applications' }));
  d.financeSubmits.filter(f => f.state !== 'accepted' && f.state !== 'missing').forEach(f => items.push({
    kind: 'finance', at: f.at, name: S.branchName(f.branchId), sub: `財務提交 ${f.period}：收入 $${f.income}、支出 $${f.expense}`,
    need: f.state === 'query' ? '等你覆核（已退問）' : '等你確認', state: f.state === 'query' ? 'query' : 'pending', id: f.id, src: 'finance'
  }));
  d.financeSubmits.filter(f => f.state === 'missing').forEach(f => items.push({
    kind: 'finance', at: '—', name: S.branchName(f.branchId), sub: `本月未提交財務摘要（截止每月 ${d.settings.financeDueDay} 號）`,
    need: '追提交', state: 'missing', id: f.id, src: 'finance'
  }));
  d.transfers.filter(t => t.state === 'pending').forEach(t => items.push({
    kind: 'transfer', at: t.at, name: `${t.name}（${t.scoutId}）`, sub: `${S.branchName(t.from)} → ${S.branchName(t.to)} · ${t.reason}`,
    need: '目標團領袖接收', state: 'pending', id: t.id, src: 'transfer'
  }));
  d.inventory.forEach(i => (i.loans || []).filter(l => l.state === 'pending').forEach(l => items.push({
    kind: 'loan', at: l.at, name: `${i.name} ×${l.qty}`, sub: `${S.branchName(l.to)} 借用（負責人 ${l.by}）`,
    need: '物主批核', state: 'pending', id: i.id, src: 'loan'
  })));

  const pending = items.filter(i => i.state !== 'done');
  const shown = kind === 'all' ? pending : pending.filter(i => i.kind === kind);
  const counts = k => pending.filter(i => k === 'all' || i.kind === k).length;

  const body = `
  ${notice('每人只做自己嗰格：<b>成員戶、名冊、通告</b>屬支部；<b>領袖／家長戶、跨團權限、公開上報、財務確認</b>屬旅層。跨團幫手一定要<b>目標團批</b>，唔可以由旅長繞過。', 'info')}
  <div class="grid g4 mt-12">
    ${stat({ k: '等你處理', v: pending.length, u: '項', tone: pending.length ? 'warn' : 'ok' })}
    ${stat({ k: '開戶／成員申請', v: counts('account') + counts('member'), u: '項' })}
    ${stat({ k: '財務待跟', v: counts('finance'), u: '項' })}
    ${stat({ k: '跨團／移交', v: counts('helper') + counts('transfer'), u: '項' })}
  </div>
  ${tabs(KINDS.map(k => ({ id: k.id, label: k.label, badge: counts(k.id) || '' })), kind)}
  ${card({
    body: table({
      head: ['申請人／來源', '內容', '卡喺邊', '時間', '動作'],
      rows: shown.map(i => ({
        cells: [
          `<b>${esc(i.name)}</b><div class="xs faint">${esc({ account: '開戶申請', member: '成員申請', helper: '跨團幫手', publish: '公開上報', finance: '財務', transfer: '移交', loan: '物資借用' }[i.kind] || i.kind)}</div>`,
          `${esc(i.sub)}`,
          `<span class="tag n sm">${esc(i.need || '—')}</span>`,
          `<span class="xs faint">${esc(i.at || '—')}</span>`,
          `<div class="btn-row">
            <button class="btn xs primary" data-act="approve" data-id="${i.id}" data-src="${i.src}">批准</button>
            <button class="btn xs danger" data-act="reject" data-id="${i.id}" data-src="${i.src}">拒絕</button>
            ${i.src === 'finance' ? `<button class="btn xs" data-act="ask" data-id="${i.id}">退問</button>` : ''}
          </div>`
        ]
      })),
      empty: '呢一類暫時冇待辦'
    })
  })}
  `;
  el.innerHTML = page({ title: '待辦與批核', sub: `${pending.length} 項待處理`, body });

  el.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => go(`pending?kind=${t.dataset.tab}`)));
  el.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => act(b.dataset.act, b.dataset.id, b.dataset.src)));
}

async function act(what, id, src) {
  const d = S.load();
  const app = d.applications.find(a => a.id === id);
  const fin = d.financeSubmits.find(f => f.id === id);
  const label = app?.name || (fin ? S.branchName(fin.branchId) : id);

  if (what === 'reject') {
    const reason = await promptDlg({ title: `拒絕 · ${label}`, label: '原因（會通知申請人）', placeholder: '例：名冊對唔上／重複申請' });
    if (!reason) return;
    if (app) S.commit(x => { const a = x.applications.find(y => y.id === id); if (a) { a.state = 'rejected'; a.decidedBy = S.currentUser()?.name; a.decidedAt = new Date().toISOString().slice(0, 10); a.reason = reason; } });
    if (fin) S.commit(x => { const f = x.financeSubmits.find(y => y.id === id); if (f) { f.state = 'query'; f.query = reason; } });
    S.audit('拒絕申請', label, reason);
    toast('已拒絕並記錄原因', 'warn');
    return;
  }
  if (what === 'ask') {
    const reason = await promptDlg({ title: `退問 · ${label}`, label: '退問內容' });
    if (!reason) return;
    S.commit(x => { const f = x.financeSubmits.find(y => y.id === id); if (f) { f.state = 'query'; f.query = reason; } });
    S.audit('財務退問', label, reason);
    toast('已退問', 'warn');
    return;
  }
  // 批准
  if (app) {
    S.commit(x => {
      const a = x.applications.find(y => y.id === id);
      if (a) { a.state = 'approved'; a.decidedBy = S.currentUser()?.name; a.decidedAt = new Date().toISOString().slice(0, 10); }
      if (a?.kind === 'account' && a.email) {
        x.users.push({ id: 'u-' + Date.now(), role: a.ymis ? 'leader' : 'parent', name: a.name, email: a.email, phone: '', title: a.ymis ? '領袖' : '家長', branchAccess: [], children: [], status: 'active', mustChangePw: true, at: new Date().toISOString().slice(0, 16).replace('T', ' '), lastLogin: '—' });
      }
      if (a?.kind === 'helper') {
        const u = x.users.find(y => y.email === a.email);
        if (u && !u.branchAccess.includes(a.toBranch)) u.branchAccess.push(a.toBranch);
      }
    });
    S.audit('批准申請', label, app.kind);
    toast(`已批准：${label}（已發邀請連結／已加 branch_access）`, 'ok');
  }
  if (fin) {
    S.commit(x => { const f = x.financeSubmits.find(y => y.id === id); if (f) { f.state = 'accepted'; f.query = ''; } });
    S.audit('確認財務提交', label, fin.period);
    toast('已確認財務摘要', 'ok');
  }
}

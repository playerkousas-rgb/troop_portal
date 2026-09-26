/* 待辦與批核 — 所有等旅長／教練員拍板嘅事集中一頁（團內批核由團長喺自己支部做） */
import { esc, icon, fmtDate, toast, promptDlg, confirmDlg } from '../lib/util.js';
import { rescueKindMeta } from '../lib/registry.js';
import * as S from '../lib/store.js';
import * as API from '../lib/api.js';
import { go } from '../lib/router.js';
import { page, card, table, badge, notice, tabs, stat } from './ui.js';

const KINDS = [
  { id: 'all', label: '全部' },
  { id: 'account', label: '開戶申請' },
  { id: 'member', label: '成員申請' },
  { id: 'helper', label: '跨團幫手' },
  { id: 'publish', label: '公開上報' },
  { id: 'finance', label: '財務提交' },
  { id: 'transfer', label: '移交接收' },
  { id: 'bind', label: '子女綁定' },
  { id: 'rescue', label: '🆘 求救' }
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
  /* 家長子女綁定（kind=bind）：一定要該團領袖確認先睇到 —— 唔會自己批自己 */
  d.applications.filter(a => a.kind === 'bind').forEach(a => items.push({
    kind: 'bind', at: a.at, name: `${a.name}（家長）`,
    sub: `申請綁定子女 <b>${esc(a.ymis)}</b>${a.title ? `（名冊：${esc(a.title)}）` : '（⚠️ 名冊對唔上）'}${a.branchId ? ` · ${esc(S.branchName(a.branchId))}` : ''}`,
    need: '該團領袖確認（防亂認人仔）', state: a.state, id: a.id, src: 'applications'
  }));
  d.transfers.filter(t => t.state === 'pending').forEach(t => items.push({
    kind: 'transfer', at: t.at, name: `${t.name}（${t.scoutId}）`, sub: `${S.branchName(t.from)} → ${S.branchName(t.to)} · ${t.reason}`,
    need: '目標團領袖接收', state: 'pending', id: t.id, src: 'transfer'
  }));
  d.inventory.forEach(i => (i.loans || []).filter(l => l.state === 'pending').forEach(l => items.push({
    kind: 'loan', at: l.at, name: `${i.name} ×${l.qty}`, sub: `${S.branchName(l.to)} 借用（負責人 ${l.by}）`,
    need: '物主批核', state: 'pending', id: i.id, src: 'loan'
  })));
  /* 🆘 求救（免登入送嚟）：ADMIN 人手核實身份先做，唔會自動開任何嘢 */
  (d.rescues || []).filter(r => r.state !== 'done').forEach(r => items.push({
    kind: 'rescue', at: r.at, name: `${r.by}${r.branchId ? `（${S.branchName(r.branchId)}）` : ''}`,
    sub: `🆘 <b>${r.title || '（未填標題）'}</b>　嚴重度：${r.severity || '—'}　${rescueKindMeta(r.kind).label}：${r.note || '—'}　聯絡：${r.contact}`,
    need: 'ADMIN 人手核實身份後處理', state: 'pending', id: r.id, src: 'rescue'
  }));

  const pending = items.filter(i => i.state !== 'done');
  const shown = kind === 'all' ? pending : pending.filter(i => i.kind === kind);
  const counts = k => pending.filter(i => k === 'all' || i.kind === k).length;

  const body = `
  ${notice('每人只做自己嗰格：<b>成員戶、名冊、通告</b>屬支部；<b>領袖／家長戶、跨團權限、公開上報、財務確認</b>屬旅層。跨團幫手一定要<b>目標團批</b>，唔可以由旅長繞過。', 'info')}
  <div class="grid g4 mt-12">
    ${stat({ k: '等你處理', v: pending.length, u: '項', tone: pending.length ? 'warn' : 'ok' })}
    ${stat({ k: '開戶／成員申請', v: counts('account') + counts('member'), u: '項', hint: `子女綁定 ${counts('bind')} 項` })}
    ${stat({ k: '財務待跟', v: counts('finance'), u: '項' })}
    ${stat({ k: '跨團／移交', v: counts('helper') + counts('transfer'), u: '項' })}
    ${stat({ k: '🆘 求救', v: counts('rescue'), u: '單', tone: counts('rescue') ? 'warn' : 'ok', hint: '免登入送得；要人手核實身份先做' })}
  </div>
  ${counts('rescue') ? notice(`🆘 有 <b>${counts('rescue')}</b> 張求救單等你：處理＝<b>開返支部系統登入</b>／<b>重設密碼</b>／<b>答覆並結案</b>（全部人手做、逐單留紀錄）。求救唔會自動開任何嘢。`, 'warn') : ''}
  ${tabs(KINDS.map(k => ({ id: k.id, label: k.label, badge: counts(k.id) || '' })), kind)}
  ${card({
    body: table({
      head: ['申請人／來源', '內容', '卡喺邊', '時間', '動作'],
      rows: shown.map(i => ({
        cells: [
          `<b>${esc(i.name)}</b><div class="xs faint">${esc({ account: '開戶申請', member: '成員申請', helper: '跨團幫手', publish: '公開上報', finance: '財務', transfer: '移交', loan: '物資借用', rescue: '🆘 求救（免登入）' }[i.kind] || i.kind)}</div>`,
          `${esc(i.sub)}`,
          `<span class="tag n sm">${esc(i.need || '—')}</span>`,
          `<span class="xs faint">${esc(i.at || '—')}</span>`,
          `<div class="btn-row">
            ${i.src === 'rescue' ? `
              <button class="btn xs primary" data-act="open-gate" data-id="${i.id}" data-src="rescue">開返支部系統登入</button>
              <button class="btn xs" data-act="reset-pw" data-id="${i.id}" data-src="rescue">重設密碼</button>
              <button class="btn xs" data-act="reply" data-id="${i.id}" data-src="rescue">答覆並結案</button>`
            : `
            <button class="btn xs primary" data-act="approve" data-id="${i.id}" data-src="${i.src}">批准</button>
            <button class="btn xs danger" data-act="reject" data-id="${i.id}" data-src="${i.src}">拒絕</button>
            ${i.src === 'finance' ? `<button class="btn xs" data-act="ask" data-id="${i.id}">退問</button>` : ''}`}
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
  /* 🆘 求救：三個動作都係人手做，做完留紀錄（同支部頁共用 store 函式） */
  if (src === 'rescue') {
    const r = S.rescueById(id);
    if (!r) return;
    const bName = r.branchId ? S.branchName(r.branchId) : '（未指明支部）';
    if (what === 'open-gate') {
      const ok = await confirmDlg({
        title: `開返「支部系統自己登入」· ${bName}`,
        message: `求救：<b>${esc(r.by)}</b>（${esc(r.contact)}）· ${esc(rescueKindMeta(r.kind).label)}<br><div class="xs faint">${esc(r.note || '')}</div><br>會發 <span class="mono">sig setGate gate=open</span>。<div class="xs faint mt-8">身份要自己核實（求救單冇驗身份）。</div>`,
        ok: '開返'
      });
      if (!ok) return;
      const res = S.resolveRescue(id, { action: 'open-gate' });
      if (!res.ok) { toast(res.msg, 'err', '', null, 6000); return; }
      S.audit('求救處理：開返支部系統登入', bName, `求救單 ${id} · ${r.by}`, 'sig');
      toast('已開返：下游回 confirmed', 'ok', '', null, 5000);
    } else if (what === 'reset-pw') {
      const acc = await promptDlg({ title: `重設密碼 · ${bName}`, label: '帳號（email 或 YMIS）', hint: '成員戶真模式要該團團長執行（帳號住該團）' });
      if (!acc) return;
      const res = S.resolveRescue(id, { action: 'reset-pw', account: acc });
      if (!res.ok) { toast(res.msg, 'err', '', null, 6000); return; }
      S.audit('求救處理：重設密碼', acc, `求救單 ${id} · 臨時密碼已發（首登強制改）`, 'UI');
      toast(`已重設：臨時密碼 ${res.tempPw}（示範）—— 首登強制改；記得核實身份先講`, 'ok', '', null, 7000);
    } else {
      const reply = await promptDlg({ title: `答覆 · ${bName}`, label: '答覆內容（求救紀錄會留住）' });
      if (!reply) return;
      const res = S.resolveRescue(id, { action: 'reply', reply });
      if (!res.ok) { toast(res.msg, 'err'); return; }
      S.audit('求救處理：答覆結案', bName, `求救單 ${id}；回覆：${reply}`, 'UI');
      toast('已答覆並結案', 'ok');
    }
    go('pending?kind=rescue');
    return;
  }
  const app = d.applications.find(a => a.id === id);
  const fin = d.financeSubmits.find(f => f.id === id);
  const label = app?.name || (fin ? S.branchName(fin.branchId) : id);

  if (what === 'reject') {
    const reason = await promptDlg({ title: `拒絕 · ${label}`, label: '原因（會通知申請人）', placeholder: app?.kind === 'bind' ? '例：名冊冇呢個編號／請用監護人 email' : '例：名冊對唔上／重複申請' });
    if (!reason) return;
    if (app && app.kind === 'bind' && API.isLive()) {
      const r = await API.decideBind({ id, decide: 'reject', reason });
      if (!r.ok) return toast(`拒唔到（${r.msg || r.code}）`, 'err', '', null, 6000);
    }
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
  if (app && app.kind === 'bind') {
    /* 子女綁定：確認＝寫落家長戶嘅 children（真模式由 GAS 寫；示範模式本機寫） */
    let res = null;
    if (API.isLive()) {
      res = await API.decideBind({ id, decide: 'approve' });
      if (!res.ok) return toast(`確認唔到（${res.msg || res.code}）`, 'err', '', null, 6000);
    }
    S.commit(x => {
      const a = x.applications.find(y => y.id === id);
      if (a) { a.state = 'approved'; a.decidedBy = S.currentUser()?.name; a.decidedAt = new Date().toISOString().slice(0, 10); a.note = `已綁定（children 已加 ${a.ymis}）`; }
      const p = x.users.find(y => String(y.email || '').toLowerCase() === String(app.email || '').toLowerCase() && y.role === 'parent');
      if (p) { p.children = Array.from(new Set([...(p.children || []), app.ymis])); }
    });
    S.audit('確認子女綁定', `${app.ymis}`, `家長 ${app.email}${res?.ok ? '（真模式：已寫旅 SHEET）' : '（示範）'}`);
    toast(`已確認：${app.name} 而家睇得到子女 ${app.ymis}${res?.ok ? '' : '（示範）'}`, 'ok', '', null, 5500);
    go('pending?kind=bind');
    return;
  }
  if (app) {
    S.commit(x => {
      const a = x.applications.find(y => y.id === id);
      if (a) { a.state = 'approved'; a.decidedBy = S.currentUser()?.name; a.decidedAt = new Date().toISOString().slice(0, 10); }
      if (a?.kind === 'account' && a.email) {
        const isBranchPerson = !!a.ymis;
        x.users.push({
          id: 'u-' + Date.now(), role: isBranchPerson ? 'member' : 'parent', name: a.name, email: a.email, phone: '',
          title: isBranchPerson ? '支部人員' : '家長', branchId: isBranchPerson ? (a.branchId || '') : '',
          ymis: isBranchPerson ? a.ymis : '', identity: isBranchPerson ? '團員' : '', ageGroup: 'minor',
          anchor: isBranchPerson ? '該團支部 SHEET' : '旅 SHEET',
          branchAccess: isBranchPerson && a.branchId ? [a.branchId] : [], children: [],
          status: 'active', mustChangePw: true, at: new Date().toISOString().slice(0, 16).replace('T', ' '), lastLogin: '—'
        });
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

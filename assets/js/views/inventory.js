/* 物資整合 — 共享範圍、借用路由去 owner、庫存自動加減（獨立分頁） */
import { esc, icon, toast, fmtDate } from '../lib/util.js';
import * as S from '../lib/store.js';
import { go } from '../lib/router.js';
import { page, card, table, badge, notice, tabs, stat, modal, kv } from './ui.js';
import { can, cacheLabel } from '../lib/registry.js';

/** ★ Q4 定案（2026-09-26）：分層 cache —— 財務／物資／進度 = 30 分鐘，通告／活動／點名 = 5 分鐘 */
function cacheBar(moduleId, canForce = S.getSession()?.role === 'chief') {
  return `<div class="flex-b mb-12" style="gap:8px">
    <span class="xs faint">${esc(cacheLabel(moduleId))}</span>
    ${canForce ? `<button class="btn xs" data-force-refresh="${moduleId}">${icon('refresh', 12)} 強制刷新（清 cache 再拉）</button>` : ''}
  </div>`;
}

export function render(el, params, query = {}) {
  const tab = query.tab || 'list';
  const d = S.load();
  const role = S.getSession()?.role;
  const canEdit = can(role, 'inventory_all');
  const loanPending = d.inventory.reduce((n, i) => n + (i.loans || []).filter(l => l.state === 'pending').length, 0);

  const tabsHtml = `<div class="tabs">
    ${[['list', '物資清單'], ['loans', '借用與歸還'], ['share', '共享設定']].map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}${k === 'loans' && loanPending ? ` <span class="tag gold sm">${loanPending}</span>` : ''}</button>`).join('')}
  </div>`;

  let body = '';
  if (tab === 'list') {
    body = `
    ${notice('物資係<b>共享</b>嘅：顯示所屬支部 ＋ 申請借用（路由去 <b>owner</b> 批核，紀錄雙邊可見，批准自動扣庫存、歸還自動回補）。旅長睇晒所有支部嘅物資。', 'info')}
    ${cacheBar('inventory')}
    <div class="grid g4 mt-12">
      ${stat({ k: '物資種類', v: d.inventory.length, u: '種' })}
      ${stat({ k: '共享中', v: d.inventory.filter(i => i.state === 'shared').length, u: '種', tone: 'ok' })}
      ${stat({ k: '借出中', v: d.inventory.reduce((n, i) => n + i.out, 0), u: '件' })}
      ${stat({ k: '等你批', v: loanPending, u: '項', tone: loanPending ? 'warn' : 'ok' })}
    </div>
    ${card({ title: '物資清單', actions: canEdit ? `<button class="btn sm primary" id="inv-add">${icon('plus', 13)} 新增物資</button>` : '', body: table({
      head: ['物資', '擁有者', '總數', { label: '借出', num: true }, { label: '可用', num: true }, '共享範圍', '狀態', ''],
      rows: d.inventory.map(i => ({
        cells: [
          esc(i.name) + (i.note ? `<div class="xs faint">${esc(i.note)}</div>` : ''),
          `<span class="swatch" style="background:${(S.branchById(i.owner)?.color || '#14532d')}"></span> ${esc(S.branchName(i.owner))}`,
          String(i.total),
          { text: String(i.out), num: true },
          { text: String(Math.max(0, i.total - i.out)), num: true },
          i.scope === 'all' ? '<span class="tag g sm">全旅</span>' : i.scope === 'troop' ? '<span class="tag b sm">旅內</span>' : '<span class="tag n sm">本支部自用</span>',
          { shared: badge('共享中', 'g', true), local: badge('自用', 'n', true), broken: badge('待維修', 'r', true) }[i.state] || badge(i.state, 'n', true),
          `<div class="btn-row no-print">
            <button class="btn xs" data-borrow="${i.id}">借／還</button>
            ${canEdit ? `<button class="btn xs" data-share-scope="${i.id}">共享範圍</button>` : ''}
          </div>`
        ]
      }))
    }) })}
    `;
  } else if (tab === 'loans') {
    const loans = [];
    d.inventory.forEach(i => (i.loans || []).forEach(l => loans.push({ ...l, item: i.name, owner: i.owner, itemId: i.id })));
    body = `
    ${card({ title: '借用紀錄（雙邊可見）', body: table({
      head: ['物資', '擁有者', '借去', '負責人', '借出日', '應還日', '狀態', '動作'],
      rows: loans.map(l => ({
        cells: [
          esc(l.item), esc(S.branchName(l.owner)), esc(S.branchName(l.to)), esc(l.by),
          fmtDate(l.at), fmtDate(l.due),
          badge({ pending: '待 owner 批', approved: '借用中', returned: '已歸還', rejected: '已拒' }[l.state] || l.state, { approved: 'g', pending: 'y', returned: 'n', rejected: 'r' }[l.state] || 'n', true),
          l.state === 'pending' ? `<div class="btn-row"><button class="btn xs primary" data-loan-ok="${l.itemId}" data-who="${esc(l.by)}">批准</button><button class="btn xs danger" data-loan-no="${l.itemId}" data-who="${esc(l.by)}">拒絕</button></div>`
            : l.state === 'approved' ? `<button class="btn xs" data-loan-back="${l.itemId}" data-who="${esc(l.by)}">已歸還</button>` : ''
        ]
      })), empty: '暫時冇借用紀錄'
    }) })}
    ${notice('批核權喺 <b>owner</b>（物主）。旅長唔會繞過 owner 直接借走支部物資 —— 借用申請嘅路由係「去 owner 批」。', 'warn')}
    `;
  } else {
    body = `${card({ title: '共享設定（開關清單級）', body: `
      ${table({
      cls: 'tbl compact', head: ['物資', '現在', '改為'], rows: d.inventory.map(i => ({
        cells: [esc(i.name), i.scope === 'all' ? '全旅' : i.scope === 'troop' ? '旅內' : '本支部自用',
          `<select data-scope="${i.id}">
            <option value="all" ${i.scope === 'all' ? 'selected' : ''}>全收（全旅可用）</option>
            <option value="troop" ${i.scope === 'troop' ? 'selected' : ''}>旅內（同旅支部）</option>
            <option value="self" ${i.scope === 'self' ? 'selected' : ''}>本支部自用</option>
          </select>`]
      }))
    })}
      <div class="mt-12">${notice('公開借用頁只列<b>已共享</b>範圍；全收係預設，但每個支部可以逐項收返。', 'info')}</div>` })}`;
  }

  el.innerHTML = page({
    title: '物資整合', sub: `${d.inventory.length} 種物資 · ${loanPending} 項待批`,
    actions: `<a class="btn" href="borrow.html" target="_blank" rel="noopener">${icon('globe', 14)} 免登入借用頁</a>`,
    body: tabsHtml + body
  });

  el.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => go('inventory?tab=' + t.dataset.tab)));
  el.querySelector('#inv-add')?.addEventListener('click', () => {
    const m = modal({
      title: '新增物資',
      body: `<label class="f"><span class="lb">名稱</span><input type="text" id="iv-name" placeholder="例：4 人營幕"></label>
      <div class="grid g3">
        <label class="f"><span class="lb">擁有者</span><select id="iv-owner"><option value="troop">旅部</option>${S.myBranches().map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></label>
        <label class="f"><span class="lb">總數</span><input type="number" id="iv-total" value="1"></label>
        <label class="f"><span class="lb">共享範圍</span><select id="iv-scope"><option value="all">全旅</option><option value="troop">旅內</option><option value="self">本支部自用</option></select></label>
      </div>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-save>新增</button>`
    });
    m.el.querySelector('[data-close]').onclick = m.close;
    m.el.querySelector('[data-save]').onclick = () => {
      const name = m.el.querySelector('#iv-name').value.trim();
      if (!name) return toast('要填名稱', 'err');
      S.commit(dd => dd.inventory.push({
        id: 'i-' + Date.now(), name, owner: m.el.querySelector('#iv-owner').value,
        total: Number(m.el.querySelector('#iv-total').value || 1), out: 0, state: 'shared',
        scope: m.el.querySelector('#iv-scope').value, loans: []
      }));
      S.audit('新增物資', name, '');
      m.close(); toast('已新增', 'ok'); go('inventory?tab=list');
    };
  });
  el.querySelectorAll('[data-share-scope]').forEach(b => b.addEventListener('click', () => go('inventory?tab=share')));
  el.querySelectorAll('[data-scope]').forEach(s => s.addEventListener('change', () => {
    const it = d.inventory.find(x => x.id === s.dataset.scope);
    S.commit(dd => { const t = dd.inventory.find(x => x.id === it.id); if (t) { t.scope = s.value; t.state = s.value === 'self' ? 'local' : 'shared'; } });
    S.audit('改共享範圍', it.name, s.value);
    toast('已更新共享範圍（記得撳「儲存到後端」）', 'ok');
  }));
  el.querySelectorAll('[data-borrow]').forEach(b => b.addEventListener('click', () => {
    const it = d.inventory.find(x => x.id === b.dataset.borrow);
    const m = modal({
      title: `借／還 · ${it.name}`,
      body: `${kv([['擁有者', esc(S.branchName(it.owner))], ['總數', String(it.total)], ['借出', String(it.out)], ['可用', String(it.total - it.out)]])}
      <label class="f mt-12"><span class="lb">借去邊個支部</span><select id="bw-to">${S.myBranches().map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>
      <div class="grid g2"><label class="f"><span class="lb">數量</span><input type="number" id="bw-qty" value="1"></label>
      <label class="f"><span class="lb">負責人</span><input type="text" id="bw-by" value="${esc(S.currentUser()?.name || '')}"></label></div>
      <div class="grid g2"><label class="f"><span class="lb">借出日</span><input type="date" id="bw-at" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label class="f"><span class="lb">應還日</span><input type="date" id="bw-due" value="${new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)}"></label></div>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-save>送出借用申請（路由去 owner）</button>`
    });
    m.el.querySelector('[data-close]').onclick = m.close;
    m.el.querySelector('[data-save]').onclick = () => {
      const l = {
        to: m.el.querySelector('#bw-to').value, by: m.el.querySelector('#bw-by').value,
        at: m.el.querySelector('#bw-at').value, due: m.el.querySelector('#bw-due').value,
        qty: Number(m.el.querySelector('#bw-qty').value || 1),
        state: it.owner === 'troop' ? 'approved' : 'pending'
      };
      S.commit(dd => {
        const t = dd.inventory.find(x => x.id === it.id);
        if (t) { t.loans.push(l); if (l.state === 'approved') t.out += l.qty; }
      });
      S.audit('物資借用申請', it.name, `${S.branchName(l.to)} ×${l.qty}`);
      m.close();
      toast(it.owner === 'troop' ? '已批（旅部物資，旅長批核）' : '已送出，等 owner 批核', 'ok');
      go('inventory?tab=loans');
    };
  }));
  el.querySelectorAll('[data-loan-ok]').forEach(b => b.addEventListener('click', () => decideLoan(b.dataset.loanOk, b.dataset.who, 'approved')));
  el.querySelectorAll('[data-loan-no]').forEach(b => b.addEventListener('click', () => decideLoan(b.dataset.loanNo, b.dataset.who, 'rejected')));
  el.querySelectorAll('[data-loan-back]').forEach(b => b.addEventListener('click', () => decideLoan(b.dataset.loanBack, b.dataset.who, 'returned')));
}

function decideLoan(itemId, who, state) {
  S.commit(dd => {
    const it = dd.inventory.find(x => x.id === itemId);
    const l = (it?.loans || []).find(x => x.by === who && x.state !== 'returned');
    if (!it || !l) return;
    if (state === 'approved') { l.state = 'approved'; it.out += l.qty; }
    if (state === 'rejected') { l.state = 'rejected'; }
    if (state === 'returned') { l.state = 'returned'; it.out = Math.max(0, it.out - l.qty); }
  });
  S.audit(state === 'approved' ? '批准借用' : state === 'rejected' ? '拒絕借用' : '歸還物資', itemId, who);
  toast(state === 'approved' ? '已批准，庫存已扣' : state === 'rejected' ? '已拒絕' : '已歸還，庫存回補', state === 'rejected' ? 'warn' : 'ok');
  go('inventory?tab=loans');
}

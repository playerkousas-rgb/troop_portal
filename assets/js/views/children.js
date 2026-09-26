/* 我的子女 — 家長專頁（子女跨支部自動併埋） */
import { esc, icon, money, fmtDate, fmtDateFull, toast, promptDlg } from '../lib/util.js';
import * as S from '../lib/store.js';
import * as API from '../lib/api.js';
import { go } from '../lib/router.js';
import { page, card, table, badge, notice, stat, kv, progressBar, modal } from './ui.js';

export function render(el, params, query = {}) {
  const u = S.currentUser();
  const kids = S.childrenOf(u);
  const d = S.load();

  const body = `
  ${notice('子女用<b>全球唯一成員編號</b>（YMIS／SCOUT_ID）綁定，所以佢升團、轉支部、調區都<b>零改動</b>，你一個家長戶睇晒。綁定由<b>該團領袖確認</b>（防止亂認人仔）。', 'info')}
  <div class="grid g3 mt-12">
    ${stat({ k: '我嘅子女', v: kids.length, u: '位' })}
    ${stat({ k: '橫跨支部', v: new Set(kids.map(k => k.branchId)).size, u: '個' })}
    ${stat({ k: '待確認綁定', v: d.applications.filter(a => a.kind === 'bind' && a.state === 'pending').length, u: '項', tone: d.applications.some(a => a.kind === 'bind' && a.state === 'pending') ? 'warn' : 'ok' })}
  </div>

  ${kids.map(k => {
    const prog = d.progress[k.ymis];
    const notices = S.noticesForViewer().filter(n => n.status === 'published' && (n.scope === 'troop' || n.ownerBranch === k.branchId)).slice(0, 3);
    const fee = d.financeSubmits.find(f => f.branchId === k.branchId);
    return `<section class="card pad-l mt-12">
      <div class="flex-b mb-12">
        <div class="flex" style="gap:10px">
          <span class="swatch" style="background:${k.branch?.color || '#999'};width:16px;height:16px"></span>
          <div><h2 class="mb-0">${esc(k.name)}</h2>
          <div class="card-sub">${esc(k.branch?.name || '未對上名冊')} · ${esc(k.ymis)} · 生日 ${esc(k.dob || '—')}</div></div>
        </div>
        <div class="btn-row">
          ${k.branch ? `<button class="btn sm" data-enter="${k.branchId}">入支部系統</button>` : ''}
          <button class="btn sm" data-bind="${k.ymis}">重新綁定</button>
        </div>
      </div>
      ${k.missing ? notice('未對上名冊 —— 請等該團領袖確認你嘅子女編號。', 'warn') : `
      <div class="grid g2">
        ${card({ title: '進度（來自該團進度 leaf）', body: `
          <div class="xs faint mb-8">來源 <span class="mono">${esc(prog?.source || '—')}</span> · 最新更新 ${esc(prog?.updated || '—')}</div>
          ${progressBar(prog?.awardPct || 0, `${esc(prog?.award || '獎章')} ${prog?.awardPct || 0}%`)}
          ${table({ cls: 'tbl compact', head: ['項目', '狀態', '日期', '經手'], rows: (prog?.items || []).map(i => ({
        cells: [esc(i.name), badge(i.stage, i.stage === '已完成' ? 'g' : i.stage === '待批' ? 'y' : 'b', true), esc(i.at), esc(i.by)]
      })), empty: '未有進度紀錄' })}
          <div class="xs faint mt-8">進度 UI 屬進度 leaf（佢有自己詳細介面）；旅系統只讀摘要，唔會自己做一套。</div>` })}
        ${card({ title: '通告與活動', body: notices.length ? notices.map(n => `
          <div class="mb-8"><a href="#/notice/${n.id}" class="bold sm">${esc(n.title)}</a>
          <div class="xs faint">${esc(n.scope === 'troop' ? '旅通告' : '支部通告')} · ${n.eventDate ? fmtDateFull(n.eventDate) : fmtDate(n.at)}${n.fee ? ' · ' + money(n.fee) : ''}</div></div>`).join('') : '<div class="empty">冇通告</div>' })}
      </div>
      <div class="grid g3 mt-12">
        ${stat({ k: '活動履歷', v: (prog?.history || []).length, u: '項' })}
        ${stat({ k: '支部財務摘要', v: fee ? (fee.state === 'accepted' ? '已提交' : fee.state === 'missing' ? '未提交' : '待確認') : '—', hint: '旅只睇摘要；明細住支部' })}
        ${stat({ k: '子女身份', v: esc(k.identity || '成員') })}
      </div>`}
    </section>`;
  }).join('')}

  ${card({ title: '新增子女（綁定）', sub: '輸入子女嘅 YMIS／SCOUT_ID → 系統會送去該團領袖確認',
    body: `<div class="flex-w"><input type="text" id="ch-ymis" placeholder="YMIS-20XX" style="max-width:220px">
      <button class="btn primary" id="ch-add">${icon('plus', 14)} 送出綁定申請</button></div>
      <div class="xs faint mt-8">確認之後，你就會喺呢一頁見到佢嘅進度／通告／繳費。</div>` })}
  `;

  el.innerHTML = page({
    title: '我的子女', sub: `${u?.name || ''} · ${kids.length} 位子女`,
    actions: `<a class="btn" href="public.html" target="_blank" rel="noopener">${icon('globe', 14)} 旅公開頁</a>`,
    body
  });

  el.querySelectorAll('[data-enter]').forEach(b => b.addEventListener('click', async () => {
    const { openEnterBranch } = await import('./branches.js');
    openEnterBranch(b.dataset.enter);
  }));
  el.querySelectorAll('[data-bind]').forEach(b => b.addEventListener('click', () => {
    modal({
      title: '重新綁定', body: `${notice('綁定要由該團領袖確認。如果你想改子女編號，請連絡所屬支部領袖（佢哋手上有名冊）。', 'info')}`,
      footer: `<button class="btn primary" onclick="this.closest('.mask').remove()">明白</button>`
    });
  }));
  el.querySelector('#ch-add')?.addEventListener('click', async () => {
    const ymis = el.querySelector('#ch-ymis').value.trim().toUpperCase();
    if (!ymis) return toast('請輸入子女編號', 'err');
    const me = S.currentUser();
    const email = me?.email || '';
    /* 真模式：交旅 GAS 記待批（kind=bind）＋對名冊；示範模式：只記本機 */
    let res = null;
    if (API.isLive()) {
      res = await API.bindChild({ ymis, email, note: `家長 ${me?.name || ''} 申請綁定 ${ymis}`, consent: true });
      if (res.ok && res.data?.duplicate) { toast('已經申請過／已經綁咗 —— 唔會重複', 'warn'); return go('children'); }
      if (!res.ok) return toast(`送唔到（${res.msg || res.code}）`, 'err', '', null, 6500);
    }
    S.commit(dd => dd.applications.unshift({
      id: res?.data?.id || ('a-' + Date.now()), kind: 'bind', name: me?.name || '家長', email,
      ymis, branchId: res?.data?.branchId || '', title: res?.data?.childName || '',
      note: `申請綁定子女 ${ymis}`, at: new Date().toISOString().slice(0, 16).replace('T', ' '),
      state: 'pending', need: '該團領袖確認子女'
    }));
    S.audit('提交子女綁定申請', ymis, res?.ok ? '已送旅後端 · 待該團領袖確認' : '示範：只記本機');
    toast(res?.ok ? `已送出 —— 等 ${S.branchName(res.data?.branchId || '')}領袖確認` : '已送出（示範）—— 該團領袖確認之後就見到', 'ok', '', null, 5500);
    go('children');
  });
}

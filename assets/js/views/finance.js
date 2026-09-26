/* 財務整合 — 支部提交摘要、旅長綜覽、旅本身帳目（獨立分頁） */
import { esc, icon, money, fmtDate, toast, downloadFile, toCSV, promptDlg } from '../lib/util.js';
import * as S from '../lib/store.js';
import { go } from '../lib/router.js';
import { page, card, table, badge, notice, tabs, stat, kv, modal, progressBar, empty } from './ui.js';
import { can, cacheLabel } from '../lib/registry.js';

/** ★ Q4 定案（2026-09-26）：分層 cache —— 財務／物資／進度 = 30 分鐘，通告／活動／點名 = 5 分鐘 */
function cacheBar(moduleId, canForce = S.getSession()?.role === 'chief') {
  return `<div class="flex-b mb-12" style="gap:8px">
    <span class="xs faint">${esc(cacheLabel(moduleId))}</span>
    ${canForce ? `<button class="btn xs" data-force-refresh="${moduleId}">${icon('refresh', 12)} 強制刷新（清 cache 再拉）</button>` : ''}
  </div>`;
}

export function render(el, params, query = {}) {
  const tab = query.tab || 'overview';
  const d = S.load();
  const role = S.getSession()?.role;
  const m = d.unit ? null : null;

  const tabsHtml = `<div class="tabs">
    ${[['overview', '整合總覽'], ['branch', '逐支部'], ['troop', '旅本身帳目'], ['report', '財政年度報告']]
      .map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}
  </div>`;

  let body = '';
  if (tab === 'overview') {
    const inc = d.financeSubmits.reduce((n, f) => n + f.income, 0);
    const exp = d.financeSubmits.reduce((n, f) => n + f.expense, 0);
    const bal = d.financeSubmits.reduce((n, f) => n + f.balance, 0);
    const byBranch = d.financeSubmits.map(f => ({ ...f, depth: f.income - f.expense }));
    body = `
    ${notice('財務整合係<b>獨立分頁</b>：支部用<b>自己 key 簽</b>提交月度摘要（明細同憑證永遠留返支部自己張 Sheet），旅只存摘要＋核對。支部只睇自己；旅長睇晒。', 'info')}
    ${cacheBar('finance')}
    <div class="grid g4 mt-12">
      ${stat({ k: '本月收入（全旅）', v: money(inc) })}
      ${stat({ k: '本月支出（全旅）', v: money(exp) })}
      ${stat({ k: '本月淨額', v: money(inc - exp), tone: inc - exp >= 0 ? 'ok' : 'danger' })}
      ${stat({ k: '各支部結餘合計', v: money(bal) })}
    </div>
    ${card({ title: '逐支部（按支部）', actions: `<button class="btn sm" id="fin-csv">${icon('download', 13)} 匯出 CSV</button>`, body: table({
      head: ['支部', '期', '收入', { label: '支出', num: true }, { label: '淨額', num: true }, { label: '結餘', num: true }, '狀態', '提交人'],
      rows: byBranch.map(f => ({
        cells: [
          `<a href="#/branch/${f.branchId}?tab=finance">${esc(S.branchName(f.branchId))}</a>`,
          esc(f.period),
          { text: money(f.income), num: true },
          { text: money(f.expense), num: true },
          { text: money(f.depth), num: true, cls: f.depth >= 0 ? '' : '' },
          { text: money(f.balance), num: true },
          badge({ accepted: '已收', pending: '待確認', query: '退問', missing: '未提交' }[f.state] || f.state, f.state === 'accepted' ? 'g' : f.state === 'missing' ? 'r' : 'y', true),
          esc(f.submittedBy || '—')
        ]
      }))
    }) })}
    ${card({ title: '按月趨勢（示範）', body: `
      <div class="grid g3">
        ${['2026-07', '2026-08', '2026-09'].map((p, i) => {
      const v = [0.62, 0.81, 1.0][i];
      return `<div><div class="sm bold">${p}</div>
        ${progressBar(v * 100, `收入 ~ ${money((inc * v) / 1) }`)}
        ${progressBar(v * 72, `支出 ~ ${money((exp * v) / 1)}`)}
      </div>`;
    }).join('')}
      </div>
      <div class="xs faint mt-8">真模式：按月／按類別由旅 GAS 彙總各支部提交嘅摘要，唔會拉支部明細。</div>` })}
    `;
  } else if (tab === 'branch') {
    body = `<div class="grid g2">
      ${d.financeSubmits.map(f => {
      const b = S.branchById(f.branchId);
      return card({
        title: b ? b.name : f.branchId, sub: `${f.fy} · ${f.period}`, cls: 'pad-l',
        actions: can(role, 'finance_confirm') && f.state !== 'accepted' && f.state !== 'missing' ? `<button class="btn sm" data-ok="${f.id}">確認</button><button class="btn sm danger" data-ask="${f.id}">退問</button>` : badge(f.state, f.state === 'accepted' ? 'g' : f.state === 'missing' ? 'r' : 'y', true),
        body: `
          <div class="grid g3">${stat({ k: '收入', v: money(f.income) })}${stat({ k: '支出', v: money(f.expense) })}${stat({ k: '結餘', v: money(f.balance) })}</div>
          <div class="mt-12">${kv([['憑證', `${f.entries} 筆`], ['提交人', esc(f.submittedBy || '—')], ['時間', esc(f.at)], ['簽名', f.signed ? '✓ 支部用自己 key 簽（旅驗簽防冒認）' : '✕ 未簽']])}</div>
          ${f.query ? `<div class="mt-8">${notice('退問：' + esc(f.query), 'warn')}</div>` : ''}
          <div class="mt-8"><a class="btn sm" href="#/branch/${f.branchId}?tab=finance">支部詳情 ${icon('arrowR', 12)}</a></div>`
      });
    }).join('')}
    </div>`;
  } else if (tab === 'troop') {
    const t = d.troopFinance;
    const inc = t.entries.filter(e => e.kind === 'income').reduce((n, e) => n + e.amount, 0);
    const exp = t.entries.filter(e => e.kind === 'expense').reduce((n, e) => n + e.amount, 0);
    body = `
    <div class="grid g4">
      ${stat({ k: '期初結餘', v: money(t.opening) })}
      ${stat({ k: '收入', v: money(inc), tone: 'ok' })}
      ${stat({ k: '支出', v: money(exp), tone: 'danger' })}
      ${stat({ k: '現在結餘', v: money(t.opening + inc - exp) })}
    </div>
    ${card({ title: `旅本身帳目（${t.fy}）`, actions: `<button class="btn sm primary" id="tf-add">${icon('plus', 13)} 記一筆</button>`, body: table({
      head: ['日期', '類別', { label: '收入', num: true }, { label: '支出', num: true }, '項目', '經手'],
      rows: t.entries.map(e => ({
        cells: [fmtDate(e.date), esc(e.cat), { text: e.kind === 'income' ? money(e.amount) : '', num: true }, { text: e.kind === 'expense' ? money(e.amount) : '', num: true }, esc(e.item), esc(e.by)]
      })),
      empty: '冇帳目'
    }) })}
    ${notice('旅本身帳目＝旅部行政、旅層活動、各支部上繳旅費。<b>支部明細唔會入呢度</b>（公私分明，支部帳住支部）。', 'info')}
    `;
  } else {
    const byBranch = d.financeSubmits.map(f => ({ ...f }));
    const t = d.troopFinance;
    const inc = t.entries.filter(e => e.kind === 'income').reduce((n, e) => n + e.amount, 0);
    const exp = t.entries.filter(e => e.kind === 'expense').reduce((n, e) => n + e.amount, 0);
    body = `
    ${card({ title: '財政年度報告（示範）', sub: '雙財政年度：AGM 旅年度 ＋ 4/1–3/31 童軍年度', body: `
      <div class="grid g3">
        <div class="card"><div class="card-sub">童軍年度 2026/27</div><div class="bold lg mt-4">4/1 – 3/31</div><div class="xs faint">現時：第 6 個月</div></div>
        <div class="card"><div class="card-sub">旅年度（AGM）</div><div class="bold lg mt-4">2026 AGM → 2027 AGM</div><div class="xs faint">8 月最後一個星期六</div></div>
        <div class="card"><div class="card-sub">全旅合計</div><div class="bold lg mt-4">${money(inc - exp + byBranch.reduce((n, f) => n + f.balance, 0))}</div><div class="xs faint">旅 ＋ 5 個支部</div></div>
      </div>
      <div class="mt-12">${table({
      cls: 'tbl compact', head: ['項目', { label: '金額', num: true }], rows: [
        { cells: ['期初結餘（旅）', { text: money(t.opening), num: true }] },
        { cells: ['旅收入', { text: money(inc), num: true }] },
        { cells: ['旅支出', { text: money(exp), num: true }] },
        { cells: ['各支部結餘合計', { text: money(byBranch.reduce((n, f) => n + f.balance, 0)), num: true }] },
        { cells: ['<b>現時結餘（全旅）</b>', { text: `<b>${money(t.opening + inc - exp + byBranch.reduce((n, f) => n + f.balance, 0))}</b>`, num: true }] }
      ]
    })}</div>
      <div class="btn-row mt-12"><button class="btn sm" onclick="window.print()">${icon('print', 13)} 列印報告</button><button class="btn sm" id="rep-csv">${icon('download', 13)} 匯出 CSV</button></div>` })}
    ${notice('報告<b>唔會混上年度結餘</b>：期初結餘只計本年度開始嗰日。', 'info')}
    `;
  }
  el.innerHTML = page({ title: '財務整合', sub: `${d.financeSubmits.length} 個支部提交 · ${d.troopFinance.fy}`, body: tabsHtml + body });

  el.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => go('finance?tab=' + t.dataset.tab)));
  el.querySelectorAll('[data-ok]').forEach(b => b.addEventListener('click', () => {
    const f = d.financeSubmits.find(x => x.id === b.dataset.ok);
    S.commit(dd => { const t2 = dd.financeSubmits.find(x => x.id === f.id); if (t2) { t2.state = 'accepted'; t2.query = ''; } });
    S.audit('確認財務提交', S.branchName(f.branchId), f.period);
    toast('已確認', 'ok'); go('finance?tab=branch');
  }));
  el.querySelectorAll('[data-ask]').forEach(b => b.addEventListener('click', async () => {
    const f = d.financeSubmits.find(x => x.id === b.dataset.ask);
    const reason = await promptDlg({ title: '退問', label: '退問內容' });
    if (!reason) return;
    S.commit(dd => { const t2 = dd.financeSubmits.find(x => x.id === f.id); if (t2) { t2.state = 'query'; t2.query = reason; } });
    S.audit('財務退問', S.branchName(f.branchId), reason);
    toast('已退問', 'warn'); go('finance?tab=branch');
  }));
  el.querySelector('#fin-csv')?.addEventListener('click', () => {
    downloadFile('財務整合.csv', toCSV([['支部', '期', '收入', '支出', '結餘', '狀態', '提交人'],
    ...d.financeSubmits.map(f => [S.branchName(f.branchId), f.period, f.income, f.expense, f.balance, f.state, f.submittedBy])]), 'text/csv');
  });
  el.querySelector('#tf-add')?.addEventListener('click', () => {
    const m2 = modal({
      title: '記一筆（旅帳）',
      body: `<div class="grid g3">
        <label class="f"><span class="lb">日期</span><input type="date" id="tf-date" value="${new Date().toISOString().slice(0, 10)}"></label>
        <label class="f"><span class="lb">收支</span><select id="tf-kind"><option value="expense">支出</option><option value="income">收入</option></select></label>
        <label class="f"><span class="lb">金額</span><input type="number" id="tf-amt" value="0"></label>
      </div>
      <div class="grid g2">
        <label class="f"><span class="lb">類別</span><input type="text" id="tf-cat" value="行政"></label>
        <label class="f"><span class="lb">項目</span><input type="text" id="tf-item" placeholder="例：旅部水電"></label>
      </div>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-save>儲存</button>`
    });
    m2.el.querySelector('[data-close]').onclick = m2.close;
    m2.el.querySelector('[data-save]').onclick = () => {
      S.commit(dd => dd.troopFinance.entries.unshift({
        id: 'tf-' + Date.now(), date: m2.el.querySelector('#tf-date').value, kind: m2.el.querySelector('#tf-kind').value,
        cat: m2.el.querySelector('#tf-cat').value, item: m2.el.querySelector('#tf-item').value,
        amount: Number(m2.el.querySelector('#tf-amt').value || 0), by: S.currentUser()?.name || ''
      }));
      m2.close(); toast('已記一筆（記得撳「儲存到後端」）', 'ok'); go('finance?tab=troop');
    };
  });
  el.querySelector('#rep-csv')?.addEventListener('click', () => downloadFile('財政年度報告.csv', toCSV([['項目', '金額'], ['期初結餘', d.troopFinance.opening], ['本月收入', d.financeSubmits.reduce((n, f) => n + f.income, 0)], ['本月支出', d.financeSubmits.reduce((n, f) => n + f.expense, 0)]]), 'text/csv'));
}

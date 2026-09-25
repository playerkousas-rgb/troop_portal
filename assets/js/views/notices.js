/* 通告 — 發佈、分享、報名、公開頁、個人化訂閱 ★ */
import { esc, icon, fmtDate, fmtDateFull, money, toast, copyText, qrSvg, downloadFile, toCSV, relTime } from '../lib/util.js';
import * as S from '../lib/store.js';
import { go } from '../lib/router.js';
import { page, card, table, badge, notice, tabs, modal, kv, stat, toolbar, searchBox, selectBox, empty } from './ui.js';
import { can, moduleEnabled, shareableTargets, visName, VIS_LEVELS } from '../lib/registry.js';

export function render(el, params, query = {}) {
  const tab = query.tab || 'list';
  if (tab === 'subs') return renderSubs(el, query);
  const d = S.load();
  const role = S.getSession()?.role;
  const all = S.noticesForViewer();
  const q = String(query.q || '').toLowerCase();
  const scope = query.scope || 'all';
  let rows = all;
  if (scope === 'share') rows = [];
  else if (scope !== 'all') rows = rows.filter(n => (scope === 'troop' ? n.scope === 'troop' : n.scope === 'branch'));
  if (query.status) rows = rows.filter(n => n.status === query.status);
  if (query.cat) rows = rows.filter(n => n.category === query.cat);
  if (q) rows = rows.filter(n => (n.title + n.body).toLowerCase().includes(q));
  rows = rows.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));

  /* ★ 已接收嘅分享（其他支部／旅 share 嚟、你哋接收咗）—— 混入清單、標明來源 */
  const shared = S.acceptedShares(S.myBranchId(), 'notice').filter(x => x.from !== S.myBranchId());

  const cats = Array.from(new Set(all.map(n => n.category).filter(Boolean)));
  const body = `
  ${notice('通告頁 = 本單位通告 ＋ <b>你已訂閱嘅圖書館通告</b> ＋ <b>已接收嘅分享</b>（同頁同列表、來源標示）。分享俾其他支部之前，對方一定要有<b>通告模組</b>（由註冊表過濾）；★ 對方<b>接收咗先會出現</b>喺度（未接收＝喺「分享中心 · 待接收」）。', 'info')}
  ${shared.length ? card({
    title: `來自其他支部（${shared.length}）`, sub: '你哋接收咗嘅<b>通告</b>分享 —— 標明來源，可去分享中心收回；活動分享喺行事曆',
    body: `<div class="grid" style="gap:10px">${shared.map(x => `
      <div class="pub-notice">
        <div class="flex-b"><div class="grow">
          <div class="flex-w" style="gap:6px"><span class="bold lg">${esc(x.title)}</span>
            <span class="tag b sm">來自 ${esc(S.branchName(x.from))}</span>
            <span class="tag n sm">可見 ${visName(x.level)}</span></div>
          <div class="xs faint mt-4">${esc(x.note || '')} · 由 ${esc(x.by || '')} 發出 · 接收：${esc(x.decidedBy || '')} ${esc(x.decidedAt || '')}</div>
        </div><div class="btn-row no-print"><a class="btn sm" href="#/shares?tab=accepted">分享中心</a></div></div>
      </div>`).join('')}</div>`
  }) : ''}
  ${toolbar(`
    ${searchBox('nt-q', '搜尋標題／內容…')}
    ${selectBox('nt-scope', [{ v: 'all', l: '全部來源' }, { v: 'troop', l: '旅通告' }, { v: 'branch', l: '支部通告' }, { v: 'share', l: `已接收分享${shared.length ? '（' + shared.length + '）' : ''}` }], scope)}
    ${selectBox('nt-status', [{ v: '', l: '全部狀態' }, { v: 'published', l: '已發佈' }, { v: 'draft', l: '草稿' }], query.status || '')}
    ${selectBox('nt-cat', [{ v: '', l: '全部分類' }, ...cats.map(c => ({ v: c, l: c }))], query.cat || '')}
    <span class="grow"></span>
    ${can(role, 'notice_publish') ? `<button class="btn primary" id="nt-new">${icon('plus', 15)} 開一張通告</button>` : ''}
  `)}
  ${card({ body: rows.length ? `<div class="grid" style="gap:10px">${rows.map(rowHtml).join('')}</div>`
    : empty(scope === 'share' ? (shared.length ? '分享通告喺上面嗰組（來自其他支部）' : '未有已接收嘅通告分享') : '冇通告') })}
  `;
  el.innerHTML = page({
    title: '通告', sub: `共 ${rows.length} 條 · 已發佈 ${all.filter(n => n.status === 'published').length} · 草稿 ${all.filter(n => n.status === 'draft').length}`,
    actions: `<a class="btn" href="#/notices?tab=subs">${icon('bell', 14)} 我嘅訂閱 ★</a><a class="btn" href="notice.html" target="_blank" rel="noopener">${icon('globe', 14)} 睇公開通告頁</a>`,
    body
  });

  el.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => go(`notices?tab=${t.dataset.tab}`)));
  const bind = (id, key) => el.querySelector('#' + id)?.addEventListener('change', e => {
    const params2 = new URLSearchParams(query); if (e.target.value) params2.set(key, e.target.value); else params2.delete(key);
    go('notices?' + params2.toString());
  });
  bind('nt-scope', 'scope'); bind('nt-status', 'status'); bind('nt-cat', 'cat');
  el.querySelector('#nt-q')?.addEventListener('input', e => {
    const params2 = new URLSearchParams(query); if (e.target.value) params2.set('q', e.target.value); else params2.delete('q');
    clearTimeout(window.__nt);
    window.__nt = setTimeout(() => { go('notices?' + params2.toString()); setTimeout(() => { const i = document.querySelector('#nt-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 30); }, 400);
  });
  el.querySelector('#nt-new')?.addEventListener('click', () => openEditor(null));
  el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEditor(b.dataset.edit)));
  el.querySelectorAll('[data-share]').forEach(b => b.addEventListener('click', () => openShare(b.dataset.share)));
  el.querySelectorAll('[data-signup]').forEach(b => b.addEventListener('click', () => openSignup(b.dataset.signup)));
}

function rowHtml(n) {
  const d = S.load();
  const src = n.library ? '<span class="tag b sm">圖書館</span>' : n.scope === 'troop' ? '<span class="tag gold sm">旅通告</span>' : `<span class="tag n sm">支部：${esc(S.branchName(n.ownerBranch))}</span>`;
  return `<div class="pub-notice ${n.status === 'draft' ? 'faint' : ''}">
    <div class="flex-b">
      <div class="grow">
        <div class="flex-w" style="gap:6px">
          <a class="bold lg" href="#/notice/${n.id}">${esc(n.title)}</a>
          ${src}
          ${n.status === 'draft' ? '<span class="tag y sm">草稿</span>' : ''}
          <span class="tag n sm">可見 ${visName(n.vis)}</span>
          ${n.shareTo?.length ? `<span class="tag b sm">分享 ${n.shareTo.length} 個支部</span>` : ''}
        </div>
        <div class="xs faint mt-4">${esc(n.category || '')} · 發佈 ${fmtDate(n.at)}${n.eventDate ? ` · 活動 ${fmtDateFull(n.eventDate)}` : ''}${n.deadline ? ` · 截止 ${fmtDate(n.deadline)}` : ''}${n.fee ? ` · 費用 ${money(n.fee)}` : ''}${n.quota ? ` · 名額 ${n.quota}` : ''}</div>
      </div>
      <div class="btn-row no-print">
        ${n.signed ? `<span class="tag g sm">${n.signed} 已報名</span>` : ''}
        <button class="btn sm" data-signup="${n.id}">報名名單</button>
        <button class="btn sm" data-share="${n.id}">${icon('link', 13)} 分享／QR</button>
        ${can(S.getSession()?.role, 'notice_publish') ? `<button class="btn sm" data-edit="${n.id}">${icon('edit', 13)} 編輯</button>` : ''}
      </div>
    </div>
  </div>`;
}

/* ---------------- 通告詳情 ---------------- */
export function renderDetail(el, { id }) {
  const n = S.load().notices.find(x => x.id === id);
  if (!n) { el.innerHTML = page({ title: '搵唔到通告', body: notice('通告唔存在或已被收回。', 'err') }); return; }
  const signups = demoSignups(n);
  const body = `
  ${card({ body: `
    <div class="flex-b mb-8">
      <h2 class="mb-0">${esc(n.title)}</h2>
      <div class="btn-row no-print">
        <button class="btn sm" data-share="${n.id}">${icon('link', 13)} 分享／QR</button>
        <button class="btn sm" onclick="window.print()">${icon('print', 13)} 列印</button>
        ${can(S.getSession()?.role, 'notice_publish') ? `<button class="btn sm" data-edit="${n.id}">${icon('edit', 13)} 編輯</button>` : ''}
      </div>
    </div>
    ${kv([
    ['來源', n.library ? '通告圖書館（scout-circulars）' : n.scope === 'troop' ? '旅通告' : `支部通告：${esc(S.branchName(n.ownerBranch))}`],
    ['分類', esc(n.category || '—')],
    ['發佈', fmtDateFull(n.at)],
    ['活動日期', n.eventDate ? fmtDateFull(n.eventDate) : '—'],
    ['截止報名', n.deadline ? fmtDateFull(n.deadline) : '—'],
    ['費用', n.fee ? money(n.fee) : '免費'],
    ['名額', n.quota || '不限'],
    ['可見等級', `${visName(n.vis)}（${n.vis}）`],
    ['分享', n.shareTo?.length ? n.shareTo.map(b => esc(S.branchName(b))).join('、') : '唔分享（只有本層）']
  ])}
    <hr>
    <div style="white-space:pre-wrap">${esc(n.body)}</div>
    ${n.attachments?.length ? `<div class="mt-12"><b class="sm">附件</b>${n.attachments.map(a => `<div class="xs">${icon('clip', 12)} ${esc(a)}${n.library ? '（指返圖書館原頁）' : ''}</div>`).join('')}</div>` : ''}
  ` })}
  <div class="grid g2 mt-12">
    ${card({ title: `報名／出席（${signups.length} 人）`, actions: `<button class="btn sm" data-export="${n.id}">${icon('download', 13)} 匯出 CSV</button>`,
      body: table({
        cls: 'tbl compact', head: ['#', '姓名', 'YMIS', '支部', '回覆', '代填'],
        rows: signups.map((s, i) => ({ cells: [String(i + 1), esc(s.name), { text: s.ymis, cls: 'mono' }, esc(s.branch), badge(s.reply, s.reply === '出席' ? 'g' : s.reply === '缺席' ? 'r' : 'y', true), s.by ? esc(s.by) : '<span class="faint">—</span>'] })),
        empty: '暫時冇人報名'
      }) })}
    ${card({ title: '公開頁（免登入）', body: `
      <div class="flex" style="gap:14px;align-items:flex-start">
        <div class="qr-box">${qrSvg(publicNoticeUrl(n), 3, 1)}</div>
        <div class="grow">
          <div class="xs mono trunc">${esc(publicNoticeUrl(n))}</div>
          <div class="xs faint mt-8">團員／家長免登入撳入去就睇到通告全文，順手報名；截止／名額自動擋。</div>
          <div class="xs faint mt-4">匿名可寫面＝白名單 action ＋ 限流 ＋ 寫入待批表（同 YMIS 待批唯一）。</div>
          <div class="btn-row mt-8"><button class="btn sm" data-copy="${esc(publicNoticeUrl(n))}">複製連結</button>
          <a class="btn sm" href="notice.html?n=${n.id}" target="_blank" rel="noopener">示範：開公開頁</a></div>
        </div>
      </div>` })}
  </div>
  ${n.library ? notice('呢條係圖書館通告：附件指返圖書館原頁；我哋唔會轉載佢嘅全文，只做訂閱推送。', 'info') : ''}
  `;
  el.innerHTML = page({ title: '通告詳情', sub: esc(n.title), back: 'notices', body });
  el.querySelector('[data-share]')?.addEventListener('click', () => openShare(n.id));
  el.querySelector('[data-edit]')?.addEventListener('click', () => openEditor(n.id));
  el.querySelector('[data-export]')?.addEventListener('click', () => {
    downloadFile(`報名-${n.id}.csv`, toCSV([['姓名', 'YMIS', '支部', '回覆', '代填'], ...signups.map(s => [s.name, s.ymis, s.branch, s.reply, s.by || ''])]), 'text/csv');
  });
  el.querySelector('[data-copy]')?.addEventListener('click', () => copyText(publicNoticeUrl(n)));
}

/* ---------------- 訂閱 ★ ---------------- */
function renderSubs(el, query) {
  const d = S.load();
  const sub = d.subscriptions;
  const TOPICS = ['訓練', '服務', '活動', '比賽', '未分類'];
  const body = `
  ${notice('個人化訂閱係重中之重：<b>push 內建咗就唔使「拉落嚟」</b>，通告自動去到啱嘅人手上。設定存<b>本機</b>（LocalStorage），<b>唔經 server、冇 token 可偷</b>。', 'ok')}
  <div class="grid g2 mt-12">
    ${card({ title: '我關注邊啲支部', sub: '命中即推；同一通告只推一次', body: `<div class="grid-check">
      ${d.branches.map(b => `<label class="check"><input type="checkbox" data-sub-branch="${b.id}" ${sub.branches.includes(b.id) ? 'checked' : ''}> ${esc(b.name)}</label>`).join('')}
      <label class="check"><input type="checkbox" data-sub-branch="leaders" ${sub.branches.includes('leaders') ? 'checked' : ''}> 領袖／成人</label>
      <label class="check"><input type="checkbox" data-sub-branch="parents" ${sub.branches.includes('parents') ? 'checked' : ''}> 家長</label>
    </div>` })}
    ${card({ title: '我關注邊啲分類', body: `<div class="grid-check">
      ${TOPICS.map(t => `<label class="check"><input type="checkbox" data-sub-topic="${t}" ${sub.topics.includes(t) ? 'checked' : ''}> ${t}</label>`).join('')}
    </div>` })}
  </div>
  ${card({ title: '推送裝置', body: `
    <div class="flex-b" style="border:1px solid var(--line);border-radius:8px;padding:10px 12px">
      <div><div class="bold">${sub.pushEnabled ? '已開推送' : '未開推送'}</div>
        <div class="xs faint">${esc(sub.device)} · 上次推送 ${esc(sub.lastPush || '—')}</div></div>
      <button class="btn sm ${sub.pushEnabled ? '' : 'primary'}" id="sub-toggle">${sub.pushEnabled ? '關閉推送（示範）' : '開啟推送'}</button>
    </div>
    ${notice('推送基建<b>復用圖書館現有鏈</b>（每日 scrape → Supabase <span class="mono">push_subscriptions</span> → GitHub Actions 06:00 <span class="mono">notify.py</span> → pywebpush (VAPID)），系統<b>零另起爐灶</b>；7 日 rolling 補漏。館方數據完整保留：知幾多人訂、訂咩，<b>唔知邊個</b>。', 'info')}` })}
  ${card({ title: '分類參考（總會通告分類）', body: table({
    cls: 'tbl compact', head: ['支部', '分類', '最近推送'],
    rows: [
      { cells: ['深資童軍', '訓練 / 服務 / 比賽', '2026-09-24 06:00'] },
      { cells: ['童軍', '訓練 / 活動', '2026-09-24 06:00'] },
      { cells: ['幼童軍', '活動', '2026-09-23 06:00'] }
    ]
  }) })}
  `;
  el.innerHTML = page({ title: '我嘅訂閱 ★', sub: '個人化通告訂閱（存本機）', back: 'notices', body });
  el.querySelectorAll('[data-sub-branch]').forEach(c => c.addEventListener('change', () => {
    S.commit(dd => {
      const arr = dd.subscriptions.branches;
      const i = arr.indexOf(c.dataset.subBranch);
      if (c.checked && i < 0) arr.push(c.dataset.subBranch);
      if (!c.checked && i >= 0) arr.splice(i, 1);
    });
    toast('訂閱已更新（存本機）', 'ok');
  }));
  el.querySelectorAll('[data-sub-topic]').forEach(c => c.addEventListener('change', () => {
    S.commit(dd => {
      const arr = dd.subscriptions.topics;
      const i = arr.indexOf(c.dataset.subTopic);
      if (c.checked && i < 0) arr.push(c.dataset.subTopic);
      if (!c.checked && i >= 0) arr.splice(i, 1);
    });
    toast('訂閱已更新（存本機）', 'ok');
  }));
  el.querySelector('#sub-toggle')?.addEventListener('click', () => {
    S.commit(dd => { dd.subscriptions.pushEnabled = !dd.subscriptions.pushEnabled; });
    renderSubs(el, query);
    toast('推送設定已更新（示範：唔會真係訂閱瀏覽器）', 'ok');
  });
}

/* ---------------- 編輯器 ---------------- */
function openEditor(id) {
  const d = S.load();
  const n = id ? d.notices.find(x => x.id === id) : null;
  const role = S.getSession()?.role;
  const canTroop = role === 'chief' || (role === 'coach' && can(role, 'notice_publish'));
  const targets = shareableTargets(d, 'notices');
  const m = modal({
    title: n ? '編輯通告' : '開一張通告',
    wide: true,
    body: `
    <label class="f"><span class="lb">標題</span><input type="text" id="ne-title" value="${esc(n?.title || '')}" placeholder="例：2026 旅露營（全旅）"></label>
    <div class="grid g3">
      <label class="f"><span class="lb">發佈層</span><select id="ne-scope" ${canTroop ? '' : 'disabled'}>
        <option value="troop" ${n?.scope === 'troop' ? 'selected' : ''}>旅通告（旅長／教練員）</option>
        <option value="branch" ${n?.scope === 'branch' ? 'selected' : ''}>支部通告（本支部）</option>
      </select></label>
      <label class="f"><span class="lb">分類</span><input type="text" id="ne-cat" value="${esc(n?.category || '活動')}" list="ne-cats"><datalist id="ne-cats"><option value="活動"><option value="訓練"><option value="服務"><option value="比賽"><option value="會議"><option value="未分類"></datalist></label>
      <label class="f"><span class="lb">可見等級</span><select id="ne-vis">${VIS_LEVELS.map(v => `<option value="${v.id}" ${Number(n?.vis) === v.id ? 'selected' : ''}>${v.id} · ${v.name}（${v.desc}）</option>`).join('')}</select></label>
    </div>
    <div class="grid g4">
      <label class="f"><span class="lb">活動日期</span><input type="date" id="ne-event" value="${esc(n?.eventDate || '')}"></label>
      <label class="f"><span class="lb">截止報名</span><input type="date" id="ne-deadline" value="${esc(n?.deadline || '')}"></label>
      <label class="f"><span class="lb">費用（$）</span><input type="number" id="ne-fee" value="${n?.fee ?? 0}"></label>
      <label class="f"><span class="lb">名額</span><input type="number" id="ne-quota" value="${n?.quota ?? 0}"></label>
    </div>
    <label class="f"><span class="lb">內容</span><textarea id="ne-body" style="min-height:150px">${esc(n?.body || '')}</textarea></label>
    <fieldset><legend>分享俾邊啲支部（前設：對方要有通告模組）</legend>
      <div class="grid-check">${targets.map(b => `<label class="check"><input type="checkbox" data-share-to="${b.id}" ${n?.shareTo?.includes(b.id) ? 'checked' : ''}> ${esc(b.name)}</label>`).join('')}</div>
      <div class="hint">揀晒全部＝全旅可見。接收方嘅成員要對方領袖再開先見到（<span class="mono">shareTo:[支部], memberVisible:false</span>）。</div>
    </fieldset>
    <div class="grid g2">
      <label class="f"><span class="lb">報名方式</span><select id="ne-signup">
        <option value="member" ${n?.signupFrom === 'member' ? 'selected' : ''}>免登入公開頁報名（有限流）</option>
        <option value="login" ${n?.signupFrom === 'login' ? 'selected' : ''}>要登入／公開帳先填</option>
        <option value="none" ${n?.signupFrom === 'none' ? 'selected' : ''}>唔收報名（純通知）</option>
      </select></label>
      <label class="f"><span class="lb">附件（示範：打字名，真模式直上 Drive）</span><input type="text" id="ne-att" value="${esc((n?.attachments || []).join(', '))}" placeholder="須知.pdf, 地圖.jpg"></label>
    </div>
    <label class="check"><input type="checkbox" id="ne-publish" ${!n || n.status === 'published' ? 'checked' : ''}> 即時發佈（唔剔＝草稿）</label>
    `,
    footer: `<button class="btn" data-close>取消</button>
      ${n ? `<button class="btn danger" data-del>${icon('trash', 13)} 刪除</button>` : ''}
      <button class="btn primary" data-save>${icon('check', 14)} 儲存</button>`
  });
  m.el.querySelector('[data-close]').onclick = m.close;
  m.el.querySelector('[data-save]').onclick = () => {
    const title = m.el.querySelector('#ne-title').value.trim();
    if (!title) return toast('要填標題', 'err');
    const shareTo = Array.from(m.el.querySelectorAll('[data-share-to]:checked')).map(x => x.dataset.shareTo);
    const payload = {
      title,
      scope: m.el.querySelector('#ne-scope').value,
      category: m.el.querySelector('#ne-cat').value.trim(),
      vis: Number(m.el.querySelector('#ne-vis').value),
      eventDate: m.el.querySelector('#ne-event').value,
      deadline: m.el.querySelector('#ne-deadline').value,
      fee: Number(m.el.querySelector('#ne-fee').value || 0),
      quota: Number(m.el.querySelector('#ne-quota').value || 0),
      body: m.el.querySelector('#ne-body').value,
      shareTo,
      signupFrom: m.el.querySelector('#ne-signup').value,
      attachments: m.el.querySelector('#ne-att').value.split(',').map(s => s.trim()).filter(Boolean),
      status: m.el.querySelector('#ne-publish').checked ? 'published' : 'draft',
      at: new Date().toISOString().slice(0, 10),
      ownerBranch: payload_scope(m) === 'branch' ? (S.myBranches()[0]?.id || '') : ''
    };
    if (n) {
      S.commit(dd => { const t = dd.notices.find(x => x.id === n.id); if (t) Object.assign(t, payload); });
      S.audit('編輯通告', title, payload.status);
    } else {
      S.commit(dd => { dd.notices.unshift({ id: 'n-' + Date.now(), signed: 0, library: false, ...payload }); });
      S.audit('發佈通告', title, payload.status === 'published' ? '已發佈' : '草稿');
    }
    m.close();
    toast(n ? '已更新通告（記得撳「儲存到後端」）' : '已建立通告', 'ok');
  };
  m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
    const { confirmDlg } = await import('../lib/util.js');
    if (await confirmDlg({ title: '刪除通告', message: `確定刪除「${esc(n.title)}」？已報名嘅資料會一齊清走（示範）。`, ok: '刪除', danger: true, requireTyping: '刪除' })) {
      S.commit(dd => { dd.notices = dd.notices.filter(x => x.id !== n.id); });
      S.audit('刪除通告', n.title, '');
      m.close(); toast('已刪除', 'warn'); go('notices');
    }
  });
}
const payload_scope = m => m.el.querySelector('#ne-scope').value;

/* ---------------- 分享 / QR ---------------- */
function openShare(id) {
  const n = S.load().notices.find(x => x.id === id);
  const url = publicNoticeUrl(n);
  const m = modal({
    title: '分享通告（免登入公開頁）',
    body: `
    ${notice('三個概念唔同：<b>內部分享</b>（支部之間，要對方有模組）／<b>分享連結/QR</b>（收到嘅人直接開，唔使密碼）／<b>公開頁</b>（要登入先入到）。<b>QR 同連結永不帶 key。</b>', 'info')}
    <div class="flex mt-12" style="gap:14px;align-items:flex-start">
      <div class="qr-box">${qrSvg(url, 4, 1)}</div>
      <div class="grow">
        <div class="mono xs" style="word-break:break-all">${esc(url)}</div>
        <div class="btn-row mt-8">
          <button class="btn sm primary" data-copy>${icon('copy', 13)} 複製連結</button>
          <a class="btn sm" href="notice.html?n=${n.id}" target="_blank" rel="noopener">開公開頁</a>
          <button class="btn sm" onclick="window.print()">${icon('print', 13)} 列印海報</button>
        </div>
        <div class="xs faint mt-8">貼落 WhatsApp 群：團員／家長一撳就開通告同報名表。</div>
      </div>
    </div>`,
    footer: `<button class="btn" data-close>關閉</button>`
  });
  m.el.querySelector('[data-close]').onclick = m.close;
  m.el.querySelector('[data-copy]').onclick = () => copyText(url);
}

/* ---------------- 工具 ---------------- */
function publicNoticeUrl(n) {
  const base = location.origin + location.pathname.replace(/[^/]*$/, '');
  return `${base}notice.html?u=0082&n=${encodeURIComponent(n.id)}`;
}
function openSignup(id) {
  const n = S.load().notices.find(x => x.id === id);
  const rows = demoSignups(n);
  const m = modal({
    title: `報名名單 · ${n.title}`,
    wide: true,
    body: `<div class="grid g4 mb-12">${stat({ k: '已報名', v: rows.filter(s => s.reply === '出席').length })}
      ${stat({ k: '缺席', v: rows.filter(s => s.reply === '缺席').length })}
      ${stat({ k: '未回覆', v: Math.max(0, (n.quota || 60) - rows.length) })}
      ${stat({ k: '名額', v: n.quota || '不限' })}</div>
    ${table({ cls: 'tbl compact', head: ['姓名', 'YMIS', '支部', '回覆', '時間'], rows: rows.map(s => ({ cells: [esc(s.name), { text: s.ymis, cls: 'mono' }, esc(s.branch), badge(s.reply, s.reply === '出席' ? 'g' : 'r', true), `<span class="xs faint">${esc(s.at)}</span>`] })) })}`,
    footer: `<button class="btn" data-close>關閉</button><button class="btn primary" data-print>列印簽到表</button>`
  });
  m.el.querySelector('[data-close]').onclick = m.close;
  m.el.querySelector('[data-print]').onclick = () => window.print();
}
function demoSignups(n) {
  if (!n) return [];
  const d = S.load();
  const base = d.members.filter(m => m.branchId).slice(0, Math.min(6, d.members.length));
  return base.map((m, i) => ({
    name: m.name, ymis: m.ymis, branch: S.branchName(m.branchId),
    reply: i === 2 ? '缺席' : i === 4 ? '未定' : '出席',
    by: i === 5 ? '家長代填' : '', at: `2026-09-${String(20 + i).padStart(2, '0')} 20:1${i}`
  }));
}

/* 公開資料 — 決定開放咩畀未登入嘅人（等級 0），同分享連結／QR／海報 */
import { esc, icon, toast, copyText, qrSvg, promptDlg } from '../lib/util.js';
import * as S from '../lib/store.js';
import { go } from '../lib/router.js';
import { page, card, table, badge, notice, tabs, modal, kv, stat } from './ui.js';
import { VIS_LEVELS, visName, can } from '../lib/registry.js';

export function render(el, params, query = {}) {
  const tab = query.tab || 'troop';
  const d = S.load();
  const role = S.getSession()?.role;
  const editable = can(role, 'public_edit');
  const troopItems = d.publicProfile.troop;
  const branchItems = d.publicProfile.branches;

  const tabsHtml = `<div class="tabs">
    ${[['troop', '旅公開資料'], ['branches', '支部公開資料'], ['share', '分享連結與 QR'], ['preview', '遊客視角預覽']].map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}
  </div>`;

  let body = '';
  if (tab === 'troop') {
    body = `
    ${notice('公開資料嘅可見等級：<b>0 公眾</b>（免登入都睇到）＜ <b>1 其他支部</b>（生態內）＜ <b>2 團員</b> ＜ 3 執委 ＜ 4 領袖 ＜ 5 旅長。<br>一項設 N ＝「N 級或以上」先見到；低級一定睇得到高級睇得到嘅嘢。', 'info')}
    <div class="grid g3 mt-12">
      ${stat({ k: '對外公佈', v: troopItems.filter(i => i.vis === 0).length, u: '項', tone: 'ok', hint: '免登入都睇到' })}
      ${stat({ k: '只限生態內', v: troopItems.filter(i => i.vis === 1).length, u: '項' })}
      ${stat({ k: '只限內部', v: troopItems.filter(i => i.vis >= 2).length, u: '項' })}
    </div>
    ${card({ title: '旅公開資料', sub: '社交媒體／相簿／網站／章程…每項自己一個可見等級',
      actions: editable ? `<button class="btn sm primary" id="pb-add">${icon('plus', 13)} 加一項</button>` : '',
      body: table({
        head: ['類型', '項目', '內容', '可見等級', ''],
        rows: troopItems.map(i => ({
          cells: [
            badge(kindLabel(i.kind), 'n', true), esc(i.title),
            `<span class="mono xs trunc" style="display:inline-block;max-width:280px">${esc(i.value)}</span>`,
            visSelect(i.id, i.vis, editable, 'troop'),
            `<div class="btn-row no-print"><button class="btn xs" data-pb-edit="${i.id}">編輯</button>${editable ? `<button class="btn xs danger" data-pb-del="${i.id}">刪除</button>` : ''}</div>`
          ]
        })),
        empty: '未有任何公開資料'
      }) })}
    ${notice('「公開頁（門戶）」同「分享連結」係兩件事：<b>公開頁要登入先入到</b>（家長可用公開帳）；<b>分享連結／QR 收到就開，唔使密碼</b>，但只限已發佈嘅公開項目。', 'info')}
    `;
  } else if (tab === 'branches') {
    body = `
    ${card({ title: '支部公開資料', sub: '支部自己設定 → 上報旅 → 旅長批（防冒認：支部用自己 key 簽寫入旅）', body: table({
      head: ['支部', '類型', '項目', '內容', '可見等級', '狀態'],
      rows: branchItems.map(i => ({
        cells: [
          `<span class="swatch" style="background:${S.branchById(i.branchId)?.color || '#999'}"></span> ${esc(S.branchName(i.branchId))}`,
          badge(kindLabel(i.kind), 'n', true), esc(i.title),
          `<span class="mono xs">${esc(i.value)}</span>`,
          badge(visName(i.vis), i.vis === 0 ? 'b' : 'n', true),
          i.pending ? badge('待旅長批', 'y', true) : badge('已生效', 'g', true)
        ]
      })),
      empty: '支部未上報公開資料'
    }) })}
    ${card({ title: '待批上報', body: d.applications.filter(a => a.kind === 'publish').map(a => `
      <div class="flex-b" style="border:1px solid var(--line);border-radius:8px;padding:10px 12px">
        <div><div class="bold sm">${esc(S.branchName(a.branchId))} · ${esc(a.note)}</div><div class="xs faint">申請時間 ${esc(a.at)}</div></div>
        <div class="btn-row"><button class="btn xs primary" data-pub-ok="${a.id}">批准</button><button class="btn xs danger" data-pub-no="${a.id}">拒絕</button></div>
      </div>`).join('') || '<div class="empty">冇待批上報</div>' })}
    `;
  } else if (tab === 'share') {
    const base = location.origin + location.pathname.replace(/[^/]*$/, '');
    const links = [
      { id: 'public', label: '公開頁（旅門戶）', url: `${base}public.html`, note: '免登入睇得到等級 0 嘅嘢；要睇多啲就要登入' },
      { id: 'notice', label: '通告分享連結', url: `${base}notice.html?u=0082&n=n-1`, note: '收到嘅人直接開通告＋報名（唔使密碼）' },
      { id: 'borrow', label: '物資借用頁', url: `${base}borrow.html`, note: '只列已共享範圍；申請路由去 owner' },
      { id: 'join', label: '邀請連結（join）', url: `${base}join.html?t=TROOP-LEA-XXXXXXXX`, note: '一次性、24 小時；用於開領袖／家長戶' }
    ];
    body = `
    <div class="grid g2">
      ${links.map(l => card({
        title: l.label, sub: l.note,
        body: `<div class="flex" style="gap:14px;align-items:flex-start">
          <div class="qr-box">${qrSvg(l.url, 3, 1)}</div>
          <div class="grow">
            <div class="mono xs" style="word-break:break-all">${esc(l.url)}</div>
            <div class="btn-row mt-8"><button class="btn sm" data-copy="${esc(l.url)}">${icon('copy', 13)} 複製</button>
            <a class="btn sm" href="${esc(l.url)}" target="_blank" rel="noopener">開啟</a>
            <button class="btn sm" onclick="window.print()">${icon('print', 13)} 海報</button></div>
          </div></div>`
      })).join('')}
    </div>
    ${notice('★ 死規矩：<b>QR／連結永不帶 key</b>（apikey 只存 server，永不入 URL、永不入 QR）。', 'warn')}`;
  } else {
    const items = S.visiblePublic(troopItems, 0);
    body = `
    ${notice('下面係<b>未有登入</b>嘅人會睇到嘅全部內容（等級 0）。登入之後，睇得到嘅嘢會按你嘅身份增加。', 'info')}
    ${card({ body: `<div class="pub-grid">${items.map(i => `<div class="pub-item">
        <div class="card-sub">${esc(kindLabel(i.kind))}</div>
        <div class="bold">${esc(i.title)}</div>
        <div class="sm">${i.kind === 'link' || i.kind === 'site' || i.kind === 'album' ? `<a href="${esc(i.value)}" target="_blank" rel="noopener">${esc(i.value)}</a>` : esc(i.value)}</div>
      </div>`).join('')}</div>
      <div class="mt-12"><a class="btn primary" href="public.html" target="_blank" rel="noopener">${icon('globe', 14)} 開真公開頁（示範）</a></div>` })}
    `;
  }

  el.innerHTML = page({ title: '公開資料', sub: `旅 ${troopItems.length} 項 · 支部 ${branchItems.length} 項 · 等級 0 有 ${troopItems.filter(i => i.vis === 0).length} 項`, body: tabsHtml + body });

  el.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => go('public?tab=' + t.dataset.tab)));
  el.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => copyText(b.dataset.copy)));
  el.querySelectorAll('[data-vis]').forEach(s => s.addEventListener('change', () => {
    const [scope, id] = s.dataset.vis.split(':');
    S.commit(dd => {
      const arr = scope === 'troop' ? dd.publicProfile.troop : dd.publicProfile.branches;
      const it = arr.find(x => x.id === id); if (it) it.vis = Number(s.value);
    });
    S.audit('改公開資料可見等級', id, s.value);
    toast('已更新可見等級', 'ok');
  }));
  el.querySelector('#pb-add')?.addEventListener('click', () => openItem(null));
  el.querySelectorAll('[data-pb-edit]').forEach(b => b.addEventListener('click', () => openItem(b.dataset.pbEdit)));
  el.querySelectorAll('[data-pb-del]').forEach(b => b.addEventListener('click', async () => {
    const { confirmDlg } = await import('../lib/util.js');
    if (await confirmDlg({ title: '刪除公開資料', message: '確定刪除呢一項？', ok: '刪除', danger: true })) {
      S.commit(dd => { dd.publicProfile.troop = dd.publicProfile.troop.filter(x => x.id !== b.dataset.pbDel); });
      S.audit('刪除公開資料', b.dataset.pbDel, ''); toast('已刪除', 'warn'); go('public?tab=troop');
    }
  }));
  el.querySelectorAll('[data-pub-ok]').forEach(b => b.addEventListener('click', () => {
    const a = d.applications.find(x => x.id === b.dataset.pubOk);
    S.commit(dd => {
      const t = dd.applications.find(x => x.id === a.id); if (t) { t.state = 'approved'; t.decidedBy = S.currentUser()?.name; }
      const bd = dd.publicProfile.branches.find(x => x.pending && x.branchId === a.branchId);
      if (bd) { bd.pending = false; bd.vis = 1; }
    });
    S.audit('批准公開上報', S.branchName(a.branchId), '');
    toast('已批准，已加入旅公開頁', 'ok'); go('public?tab=branches');
  }));
  el.querySelectorAll('[data-pub-no]').forEach(b => b.addEventListener('click', async () => {
    const reason = await promptDlg({ title: '拒絕公開上報', label: '原因' });
    if (!reason) return;
    const a = d.applications.find(x => x.id === b.dataset.pubNo);
    S.commit(dd => { const t = dd.applications.find(x => x.id === a.id); if (t) { t.state = 'rejected'; t.reason = reason; } });
    S.audit('拒絕公開上報', S.branchName(a.branchId), reason);
    toast('已拒絕', 'warn'); go('public?tab=branches');
  }));
}

const kindLabel = k => ({ social: '社交媒體', album: '相簿', site: '網站', link: '連結', about: '簡介' }[k] || k);

function visSelect(id, vis, editable, scope) {
  if (!editable) return badge(visName(vis), vis === 0 ? 'b' : 'n', true);
  return `<select data-vis="${scope}:${id}">${VIS_LEVELS.map(v => `<option value="${v.id}" ${Number(vis) === v.id ? 'selected' : ''}>${v.id} · ${v.name}</option>`).join('')}</select>`;
}

function openItem(id) {
  const it = id ? S.load().publicProfile.troop.find(x => x.id === id) : null;
  const m = modal({
    title: it ? '編輯公開資料' : '加一項公開資料',
    body: `
    <div class="grid g3">
      <label class="f"><span class="lb">類型</span><select id="pi-kind">
        ${['social', 'album', 'site', 'link', 'about'].map(k => `<option value="${k}" ${it?.kind === k ? 'selected' : ''}>${kindLabel(k)}</option>`).join('')}
      </select></label>
      <label class="f"><span class="lb">標題</span><input type="text" id="pi-title" value="${esc(it?.title || '')}" placeholder="例：旅團 Instagram"></label>
      <label class="f"><span class="lb">可見等級</span><select id="pi-vis">${VIS_LEVELS.map(v => `<option value="${v.id}" ${Number(it?.vis) === v.id ? 'selected' : ''}>${v.id} · ${v.name}（${v.desc}）</option>`).join('')}</select></label>
    </div>
    <label class="f"><span class="lb">內容（網址或者文字）</span><input type="text" id="pi-value" value="${esc(it?.value || '')}" placeholder="@hkg82 / https://… / 一段簡介"></label>
    ${notice('等級 0 ＝ 免登入都睇到（公開頁同分享連結）。擺個人資料之前諗清楚。', 'warn')}`,
    footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-save>儲存</button>`
  });
  m.el.querySelector('[data-close]').onclick = m.close;
  m.el.querySelector('[data-save]').onclick = () => {
    const val = {
      kind: m.el.querySelector('#pi-kind').value,
      title: m.el.querySelector('#pi-title').value.trim(),
      value: m.el.querySelector('#pi-value').value.trim(),
      vis: Number(m.el.querySelector('#pi-vis').value)
    };
    if (!val.title) return toast('要填標題', 'err');
    S.commit(dd => {
      if (it) Object.assign(dd.publicProfile.troop.find(x => x.id === it.id), val);
      else dd.publicProfile.troop.push({ id: 'p-' + Date.now(), ...val });
    });
    S.audit(it ? '編輯公開資料' : '新增公開資料', val.title, 'vis=' + val.vis);
    m.close(); toast('已儲存（記得撳「儲存到後端」）', 'ok'); go('public?tab=troop');
  };
}

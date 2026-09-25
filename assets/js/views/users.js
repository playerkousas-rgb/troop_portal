/* 用戶與身份 — 旅層帳號、邀請連結、branch_access、權限總表 */
import { esc, icon, toast, copyText, qrSvg, fmtDate, promptDlg, confirmDlg } from '../lib/util.js';
import * as S from '../lib/store.js';
import { go } from '../lib/router.js';
import { page, card, table, badge, notice, tabs, modal, kv, stat, toolbar, searchBox } from './ui.js';
import { MODULES, moduleList, ROLE_LABEL, can } from '../lib/registry.js';

export function render(el, params, query = {}) {
  const tab = query.tab || 'list';
  const d = S.load();
  const role = S.getSession()?.role;
  const q = String(query.q || '').toLowerCase();
  let users = d.users;
  if (q) users = users.filter(u => (u.name + u.email + (u.title || '')).toLowerCase().includes(q));

  const tabsHtml = `<div class="tabs">
    ${[['list', '旅員名單'], ['invites', '邀請連結'], ['perms', '權限總表'], ['applications', '申請與待批']].map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}
  </div>`;

  let body = '';
  if (tab === 'list') {
    const counts = { chief: 0, leader: 0, parent: 0 };
    d.users.forEach(u => { if (counts[u.role] !== undefined) counts[u.role]++; });
    body = `
    ${notice('身份錨點：<b>旅長／跨團領袖／家長</b>住旅 SHEET；<b>只帶一團嘅支部領袖</b>住該團支部（旅長可以經 sig 代發邀請連結）；<b>成員</b>一定住該團支部。', 'info')}
    <div class="grid g4 mt-12">
      ${stat({ k: '旅長', v: counts.chief, u: '位', hint: '每旅一位（可轉移）' })}
      ${stat({ k: '旅層領袖', v: counts.leader, u: '位' })}
      ${stat({ k: '家長', v: counts.parent, u: '位', hint: '子女跨支部由旅併埋' })}
      ${stat({ k: '待啟用', v: d.users.filter(u => u.status === 'pending').length, u: '位', tone: 'warn' })}
    </div>
    ${toolbar(`${searchBox('us-q', '搜尋名／電郵／職務…')}<span class="grow"></span>
      ${can(role, 'invite_create') ? `<button class="btn primary" id="us-invite">${icon('plus', 14)} 發邀請連結</button>` : ''}`)}
    ${card({ body: table({
      head: ['姓名', '帳號（EMAIL）', '角色／職務', '可進入支部（branch_access）', '狀態', '最後登入', '動作'],
      rows: users.map(u => ({
        cls: u.role === 'chief' ? 'on' : '',
        cells: [
          `<b>${esc(u.name)}</b>${u.role === 'chief' ? ' <span class="tag gold sm">旅長</span>' : ''}${u.note ? `<div class="xs faint">${esc(u.note)}</div>` : ''}`,
          `<span class="mono xs">${esc(u.email || '—')}</span>`,
          `${badge(ROLE_LABEL[u.role] || u.role, u.role === 'chief' ? 'gold' : u.role === 'leader' ? 'g' : 'b', true)}<div class="xs faint">${esc(u.title || '')}</div>`,
          (u.branchAccess || []).length ? (u.branchAccess.includes('*') ? '<span class="tag g sm">全旅</span>' : u.branchAccess.map(b => `<span class="tag n sm">${esc(S.branchName(b))}</span>`).join(' ')) : '<span class="faint xs">—</span>',
          u.status === 'active' ? badge('啟用中', 'g', true) : u.status === 'pending' ? badge('待啟用', 'y', true) : badge('已停用', 'r', true),
          `<span class="xs faint">${esc(u.lastLogin || '—')}</span>`,
          `<div class="btn-row no-print">
            <button class="btn xs" data-edit="${u.id}">編輯</button>
            <button class="btn xs" data-access="${u.id}">支部權限</button>
            ${u.status === 'disabled' ? `<button class="btn xs" data-enable="${u.id}">復原</button>` : `<button class="btn xs danger" data-disable="${u.id}">停用</button>`}
          </div>`
        ]
      })),
      empty: '冇符合嘅旅員'
    }) })}
    `;
  } else if (tab === 'invites') {
    body = `
    ${card({ title: '邀請連結（一次性・24 小時）', sub: '領袖／家長由旅發；只帶一團嘅支部領袖可以由旅長經 sig 代發',
      actions: can(role, 'invite_create') ? `<button class="btn sm primary" id="iv-new">${icon('plus', 13)} 新邀請</button>` : '',
      body: table({
        head: ['類型', '角色', '指定電郵', '可進入支部', '連結', '到期', '狀態', '動作'],
        rows: d.invites.map(i => ({
          cells: [
            badge(i.kind === 'parent' ? '家長' : '領袖', i.kind === 'parent' ? 'b' : 'g', true),
            esc(i.role),
            `<span class="mono xs">${esc(i.email || '（任何收到連結嘅人）')}</span>`,
            (i.branchAccess || []).length ? i.branchAccess.map(b => `<span class="tag n sm">${esc(S.branchName(b))}</span>`).join(' ') : '<span class="faint xs">—</span>',
            `<span class="mono xs">${esc(i.token)}</span>`,
            fmtDate(i.expires),
            i.used ? badge('已使用', 'n', true) : (i.expires < new Date().toISOString().slice(0, 10) ? badge('已過期', 'r', true) : badge('有效', 'g', true)),
            `<div class="btn-row no-print"><button class="btn xs" data-copy-inv="${i.token}">複製連結</button><button class="btn xs" data-qr-inv="${i.token}">QR</button>${!i.used ? `<button class="btn xs danger" data-revoke="${i.id}">撤銷</button>` : ''}</div>`
          ]
        })),
        empty: '冇邀請連結'
      }) })}
    ${notice('邀請連結＝隨機 12 字、24 小時、用一次即廢；落地頁係 <span class="mono">join.html?t=…</span>。開戶錨點照跟：領袖＝所屬層、家長＝旅。', 'info')}
    `;
  } else if (tab === 'perms') {
    const roles = ['chief', 'leader', 'parent'];
    const PERM_LABELS = [
      ['view_all', '睇全旅'], ['branch_view', '睇支部'], ['branch_link_edit', '改接駁'],
      ['open_account_downstream', '為下游開戶'], ['notice_publish', '發通告'], ['calendar_edit', '改日曆'],
      ['finance_view', '睇財務'], ['finance_confirm', '確認財務'], ['inventory_all', '物資管理'],
      ['transfer_all', '移交'], ['user_manage', '管帳號'], ['invite_create', '發邀請'],
      ['public_edit', '改公開資料'], ['module_toggle', '模組開關'], ['system_all', '系統'], ['audit_view', '睇審計']
    ];
    body = `
    ${notice('權限總表：每一格可以撳（✓ → 自己 → ✗）。<b>下級 override ⊆ 上級自己權限（封頂）</b>；上級失權即失效。改動會記 <span class="mono">updatedBy</span>。', 'info')}
    ${card({ body: table({
      cls: 'tbl compact',
      head: ['權限', ...roles.map(r => ROLE_LABEL[r])],
      rows: PERM_LABELS.map(([perm, label]) => ({
        cells: [esc(label), ...roles.map(r => {
          const on = can(r, perm);
          return { cls: 'level-cell' + (on ? '' : ' faint'), html: on ? '✓' : '✗' };
        })]
      }))
    }) })}
    ${card({ title: '模組 × 角色（註冊表）', body: table({
      cls: 'tbl compact',
      head: ['模組', '分期', ...roles.map(r => ROLE_LABEL[r])],
      rows: moduleList().map(m => ({
        cells: [esc(m.label), `<span class="tag n sm">${esc(m.tier)}</span>`, ...roles.map(r => ({ cls: 'level-cell', html: m.roles.includes(r) ? '✓' : '<span class="faint">✗</span>' }))]
      }))
    }) })}
    `;
  } else {
    body = `${card({ title: '申請與待批', actions: `<a class="btn sm primary" href="#/pending">去待辦與批核 ${icon('arrowR', 13)}</a>`, body: table({
      cls: 'tbl compact', head: ['申請人', '種類', '內容', '狀態', '決定'],
      rows: d.applications.map(a => ({
        cells: [esc(a.name), esc(a.kind), esc(a.note), badge(a.state, a.state === 'approved' ? 'g' : a.state === 'rejected' ? 'r' : 'y', true), `<span class="xs faint">${esc(a.decidedBy || '—')} ${esc(a.decidedAt || '')}</span>`]
      }))
    }) })}`;
  }

  el.innerHTML = page({
    title: '用戶與身份', sub: `${d.users.length} 位旅員 · ${d.invites.filter(i => !i.used).length} 條有效邀請`,
    body: tabsHtml + body
  });
  el.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => go('users?tab=' + t.dataset.tab)));
  el.querySelector('#us-q')?.addEventListener('keydown', e => { if (e.key === 'Enter') go('users?q=' + encodeURIComponent(e.target.value)); });
  el.querySelector('#us-invite')?.addEventListener('click', openInvite);
  el.querySelector('#iv-new')?.addEventListener('click', openInvite);
  el.querySelectorAll('[data-copy-inv]').forEach(b => b.addEventListener('click', () => copyText(inviteUrl(b.dataset.copyInv))));
  el.querySelectorAll('[data-qr-inv]').forEach(b => b.addEventListener('click', () => {
    const url = inviteUrl(b.dataset.qrInv);
    modal({ title: '邀請連結 QR', body: `<div class="center">${qrSvg(url, 5, 2)}</div><div class="mono xs center mt-8" style="word-break:break-all">${esc(url)}</div>`, footer: `<button class="btn primary" data-copy>複製</button>`, onMount: (dlg, close) => { dlg.querySelector('[data-copy]').onclick = () => copyText(url); } });
  }));
  el.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', async () => {
    if (await confirmDlg({ title: '撤銷邀請', message: '撤銷之後呢條連結即刻失效。', ok: '撤銷', danger: true })) {
      S.commit(dd => { const i = dd.invites.find(x => x.id === b.dataset.revoke); if (i) i.revoked = true; });
      toast('已撤銷', 'warn'); go('users?tab=invites');
    }
  }));
  el.querySelectorAll('[data-access]').forEach(b => b.addEventListener('click', () => openAccess(b.dataset.access)));
  el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEdit(b.dataset.edit)));
  el.querySelectorAll('[data-disable]').forEach(b => b.addEventListener('click', async () => {
    const u = S.userById(b.dataset.disable);
    if (await confirmDlg({ title: `停用 ${u.name}`, message: '會即刻撤銷權限；如佢有管理權，記得同時 rotate key。', ok: '停用', danger: true })) {
      S.commit(dd => { const t = dd.users.find(x => x.id === u.id); if (t) t.status = 'disabled'; });
      S.audit('停用帳號', u.name, '');
      toast('已停用', 'warn'); go('users?tab=list');
    }
  }));
  el.querySelectorAll('[data-enable]').forEach(b => b.addEventListener('click', () => {
    const u = S.userById(b.dataset.enable);
    S.commit(dd => { const t = dd.users.find(x => x.id === u.id); if (t) t.status = 'active'; });
    S.audit('復原帳號', u.name, '');
    toast('已復原', 'ok'); go('users?tab=list');
  }));
}

const inviteUrl = token => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}join.html?t=${encodeURIComponent(token)}`;

function openInvite() {
  const d = S.load();
  const m = modal({
    title: '發邀請連結（一次性・24 小時）',
    body: `
    <div class="grid g2">
      <label class="f"><span class="lb">類型</span><select id="i-kind">
        <option value="leader">領袖（EMAIL）</option>
        <option value="parent">家長（EMAIL）</option>
      </select></label>
      <label class="f"><span class="lb">角色說明</span><input type="text" id="i-role" value="旅層領袖" list="i-roles"><datalist id="i-roles"><option value="旅層領袖"><option value="旅教練員（跨團）"><option value="支部領袖（只帶一團）"><option value="家長"></datalist></label>
    </div>
    <label class="f"><span class="lb">指定電郵（留空＝任何收到連結嘅人）</span><input type="email" id="i-email" placeholder="newleader@example.hk"></label>
    <fieldset><legend>可進入邊啲支部（branch_access）</legend>
      <div class="grid-check">${d.branches.map(b => `<label class="check"><input type="checkbox" data-i-branch="${b.id}"> ${esc(b.name)}</label>`).join('')}
      <label class="check"><input type="checkbox" data-i-branch="*"> 全旅（教練員／旅長）</label></div>
      <div class="hint">只帶一團嘅支部領袖：建議喺卡片上「為下游開戶」度經 sig 發，等佢落喺該團。跨團（教練員）＝旅層帳號 ＋ 多個 branch_access，由旅長一鍵開。</div>
    </fieldset>
    ${notice('本職領袖想兼幫他團（例：幼童軍團長去幫小童軍）→ 唔可以直接加。要走「跨團幫手申請」講 <b>目標團批</b>。', 'warn')}`,
    footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-save>${icon('link', 14)} 產生連結</button>`
  });
  m.el.querySelector('[data-close]').onclick = m.close;
  m.el.querySelector('[data-save]').onclick = async () => {
    const { makeInvite } = await import('../lib/auth.js');
    const kind = m.el.querySelector('#i-kind').value;
    const role = m.el.querySelector('#i-role').value.trim() || (kind === 'parent' ? '家長' : '旅層領袖');
    const email = m.el.querySelector('#i-email').value.trim();
    const branchAccess = Array.from(m.el.querySelectorAll('[data-i-branch]:checked')).map(x => x.dataset.iBranch);
    const token = makeInvite({ kind, role, email, branchAccess, createdBy: S.currentUser()?.name || '' });
    S.audit('發邀請連結', role, branchAccess.join(','));
    const url = inviteUrl(token);
    m.close();
    modal({
      title: '邀請連結已產生',
      body: `<div class="mono xs" style="word-break:break-all">${esc(url)}</div>
      <div class="center mt-12">${qrSvg(url, 4, 2)}</div>
      <div class="xs faint mt-8">24 小時內有效、用一次即廢。收到嘅人撳入去設密碼（首登強制改）。</div>`,
      footer: `<button class="btn primary" data-copy>複製連結</button>`,
      onMount: (dlg) => { dlg.querySelector('[data-copy]').onclick = () => copyText(url); }
    });
    toast('已產生邀請連結', 'ok');
  };
}

function openAccess(id) {
  const u = S.userById(id);
  const d = S.load();
  const m = modal({
    title: `支部權限 · ${u.name}`,
    body: `
    ${notice('branch_access 決定佢喺旅系統睇得到／入得到邊啲支部。教練員＝旅長一鍵開多團；本職領袖兼幫＝要<b>目標團批</b>。', 'info')}
    <div class="grid-check mt-12">
      ${d.branches.map(b => `<label class="check"><input type="checkbox" data-a-branch="${b.id}" ${u.branchAccess?.includes(b.id) || u.branchAccess?.includes('*') ? 'checked' : ''} ${u.branchAccess?.includes('*') ? 'disabled' : ''}> ${esc(b.name)}</label>`).join('')}
      <label class="check"><input type="checkbox" data-a-branch="*" ${u.branchAccess?.includes('*') ? 'checked' : ''}> 全旅（教練員級）</label>
    </div>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-save>儲存</button>`
  });
  m.el.querySelector('[data-close]').onclick = m.close;
  m.el.querySelector('[data-save]').onclick = () => {
    const sel = Array.from(m.el.querySelectorAll('[data-a-branch]:checked')).map(x => x.dataset.aBranch);
    S.commit(dd => { const t = dd.users.find(x => x.id === id); if (t) t.branchAccess = sel; });
    S.audit('改 branch_access', u.name, sel.join(','));
    m.close(); toast('已更新（記 updatedBy）', 'ok'); go('users?tab=list');
  };
}

function openEdit(id) {
  const u = S.userById(id);
  const m = modal({
    title: `編輯 · ${u.name}`,
    body: `<div class="grid g2">
      <label class="f"><span class="lb">姓名</span><input type="text" id="e-name" value="${esc(u.name)}"></label>
      <label class="f"><span class="lb">電郵</span><input type="email" id="e-email" value="${esc(u.email || '')}"></label>
    </div>
    <div class="grid g2">
      <label class="f"><span class="lb">職務</span><input type="text" id="e-title" value="${esc(u.title || '')}"></label>
      <label class="f"><span class="lb">角色</span><select id="e-role" ${u.role === 'chief' ? 'disabled' : ''}>
        <option value="leader" ${u.role === 'leader' ? 'selected' : ''}>旅層領袖</option>
        <option value="parent" ${u.role === 'parent' ? 'selected' : ''}>家長</option>
      </select></label>
    </div>
    ${u.role === 'chief' ? notice('旅長身份唔可以自己改低，亦唔可以喺度改 —— 只可以<b>轉移</b>（有審計紀錄；舊旅長自動變返領袖）。', 'warn') : ''}
    <div class="btn-row"><button class="btn sm" data-reset>${icon('key', 13)} 重設密碼（發一次性連結）</button></div>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-save>儲存</button>`
  });
  m.el.querySelector('[data-close]').onclick = m.close;
  m.el.querySelector('[data-reset]').onclick = () => {
    S.audit('重設密碼', u.name, '一次性連結'); toast('已發出重設連結（示範）', 'ok');
  };
  m.el.querySelector('[data-save]').onclick = () => {
    S.commit(dd => {
      const t = dd.users.find(x => x.id === id); if (!t) return;
      t.name = m.el.querySelector('#e-name').value.trim();
      t.email = m.el.querySelector('#e-email').value.trim();
      t.title = m.el.querySelector('#e-title').value.trim();
      if (t.role !== 'chief') t.role = m.el.querySelector('#e-role').value;
    });
    S.audit('編輯旅員', u.name, '');
    m.close(); toast('已儲存', 'ok'); go('users?tab=list');
  };
}

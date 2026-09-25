/* 用戶與身份 — 帳號（旅長／教練員／家長／支部人員）、身份與職稱、逐人權限、邀請連結
   ★ 超管（super）係隱藏帳號：名單、統計、邀請都唔會出現佢。 */
import { esc, icon, toast, copyText, qrSvg, fmtDate } from '../lib/util.js';
import * as S from '../lib/store.js';
import { go } from '../lib/router.js';
import { page, card, table, badge, notice, tabs, modal, kv, stat, toolbar, searchBox, fold, chips } from './ui.js';
import {
  moduleList, MODULE_ROLE_COLS, ROLE_LABEL, ROLE_DESC, ROLE_ANCHOR, PERM_LABELS_OF, IDENTITY_GROUPS,
  BRANCH_IDENTITIES, TITLES, TITLE_META, titleMeta, defaultRankFor, visName, can
} from '../lib/registry.js';
import { makeInvite, inviteUrl as buildInviteUrl, ageLine } from '../lib/auth.js';

const TABS = [['list', '帳號名單'], ['identities', '身份與職稱'], ['invites', '邀請連結'], ['perms', '權限總表'], ['applications', '申請與待批']];

export function render(el, params, query = {}) {
  const tab = query.tab || 'list';
  const d = S.load();
  const q = String(query.q || '').toLowerCase();
  const users = S.visibleUsers().filter(u => !q || (u.name + u.email + (u.title || '')).toLowerCase().includes(q));

  const tabsHtml = `<div class="tabs">
    ${TABS.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}
  </div>`;

  let body = '';

  if (tab === 'list') {
    const counts = { chief: 0, coach: 0, parent: 0, member: 0 };
    S.visibleUsers().forEach(u => { if (counts[u.role] !== undefined) counts[u.role]++; });
    const branchUsers = S.visibleUsers().filter(u => u.role === 'member');
    body = `
    ${chips([
      { k: '旅長', v: counts.chief, hint: '每旅一位（可轉移）' },
      { k: '教練員', v: counts.coach, hint: '旅層帳號' },
      { k: '家長', v: counts.parent, hint: '子女住旅' },
      { k: '支部人員', v: counts.member, hint: '帳號住該團' },
      { k: '待啟用', v: S.visibleUsers().filter(u => u.status === 'pending').length, tone: 'warn' }
    ])}
    ${notice(`身份錨點：<b>旅長／教練員／家長</b>住旅 SHEET；<b>團長／副團長／成員</b>住該團支部 SHEET（旅只經 sig 讀摘要）。<br>★ 旅層只有<b>旅長同教練員</b> —— 冇「旅層領袖」呢個角色。<br>★ 平台超管係隱藏帳號，唔會喺呢張名單出現（連統計都唔計）。`, 'info')}
    ${toolbar(`${searchBox('us-q', '搜尋名／電郵／職務…')}<span class="grow"></span>
      <button class="btn primary" id="us-invite">${icon('plus', 14)} 發邀請連結</button>`)}
    ${card({ body: table({
      head: ['姓名', '角色', '身份／職稱', '年齡組', '所屬／可進入', '狀態', '最後登入', '動作'],
      rows: users.map(u => ({
        cls: u.role === 'chief' ? 'on' : '',
        cells: [
          `<b>${esc(u.name)}</b>${u.role === 'chief' ? ' <span class="tag gold sm">旅長</span>' : ''}${u.role === 'coach' ? ' <span class="tag g sm">教練員</span>' : ''}${u.role === 'member' ? ' <span class="tag b sm">支部</span>' : ''}<div class="xs faint">${esc(u.title || '')}</div>`,
          badge(ROLE_LABEL[u.role] || u.role, u.role === 'chief' ? 'gold' : u.role === 'coach' ? 'g' : u.role === 'member' ? 'b' : 'n', true),
          u.role === 'member'
            ? `${badge(u.identity || '—', 'n', true)}${u.memberTitle ? badge(u.memberTitle + '（跟' + (titleMeta(u.memberTitle)?.follows || '執委') + '）', 'b', true) : ''}`
            : `<span class="faint xs">—</span>`,
          u.role === 'member' ? badge(u.ageGroup === 'adult' ? '18 +' : '未夠 18', u.ageGroup === 'adult' ? 'g' : 'y', true) : badge('18 +', 'n', true),
          u.role === 'member'
            ? `<span class="xs">${esc(S.branchName(u.branchId))}<div class="faint">帳號住該團 SHEET</div></span>`
            : ((u.branchAccess || []).length ? (u.branchAccess.includes('*') ? '<span class="tag g sm">全旅</span>' : u.branchAccess.map(b => `<span class="tag n sm">${esc(S.branchName(b))}</span>`).join(' ')) : '<span class="faint xs">—</span>'),
          u.status === 'active' ? badge('啟用中', 'g', true) : u.status === 'pending' ? badge('待啟用', 'y', true) : badge('已停用', 'r', true),
          `<span class="xs faint">${esc(u.lastLogin || '—')}</span>`,
          `<div class="btn-row no-print">
            <button class="btn xs" data-edit="${u.id}">編輯</button>
            ${u.role === 'member'
      ? `<button class="btn xs" data-ident="${u.id}">身份／職稱</button><button class="btn xs" data-perms="${u.id}">權限微調</button>`
      : `<button class="btn xs" data-access="${u.id}">支部權限</button>`}
            ${u.status === 'disabled' ? `<button class="btn xs" data-enable="${u.id}">復原</button>` : (S.removalGuard(u).ok
      ? `<button class="btn xs danger" data-disable="${u.id}">停用</button>`
      : `<span class="faint xs" title="${esc(S.removalGuard(u).msg)}">最後一個領袖戶</span>`)}
            <button class="btn xs danger" data-remove="${u.id}">刪除</button>
          </div>`
        ]
      })),
      empty: '冇符合嘅帳號'
    }) })}
    ${fold({ title: '支部人員帳號住邊？', sub: `${branchUsers.length} 位示範帳號`, body: `
      <div class="chips mb-8">${d.branches.map(b => {
      const n = branchUsers.filter(u => u.branchId === b.id).length;
      return `<span class="chip-sm"><b>${esc(b.name)}</b><span class="k">${n} 個帳號</span></span>`;
    }).join('')}</div>
      ${notice('成員帳號一律住該團支部 SHEET：旅睇唔到、亦改唔到佢嘅密碼。旅長要開戶 → 支部 → 該團 →「為下游開戶」（經 sig 入下游落筆）。', 'info')}` })}
    `;
  } else if (tab === 'identities') {
    body = `
    ${notice('兩層：<b>身份</b>（決定默認可見等級：團長 5／副團長 4／管委 4／執委 3／隊長 3／副隊長 3／團隊長 3／團員 2）＋ <b>職稱</b>（主席／副主席／秘書／財務 —— 默認跟執委或管委，<b>可以按人微調</b>）。', 'info')}
    <div class="grid g2">
      ${card({ title: '身份（支部）', body: table({
      cls: 'tbl compact', head: ['身份', '默認可見等級', '默認權限群組', '說明'],
      rows: BRANCH_IDENTITIES.map(i => ({
        cells: [badge(i.id, 'gold', true), `${i.rank} · ${esc(visName(i.rank))}`,
          i.leader ? badge('領袖（團長級）', 'g', true) : i.exec ? badge('執委／管委', 'b', true) : i.youthLeader ? badge('青少年領袖', 'y', true) : badge('一般成員', 'n', true),
          `<span class="xs">${esc(i.desc)}</span>`]
      }))
    }) })}
      ${card({ title: '職稱（默認跟執委／管委；可逐人微調）', body: table({
        cls: 'tbl compact', head: ['職稱', '默認跟', '默認等級', '說明'],
        rows: TITLES.map(t => ({
          cells: [badge(t, 'b', true), esc(TITLE_META[t].follows), `${TITLE_META[t].rank} · ${esc(visName(TITLE_META[t].rank))}`, `<span class="xs">${esc(TITLE_META[t].desc)}</span>`]
        }))
      }) })}
    </div>
    ${card({ title: '年齡組（18+ ／ 未夠 18）', body: table({
      cls: 'tbl compact', head: ['年齡組', '自動判定', '分別'],
      rows: [
        { cells: [badge('18 +（成年）', 'g', true), '由生日自動計（≥18 歲）', '自己管帳號、自己簽同意、可做教練員、可自行報名／借用'] },
        { cells: [badge('未夠 18（未成年）', 'y', true), '由生日自動計（<18 歲）', '要監護人（家長帳號）＋家長同意；報名、借用、公開亮相要同意'] }
      ]
    }) })}
    ${card({ title: '要改身份／職稱？', body: `
      <div class="btn-row"><a class="btn sm" href="#/users?tab=list">去帳號名單</a>
      <span class="xs faint">撳該行「身份／職稱」或「權限微調」。團內改動由團長落筆；旅層（旅長／教練員）由旅長改。</span></div>` })}
    `;
  } else if (tab === 'invites') {
    body = `
    ${card({
      title: '邀請連結（一次性・24 小時）', sub: '教練員／家長由旅發；支部人員（團長／副團長／成員）由該團開，或旅長經 sig 代發',
      actions: `<button class="btn sm primary" id="iv-new">${icon('plus', 13)} 新邀請</button>`,
      body: table({
        head: ['類型', '角色', '指定電郵', '可進入支部', '連結', '到期', '狀態', '動作'],
        rows: d.invites.filter(i => i.kind !== 'super').map(i => ({
          cells: [
            badge({ parent: '家長', coach: '教練員', leader: '教練員', member: '支部人員' }[i.kind] || i.kind, i.kind === 'parent' ? 'b' : i.kind === 'member' ? 'n' : 'g', true),
            esc(i.role),
            `<span class="mono xs">${esc(i.email || '（任何收到連結嘅人）')}</span>`,
            i.branchId ? `<span class="tag n sm">${esc(S.branchName(i.branchId))}${i.identity ? ' · ' + esc(i.identity) : ''}</span>` : ((i.branchAccess || []).length ? i.branchAccess.map(b => `<span class="tag n sm">${esc(b === '*' ? '全旅' : S.branchName(b))}</span>`).join(' ') : '<span class="faint xs">—</span>'),
            `<span class="mono xs">${esc(i.token)}</span>`,
            fmtDate(i.expires),
            i.used ? badge('已使用', 'n', true) : (i.expires < new Date().toISOString().slice(0, 10) ? badge('已過期', 'r', true) : badge('有效', 'g', true)),
            `<div class="btn-row no-print"><button class="btn xs" data-copy-inv="${i.token}">複製連結</button><button class="btn xs" data-qr-inv="${i.token}">QR</button>${!i.used ? `<button class="btn xs danger" data-revoke="${i.id}">撤銷</button>` : ''}</div>`
          ]
        })),
        empty: '冇邀請連結'
      })
    })}
    ${notice('開戶錨點照跟：<b>教練員／家長＝旅</b>；<b>支部人員＝該團支部</b>（只可以由該團落筆，旅長代發係經 sig）。', 'info')}
    ${card({ title: '開戶申請模式（BUILD §7）', body: `
      <div class="flex-b">
        <div>
          <b class="sm">${S.load().settings.applyMode === 'invite-only' ? '純邀請制' : '開放申請'}</b>
          <div class="xs faint mt-4">${S.load().settings.applyMode === 'invite-only'
        ? '唔收自助申請：只有旅長／教練員發出嘅邀請連結入得（求救照樣收 —— 入唔到嘅人一定要有路）。'
        : '收自助申請：成員入口遞交（YMIS ＋ 姓名 ＋ 聯絡）→ 待批 → 領袖對名冊核對 → 批 ＝ 開戶或發邀請連結；拒 ＝ 一定要寫原因。'}</div>
        </div>
        <button class="btn sm ${S.load().settings.applyMode === 'invite-only' ? '' : 'primary'}" id="apply-mode">${S.load().settings.applyMode === 'invite-only' ? '改回：開放申請' : '改為：純邀請制'}</button>
      </div>
      ${notice('同 YMIS 待批唯一：同一個 YMIS 未批完之前唔會多過一張申請；已經有戶口嘅 YMIS 直接唔收（唔會撞戶）。', 'info')}` })}
    `;
  } else if (tab === 'perms') {
    const cols = MODULE_ROLE_COLS;
    body = `
    ${notice('權限三層：<b>身份</b>（默認）→ <b>職稱</b>（默認跟執委／管委）→ <b>逐人微調</b>。下級 override 唔可以超過上級（封頂）；改動記 <span class="mono">updatedBy</span>。', 'info')}
    ${card({ title: '身份 × 模組（註冊表；跟身份自動）', body: table({
      cls: 'tbl compact',
      head: ['模組', '分期', ...cols.map(r => ROLE_LABEL[r]), ...IDENTITY_GROUPS.map(g => g[0])],
      rows: moduleList().filter(m => !m.hidden).map(m => ({
        cells: [esc(m.label), `<span class="tag n sm">${esc(m.tier)}</span>`,
        ...cols.map(r => ({ cls: 'level-cell', html: m.roles.includes(r) ? '✓' : '<span class="faint">✗</span>' })),
        ...IDENTITY_GROUPS.map(([, idlist]) => ({
          cls: 'level-cell',
          html: !m.identities ? '<span class="faint">—</span>' : (m.identities.some(x => idlist.includes(x)) ? '✓' : '<span class="faint">✗</span>')
        }))
        ]
      }))
    }) })}
    ${card({ title: '角色 × 動作權限', body: table({
      cls: 'tbl compact',
      head: ['權限', ...cols.map(r => ROLE_LABEL[r])],
      rows: PERM_LABELS_OF.map(([perm, label]) => ({
        cells: [esc(label), ...cols.map(r => ({ cls: 'level-cell', html: can(r, perm) ? '✓' : '<span class="faint">✗</span>' }))]
      }))
    }) })}
    ${card({ title: '角色（帳號住邊張 Sheet）', body: table({
      cls: 'tbl compact', head: ['角色', '帳號錨點', '做咩', '有咩模組'],
      rows: ['chief', 'coach', 'parent', 'member'].map(r => ({
        cells: [badge(ROLE_LABEL[r], r === 'chief' ? 'gold' : r === 'coach' ? 'g' : r === 'member' ? 'b' : 'n', true),
        esc(ROLE_ANCHOR[r]), `<span class="xs">${esc(ROLE_DESC[r])}</span>`,
        `<span class="xs">${moduleList().filter(m => m.roles.includes(r) && !m.hidden).map(m => esc(m.label)).join('、')}</span>`]
      }))
    }) })}
    ${card({ title: '逐人微調（示範：職稱跟執委 ＋ 額外授權）', body: table({
      cls: 'tbl compact', head: ['帳號', '身份', '職稱', '默認等級', '逐人微調'],
      rows: S.visibleUsers().filter(u => u.role === 'member').map(u => {
        const m = S.memberByYmis(u.ymis);
        return {
          cells: [esc(u.name), badge(u.identity || '—', 'n', true), u.memberTitle ? badge(u.memberTitle, 'b', true) : '<span class="faint">—</span>',
          `${defaultRankFor(u.identity, u.memberTitle)} · ${esc(visName(defaultRankFor(u.identity, u.memberTitle)))}`,
          `<span class="xs">${esc(S.permsOf(m).note || '—')}</span>`]
        };
      }),
      empty: '冇支部人員帳號'
    }) })}
    `;
  } else {
    body = `${card({
      title: '申請與待批', actions: `<a class="btn sm primary" href="#/pending">去待辦與批核 ${icon('arrowR', 13)}</a>`, body: table({
        cls: 'tbl compact', head: ['申請人', '種類', '內容', '狀態', '決定'],
        rows: d.applications.map(a => ({
          cells: [esc(a.name), esc({ troop: '新旅部署', account: '開戶', helper: '跨團幫手', member: '成員申請', publish: '公開上報', transfer: '移交' }[a.kind] || a.kind),
          esc(a.note), badge(a.state, a.state === 'approved' ? 'g' : a.state === 'rejected' ? 'r' : 'y', true),
          `<span class="xs faint">${esc(a.decidedBy || '—')} ${esc(a.decidedAt || '')}</span>`]
        }))
      })
    })}`;
  }

  el.innerHTML = page({
    title: '用戶與身份',
    sub: `${S.visibleUsers().length} 個帳號（唔含隱藏超管） · ${d.invites.filter(i => !i.used).length} 條有效邀請`,
    body: tabsHtml + body
  });

  el.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => go('users?tab=' + t.dataset.tab)));
  el.querySelector('#apply-mode')?.addEventListener('click', () => {
    const now = S.load().settings.applyMode === 'invite-only' ? 'open' : 'invite-only';
    S.commit(x => { x.settings.applyMode = now; });
    S.audit('改開戶申請模式', now === 'invite-only' ? '純邀請制' : '開放申請', '旅長設定');
    toast(now === 'invite-only' ? '已改為純邀請制：唔收自助申請（求救照收）' : '已改為開放申請：成員入口可以遞交', 'ok');
    go('users?tab=invites');
  });
  el.querySelector('#us-q')?.addEventListener('keydown', e => { if (e.key === 'Enter') go('users?q=' + encodeURIComponent(e.target.value)); });
  el.querySelector('#us-invite')?.addEventListener('click', () => openInvite('coach'));
  el.querySelector('#iv-new')?.addEventListener('click', () => openInvite());
  el.querySelectorAll('[data-copy-inv]').forEach(b => b.addEventListener('click', () => copyText(buildInviteUrl(b.dataset.copyInv))));
  el.querySelectorAll('[data-qr-inv]').forEach(b => b.addEventListener('click', () => {
    const url = buildInviteUrl(b.dataset.qrInv);
    modal({
      title: '邀請連結 QR',
      body: `<div class="center">${qrSvg(url, 5, 2)}</div><div class="mono xs center mt-8" style="word-break:break-all">${esc(url)}</div>`,
      footer: `<button class="btn primary" data-copy>複製</button>`,
      onMount: (dlg) => { dlg.querySelector('[data-copy]').onclick = () => copyText(url); }
    });
  }));
  el.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', async () => {
    const { confirmDlg } = await import('../lib/util.js');
    if (await confirmDlg({ title: '撤銷邀請', message: '撤銷之後呢條連結即刻失效。', ok: '撤銷', danger: true })) {
      S.commit(dd => { const i = dd.invites.find(x => x.id === b.dataset.revoke); if (i) i.revoked = true; });
      S.audit('撤銷邀請', b.dataset.revoke, '');
      toast('已撤銷', 'warn'); go('users?tab=invites');
    }
  }));
  el.querySelectorAll('[data-access]').forEach(b => b.addEventListener('click', () => openAccess(b.dataset.access)));
  el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEdit(b.dataset.edit)));
  el.querySelectorAll('[data-ident]').forEach(b => b.addEventListener('click', () => openIdentity(b.dataset.ident)));
  el.querySelectorAll('[data-perms]').forEach(b => b.addEventListener('click', () => openFineTune(b.dataset.perms)));
  el.querySelectorAll('[data-disable]').forEach(b => b.addEventListener('click', async () => {
    const { confirmDlg } = await import('../lib/util.js');
    const u = S.userById(b.dataset.disable);
    const g = S.removalGuard(u);
    if (!g.ok) { toast(g.msg, 'err', '', null, 7000); return; }        // 誠實失敗：唔會扮成功
    if (await confirmDlg({ title: `停用 ${u.name}`, message: `會即刻撤銷權限；如佢有管理權，記得同時 rotate key。<div class="xs faint mt-8">帳號下限：${esc(g.leaf)} 停用之後仲有 <b>${g.rest}</b> 個領袖戶。</div>`, ok: '停用', danger: true })) {
      const r = S.setUserStatus(u.id, 'disabled');
      if (!r.ok) { toast(r.msg, 'err', '', null, 7000); return; }
      S.audit('停用帳號', u.name, `${g.leaf} 仲有 ${g.rest} 個領袖戶`);
      toast('已停用', 'warn'); go('users?tab=list');
    }
  }));
  el.querySelectorAll('[data-enable]').forEach(b => b.addEventListener('click', () => {
    const u = S.userById(b.dataset.enable);
    const r = S.setUserStatus(u.id, 'active');
    if (!r.ok) { toast(r.msg, 'err'); return; }
    S.audit('復原帳號', u.name, '');
    toast('已復原', 'ok'); go('users?tab=list');
  }));
  /* ★ 刪除帳號：同一個下限守衛（BUILD §2「每個 leaf 至少留一個領袖戶」） */
  el.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', async () => {
    const { confirmDlg } = await import('../lib/util.js');
    const u = S.userById(b.dataset.remove);
    const g = S.removalGuard(u);
    if (!g.ok) { toast(g.msg, 'err', '', null, 7000); return; }
    const ok = await confirmDlg({
      title: `刪除 ${u.name}？`,
      message: `會由帳號名單移除（入「已移除」紀錄：邊個、幾時、邊個做）。<div class="xs faint mt-8">帳號下限：${esc(g.leaf)} 刪除之後仲有 <b>${g.rest}</b> 個領袖戶 —— 唔會刪到冇人入得返。</div>`,
      ok: '刪除', danger: true, requireTyping: '刪除'
    });
    if (!ok) return;
    const r = S.removeUserAccount(u.id);
    if (!r.ok) { toast(r.msg, 'err', '', null, 7000); return; }
    S.audit('刪除帳號', `${u.name}（${u.email}）`, `${g.leaf} 仲有 ${g.rest} 個領袖戶`);
    toast('已刪除帳號（紀錄留住）', 'warn'); go('users?tab=list');
  }));
}

/* ---------------- 邀請 ---------------- */
function openInvite(presetKind) {
  const d = S.load();
  const m = modal({
    title: '發邀請連結（一次性・24 小時）',
    body: `
    ${notice('開戶錨點：<b>教練員／家長</b>＝旅 SHEET（由旅發）；<b>支部人員（團長／副團長／成員）</b>＝該團支部 SHEET —— 只可以由該團落筆，或者旅長經 sig 代發。', 'info')}
    <div class="grid g2 mt-12">
      <label class="f"><span class="lb">類型</span><select id="i-kind">
        <option value="coach" ${presetKind === 'coach' ? 'selected' : ''}>教練員（旅層 · EMAIL）</option>
        <option value="parent" ${presetKind === 'parent' ? 'selected' : ''}>家長（旅層 · EMAIL）</option>
        <option value="member" ${presetKind === 'member' ? 'selected' : ''}>支部人員（團長／副團長／成員 · 落該團 SHEET）</option>
      </select></label>
      <label class="f"><span class="lb">職務說明</span><input type="text" id="i-role" value="教練員" list="i-roles">
        <datalist id="i-roles"><option value="教練員"><option value="家長"><option value="團長"><option value="副團長"><option value="團員"></datalist></label>
    </div>
    <label class="f"><span class="lb">指定電郵（留空＝任何收到連結嘅人）</span><input type="email" id="i-email" placeholder="newcoach@example.hk"></label>
    <fieldset id="fs-branch"><legend>支部人員：落喺邊個團 ＋ 身份</legend>
      <div class="grid g2">
        <label class="f"><span class="lb">支部（先選團）</span><select id="i-branch">${d.branches.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></label>
        <label class="f"><span class="lb">身份</span><select id="i-identity">${BRANCH_IDENTITIES.map(i => `<option value="${i.id}">${esc(i.id)}（默認等級 ${i.rank}）</option>`).join('')}</select></label>
      </div>
      <div class="hint">職稱（主席／副主席／秘書／財務）開戶後喺「身份與職稱」加，默認跟執委／管委。</div>
    </fieldset>
    <fieldset id="fs-access"><legend>教練員：可進入邊啲支部（branch_access）</legend>
      <div class="grid-check">${d.branches.map(b => `<label class="check"><input type="checkbox" data-i-branch="${b.id}"> ${esc(b.name)}</label>`).join('')}
      <label class="check"><input type="checkbox" data-i-branch="*"> 全旅</label></div>
    </fieldset>
    ${notice('教練員默認跟旅層：唔會自動有支部內部資料。要幫特定團 → 揀 branch_access；<b>本職領袖兼幫</b> → 目標團批「跨團幫手」。', 'warn')}`,
    footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-save>${icon('link', 14)} 產生連結</button>`
  });
  const syncFields = () => {
    const k = m.el.querySelector('#i-kind').value;
    m.el.querySelector('#fs-branch').style.display = k === 'member' ? '' : 'none';
    m.el.querySelector('#fs-access').style.display = k === 'coach' ? '' : 'none';
    const role = { coach: '教練員', parent: '家長', member: '團員' }[k];
    m.el.querySelector('#i-role').value = m.el.querySelector('#i-identity') ? (k === 'member' ? m.el.querySelector('#i-identity').value : role) : role;
  };
  m.el.querySelector('#i-kind').onchange = syncFields;
  m.el.querySelector('#i-identity').onchange = syncFields;
  syncFields();
  m.el.querySelector('[data-close]').onclick = m.close;
  m.el.querySelector('[data-save]').onclick = () => {
    const kind = m.el.querySelector('#i-kind').value;
    const role = m.el.querySelector('#i-role').value.trim();
    const email = m.el.querySelector('#i-email').value.trim();
    const branchAccess = Array.from(m.el.querySelectorAll('[data-i-branch]:checked')).map(x => x.dataset.iBranch);
    const branchId = kind === 'member' ? m.el.querySelector('#i-branch').value : '';
    const identity = kind === 'member' ? m.el.querySelector('#i-identity').value : '';
    const token = makeInvite({ kind, role, email, branchAccess, branchId, identity, createdBy: S.currentUser()?.name || '' });
    S.audit('發邀請連結', `${role}（${kind}）`, [branchId && S.branchName(branchId), branchAccess.join(',')].filter(Boolean).join(' · '));
    const url = buildInviteUrl(token);
    m.close();
    modal({
      title: '邀請連結已產生',
      body: `<div class="mono xs" style="word-break:break-all">${esc(url)}</div>
      <div class="center mt-12">${qrSvg(url, 4, 2)}</div>
      <div class="xs faint mt-8">24 小時內有效、用一次即廢。QR 永不帶 key。</div>`,
      footer: `<button class="btn primary" data-copy>複製連結</button>`,
      onMount: (dlg) => { dlg.querySelector('[data-copy]').onclick = () => copyText(url); }
    });
    toast('已產生邀請連結', 'ok');
  };
}

/* ---------------- 支部權限（旅層帳號） ---------------- */
function openAccess(id) {
  const u = S.userById(id);
  const d = S.load();
  const m = modal({
    title: `支部權限 · ${u.name}`,
    body: `
    ${notice('branch_access 決定佢喺旅系統睇得到／入得到邊啲支部。教練員＝旅長一鍵開多團；本職領袖兼幫＝要<b>目標團批</b>。', 'info')}
    <div class="grid-check mt-12">
      ${d.branches.map(b => `<label class="check"><input type="checkbox" data-a-branch="${b.id}" ${u.branchAccess?.includes(b.id) || u.branchAccess?.includes('*') ? 'checked' : ''} ${u.branchAccess?.includes('*') ? 'disabled' : ''}> ${esc(b.name)}</label>`).join('')}
      <label class="check"><input type="checkbox" data-a-branch="*" ${u.branchAccess?.includes('*') ? 'checked' : ''}> 全旅（旅長級）</label>
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

/* ---------------- 身份／職稱（支部人員） ---------------- */
function openIdentity(id) {
  const u = S.userById(id);
  const m = modal({
    title: `身份與職稱 · ${u.name}`,
    body: `
    ${notice('身份決定默認可見等級（團長 5 ／ 副團長 4 ／ 管委 4 ／ 執委 3 ／ 隊長 · 副隊長 · 團隊長 3 ／ 團員 2）。<br>職稱（主席／副主席／秘書／財務）默認跟執委或管委，但<b>可以按人再微調</b>。', 'info')}
    <div class="grid g2">
      <label class="f"><span class="lb">身份</span><select id="id-ident">${BRANCH_IDENTITIES.map(i => `<option value="${i.id}" ${u.identity === i.id ? 'selected' : ''}>${esc(i.id)}（默認 ${i.rank} · ${esc(visName(i.rank))}）</option>`).join('')}</select></label>
      <label class="f"><span class="lb">職稱（可空）</span><select id="id-title">
        <option value="" ${!u.memberTitle ? 'selected' : ''}>（冇職稱）</option>
        ${TITLES.map(t => `<option value="${t}" ${u.memberTitle === t ? 'selected' : ''}>${esc(t)}（默認跟${esc(TITLE_META[t].follows)}）</option>`).join('')}
      </select></label>
      <label class="f"><span class="lb">所屬支部</span><select id="id-branch">${S.load().branches.map(b => `<option value="${b.id}" ${u.branchId === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
      <label class="f"><span class="lb">年齡組（自動由生日計，可人手覆核）</span><select id="id-age">
        <option value="minor" ${(u.ageGroup || 'minor') === 'minor' ? 'selected' : ''}>未夠 18（未成年）</option>
        <option value="adult" ${u.ageGroup === 'adult' ? 'selected' : ''}>18 +（成年）</option>
      </select></label>
    </div>
    <div class="xs faint">${esc(ageLine(S.memberByYmis(u.ymis)?.dob))}</div>
    ${u.branchId && u.branchId !== S.load().branches[0]?.id ? '' : ''}
    ${notice('★ 支部人員帳號住該團支部 SHEET —— 改身份／職稱會由旅<b>經 sig 寫入該團</b>（Downstream: setIdentity）。審計會記 actor／via。', 'warn')}`,
    footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-save>儲存（經 sig 寫入該團）</button>`
  });
  m.el.querySelector('[data-close]').onclick = m.close;
  m.el.querySelector('[data-save]').onclick = () => {
    const ident = m.el.querySelector('#id-ident').value;
    const title = m.el.querySelector('#id-title').value;
    const branchId = m.el.querySelector('#id-branch').value;
    const age = m.el.querySelector('#id-age').value;
    S.commit(dd => {
      const t = dd.users.find(x => x.id === id);
      if (t) { t.identity = ident; t.memberTitle = title; t.branchId = branchId; t.ageGroup = age; t.branchAccess = [branchId]; }
      const mem = dd.members.find(x => x.ymis === u.ymis);
      if (mem) { mem.identity = ident; mem.title = title; mem.branchId = branchId; }
    });
    S.audit('改身份／職稱（經 sig）', `${u.name}`, `${ident}${title ? ' · ' + title : ''} · ${S.branchName(branchId)} · ${age === 'adult' ? '18+' : '未夠 18'}`, 'sig');
    m.close(); toast('已更新（已記入審計；真模式會經 sig 寫入該團）', 'ok'); go('users?tab=identities');
  };
}

/* ---------------- 逐人權限微調 ---------------- */
function openFineTune(id) {
  const u = S.userById(id);
  const mem = S.memberByYmis(u.ymis);
  const cur = S.permsOf(mem);
  const base = defaultRankFor(u.identity, u.memberTitle);
  const m = modal({
    title: `權限微調 · ${u.name}`,
    body: `
    ${notice(`默認：身份「${esc(u.identity || '—')}」${u.memberTitle ? ' ＋ 職稱「' + esc(u.memberTitle) + '」（跟' + esc(titleMeta(u.memberTitle)?.follows || '執委') + '）' : ''} → 默認等級 <b>${base} · ${esc(visName(base))}</b>。`, 'info')}
    <label class="f mt-12"><span class="lb">可見等級上限（覆核用）</span><select id="ft-rank">
      <option value="">跟默認（${base} · ${esc(visName(base))}）</option>
      ${[1, 2, 3, 4, 5].map(r => `<option value="${r}" ${Number(cur.rank) === r ? 'selected' : ''}>${r} · ${esc(visName(r))}</option>`).join('')}
    </select></label>
    <div class="grid g2">
      <label class="f"><span class="lb">額外功能：借用批准（物資）</span><select id="ft-borrow">
        <option value="">跟默認</option><option value="yes" ${cur.borrow === 'yes' ? 'selected' : ''}>可以批（小額）</option><option value="no" ${cur.borrow === 'no' ? 'selected' : ''}>唔可以</option>
      </select></label>
      <label class="f"><span class="lb">額外功能：公開資料上報</span><select id="ft-publish">
        <option value="">跟默認</option><option value="yes" ${cur.publish === 'yes' ? 'selected' : ''}>可以提（仍要旅長批）</option><option value="no" ${cur.publish === 'no' ? 'selected' : ''}>唔可以</option>
      </select></label>
    </div>
    <label class="f"><span class="lb">備註（點解要特別授權）</span><input type="text" id="ft-note" value="${esc(cur.note || '')}" placeholder="例：可批准 $500 以下支出"></label>
    ${notice('★ 下級嘅額外授權唔可以超過上級（封頂）；上級失權即刻失效。真模式由 server-side 驗，前端只係提示。', 'warn')}`,
    footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-save>儲存</button>`
  });
  m.el.querySelector('[data-close]').onclick = m.close;
  m.el.querySelector('[data-save]').onclick = () => {
    const perms = {
      rank: Number(m.el.querySelector('#ft-rank').value) || undefined,
      borrow: m.el.querySelector('#ft-borrow').value || undefined,
      publish: m.el.querySelector('#ft-publish').value || undefined,
      note: m.el.querySelector('#ft-note').value.trim() || undefined
    };
    S.commit(dd => {
      const x = dd.members.find(y => y.ymis === u.ymis);
      if (x) x.perms = perms;
      const t = dd.users.find(y => y.id === id);
      if (t) t.perms = perms;
    });
    S.audit('逐人權限微調', u.name, JSON.stringify(perms));
    m.close(); toast('已更新（記 updatedBy）', 'ok'); go('users?tab=perms');
  };
}

/* ---------------- 編輯帳號 ---------------- */
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
        <option value="coach" ${u.role === 'coach' ? 'selected' : ''}>教練員（旅層）</option>
        <option value="parent" ${u.role === 'parent' ? 'selected' : ''}>家長（旅層）</option>
        <option value="member" ${u.role === 'member' ? 'selected' : ''}>支部人員（該團 SHEET）</option>
      </select></label>
    </div>
    ${u.role === 'chief' ? notice('旅長身份唔可以自己改低，亦唔可以喺度改 —— 只可以<b>轉移</b>（有審計紀錄）。', 'warn') : ''}
    ${u.role === 'member' ? notice('支部人員嘅角色／身份改動會<b>經 sig 寫入該團</b>；密碼由該團核對，旅唔會、亦唔可以代改。', 'info') : ''}
    <div class="btn-row"><button class="btn sm" data-reset>${icon('key', 13)} 重設密碼（發一次性連結）</button></div>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-save>儲存</button>`
  });
  m.el.querySelector('[data-close]').onclick = m.close;
  m.el.querySelector('[data-reset]').onclick = () => {
    S.audit('重設密碼', u.name, u.role === 'member' ? '要該團團長執行（帳號住該團）' : '一次性連結');
    toast(u.role === 'member' ? '支部人員要搵佢團長重設（帳號住該團）' : '已發出重設連結（示範）', u.role === 'member' ? 'warn' : 'ok');
  };
  m.el.querySelector('[data-save]').onclick = () => {
    S.commit(dd => {
      const t = dd.users.find(x => x.id === id); if (!t) return;
      t.name = m.el.querySelector('#e-name').value.trim();
      t.email = m.el.querySelector('#e-email').value.trim();
      t.title = m.el.querySelector('#e-title').value.trim();
      if (t.role !== 'chief') t.role = m.el.querySelector('#e-role').value;
    });
    S.audit('編輯帳號', u.name, '');
    m.close(); toast('已儲存', 'ok'); go('users?tab=list');
  };
}

/* 我的支部 — 支部人員（團長／副團長／成員）嘅身份卡；亦畀旅長／教練員睇自己嘅旅層身份 */
import { esc, icon, toast, fmtDate, fmtDateFull, money, addDays, todayISO } from '../lib/util.js';
import * as S from '../lib/store.js';
import { go } from '../lib/router.js';
import { page, card, table, badge, notice, stat, kv, progressBar, fold, chips, modal } from './ui.js';
import { identityMeta, titleMeta, ageGroupOf, ageFromDob, ROLE_ANCHOR, defaultRankFor, visName, can } from '../lib/registry.js';
import { branchEntryStatus, branchEntryUrl } from '../lib/auth.js';

export function render(el) {
  const s = S.getSession();
  const d = S.load();
  if (s.role === 'chief' || s.role === 'coach') return renderStaff(el);
  const m = S.myMember();
  const b = S.myBranch();
  const age = m?.dob ? ageFromDob(m.dob) : null;
  const group = s.ageGroup || ageGroupOf(m?.dob);
  const minor = group === 'minor';
  const meta = identityMeta(s.identity || m?.identity);
  const tMeta = s.title ? titleMeta(s.title) : null;
  const rank = S.effectiveRank(m);
  const notices = S.noticesForViewer().filter(n => n.status === 'published'
    && (n.scope === 'troop' || n.ownerBranch === s.branchId)).slice(0, 4);
  const events = S.calendarForViewer()
    .filter(e => e.date >= todayISO() && (e.cal === 'troop' || e.cal === s.branchId))
    .sort((a, b2) => a.date.localeCompare(b2.date)).slice(0, 4);
  const loans = d.inventory.filter(i => i.owner === s.branchId || (i.loans || []).some(l => l.from?.includes(s.branchId)));
  const guardian = m?.guardian ? d.users.find(u => u.id === m.guardian) : null;
  const consent = m?.consent !== false;

  /* 未夠 18 / 18+ 兩套內容（用陣列砌，避免嵌套模板字串） */
  const guardianCard = card({
    title: '監護人（家長帳號）',
    body: guardian
      ? kv([
        ['家長', esc(guardian.name)],
        ['電郵', '<span class="mono">' + esc(guardian.email) + '</span>'],
        ['綁定狀態', badge('已綁定', 'g', true)],
        ['家長睇到', '你嘅進度、通告、活動、繳費狀態（跨支部）']
      ])
      : notice('未綁定監護人 —— 請團長幫你連上家長帳號（家長用 YMIS 綁定，由團長確認）。', 'warn')
  });

  const consentCard = card({
    title: '家長同意狀態',
    body: consent
      ? notice('已收家長同意（可以報名活動、借用物資、公開亮相）', 'ok')
      : notice('未收家長同意 → 只睇得到通告同活動；報名／借用／公開亮相一律擋住。', 'warn')
  });

  const compareTable = card({
    title: '未夠 18 有咩唔同（同 18+ 對照）',
    body: table({
      cls: 'tbl compact', head: ['項目', '未夠 18', '18 +'],
      rows: [
        { cells: ['帳號', '由團長開，連家長帳號', '可以自己申請／自己改密碼'] },
        { cells: ['同意', '要家長同意（報名、借用、公開亮相）', '自己簽同意'] },
        { cells: ['可見等級上限', '跟身份（團員 2 ／ 隊長 3）', '一樣，但可被授權'] },
        { cells: ['借用物資', '要家長同意 ＋ 團長批', '自己申請（仍要 owner 批）'] },
        { cells: ['離隊處理', '通知家長', '自己決定（可要求刪除紀錄）'] }
      ]
    })
  });

  const minorFold = '<div class="grid g2">' + guardianCard + consentCard + '</div>' + compareTable;

  const adultFold = card({
    title: '18 + 成年身份',
    body: [
      '<ul class="doc">',
      '<li>可以自己申請、自己改密碼、自己簽 PDPO 同意</li>',
      '<li>可以借物資、報名活動、被授權做小隊教練</li>',
      '<li>可以做教練員候選（由旅長委任；帳號會轉去旅 SHEET）</li>',
      '<li>離隊時可以要求刪除或匿名化自己嘅紀錄（12 個月後）</li>',
      '</ul>',
      '<div class="xs faint">如果你未夠 18，系統會自動當「未成年」處理：要監護人＋家長同意。</div>'
    ].join('')
  });

  const guardianFold = {
    title: minor ? '家長同意與監護（未成年必睇）' : '成年身份：同未成年有咩分別',
    sub: minor ? '未夠 18 要監護人＋家長同意' : '18+ 可以自己管自己',
    open: minor,
    body: minor ? minorFold : adultFold
  };

  const body = `
  ${card({
    cls: 'pad-l',
    body: `<div class="flex-b">
      <div class="flex" style="gap:12px">
        <span class="emblem" style="width:46px;height:46px;border-radius:12px;background:${b?.color || '#999'}22;color:${b?.color || '#666'};display:grid;place-items:center;font-weight:800">${esc(String(b?.section || '—').slice(0, 2))}</span>
        <div>
          <h2 class="mb-0">${esc(s.name)}</h2>
          <div class="card-sub">${esc(b?.name || '（未對上支部）')} · <span class="mono">${esc(s.ymis || '—')}</span></div>
          <div class="mt-4">
            ${badge(s.identity || m?.identity || '（未設身份）', 'gold', true)}
            ${s.title ? badge(s.title + '（職稱 · 默認跟' + (tMeta?.follows || '執委') + '）', 'b', true) : ''}
            ${badge(minor ? '未夠 18（未成年）' : '18 +（成年）', minor ? 'y' : 'g', true)}
          </div>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn primary" id="mi-enter">${icon('branch', 14)} 入我嘅支部系統</button>
        <button class="btn" id="mi-card">${icon('doc', 14)} 身份卡</button>
      </div>
    </div>` })}

  ${chips([
    { k: '可見等級上限', v: visName(rank), tone: 'ok', hint: s.perms?.rank ? '（逐人微調）' : '（跟身份／職稱）' },
    { k: '年齡', v: age === null ? '未填生日' : age + ' 歲' },
    { k: '通告', v: notices.length },
    { k: '活動', v: events.length },
    { k: '本團物資', v: loans.length }
  ])}

  ${fold({
    title: '我嘅身份同權限（身份／職稱／年齡組）', sub: '跟身份自動，職稱默認跟執委／管委，可逐人微調',
    open: minor, body: `
    <div class="grid g2">
      ${card({ title: '身份', body: kv([
      ['身份', esc(s.identity || '（未設）')],
      ['默認可見等級', `${esc(meta.rank)} · ${esc(visName(meta.rank))}`],
      ['身份說明', esc(meta.desc || '—')],
      ['團內職務', esc(m?.identity || '—')]
    ]) })}
      ${card({ title: '職稱（如有）', body: s.title ? kv([
      ['職稱', esc(s.title)],
      ['默認跟', esc(tMeta?.follows || '執委') + ' 權限'],
      ['額外', esc(tMeta?.desc || '—')],
      ['逐人微調', esc(S.permsOf(m).note || '冇額外授權')]
    ]) : `<div class="empty">你冇設職稱（職稱＝主席／副主席／秘書／財務；默認跟執委／管委權限）</div>` })}
    </div>
    ${notice('★ 權限三層：<b>身份</b>（團長／副團長／管委／執委／隊長／副隊長／團隊長／團員）→ <b>職稱</b>（主席／副主席／秘書／財務，默認跟執委或管委）→ <b>逐人微調</b>（例如加「可批准 $500 以下支出」）。所有改動入審計，由旅長或團長做。', 'info')}` })}

  ${fold(guardianFold)}

  ${fold({ title: '我嘅通告同活動', sub: `${notices.length} 張通告 · ${events.length} 個活動`, open: true, body: `
    <div class="grid g2">
      ${card({ title: '通告', body: notices.length ? notices.map(n => `<div class="mb-8">
        <a href="#/notice/${n.id}" class="bold sm">${esc(n.title)}</a>
        <div class="xs faint">${esc(n.scope === 'troop' ? '旅通告' : S.branchName(n.ownerBranch) + ' 通告')} · ${n.eventDate ? fmtDateFull(n.eventDate) : fmtDate(n.at)}${n.fee ? ' · ' + money(n.fee) : ''}</div></div>`).join('') : '<div class="empty">冇通告</div>' })}
      ${card({ title: '即將活動', body: events.length ? events.map(e => `<div class="mb-8">
        <div class="bold sm">${esc(e.title)}</div>
        <div class="xs faint">${fmtDate(e.date, true)} ${esc(e.time || '')} · ${esc(e.place || '')} · ${esc(e.cal === 'troop' ? '旅部' : S.branchName(e.cal))}</div></div>`).join('') : '<div class="empty">冇活動</div>' })}
    </div>` })}

  ${fold({ title: '本團物資（可借／外借中）', sub: `${loans.length} 項`, body: table({
      cls: 'tbl compact', head: ['物資', '物主', '可借', '共享範圍', '我團外借'],
      rows: loans.map(i => ({
        cells: [esc(i.name), esc(i.owner === 'troop' ? '旅部' : S.branchName(i.owner)),
        `${Number(i.total) - Number(i.out || 0)} / ${i.total}`,
        badge({ all: '全生態', troop: '旅內', self: '本團' }[i.scope] || i.scope, 'n', true),
        String((i.loans || []).filter(l => l.from?.includes(s.branchId) || l.to === s.branchId).length)]
      })), empty: '本團冇物資紀錄' }) })}

  ${fold({ title: '我可以做／未可以做', sub: '跟身份 ＋ 年齡組 ＋ 逐人微調', body: `
    <div class="grid g2">
      ${card({ title: '可以做', body: `<ul class="doc">
        <li>睇通告、行事曆、自己支部嘅公開資料</li>
        <li>${['團長', '副團長'].includes(s.identity) ? '用「支部」睇接駁狀態、名冊、財務摘要（自己團）' : '睇到自己團嘅摘要'}</li>
        <li>${minor ? '家長同意後可以報名活動、申請借物資' : '自己報名、申請借物資'}</li>
        ${['執委', '管委'].includes(s.identity) || s.title ? '<li>執委／管委：支部內部文件、表決、財務摘要</li>' : ''}
      </ul>` })}
      ${card({ title: '未可以做（主場喺邊）', body: `<ul class="doc">
        <li>旅層管理（開戶、接駁、模組開關、財務確認）→ 主場係<b>旅長</b></li>
        <li>跨團睇其他支部 → 要該團批（跨團幫手）或旅長授權</li>
        <li>名冊、進度正本 → 住<b>自己團支部 SHEET</b>；旅只讀摘要</li>
      </ul>` })}
    </div>` })}
  `;

  el.innerHTML = page({
    title: '我的支部', sub: `${s.name} · ${s.identity || ''}${s.title ? ' · ' + s.title : ''} · ${b?.name || ''}`,
    actions: `<a class="btn" href="public.html" target="_blank" rel="noopener">${icon('globe', 14)} 旅公開頁</a>`,
    body
  });

  el.querySelector('#mi-enter').onclick = () => {
    const st = branchEntryStatus(s.branchId);
    modal({
      title: `進入 ${b?.name || ''}`,
      body: `${st.ok ? notice(st.note, st.state === 'green' ? 'ok' : 'warn') : notice(st.msg, 'err')}
      <div class="kv mt-12">
        <dt>入口</dt><dd><span class="mono">${esc(branchEntryUrl(s.branchId, s.ymis))}</span></dd>
        <dt>狀態</dt><dd>${badge(st.state === 'green' ? '綠色：已接駁 ＋ 已閂本地登入' : st.state === 'yellow' ? '黃色：已登記、未閂口' : '紅色：未登記下游', st.state === 'green' ? 'g' : st.state === 'yellow' ? 'y' : 'r', true)}</dd>
        <dt>密碼由邊個驗</dt><dd>該團後端（旅系統唔會、亦唔可以代驗）</dd>
      </div>`,
      footer: `<button class="btn primary" onclick="this.closest('.mask').remove()">明白</button>`
    });
  };
  el.querySelector('#mi-card').onclick = () => {
    S.audit('列印身份卡（示範）', `${s.name}（${s.ymis || ''}）`, s.identity || '');
    window.print();
    toast('已交去列印（示範）', 'ok');
  };
  el.querySelector('#mi-ask-guardian')?.addEventListener('click', () => {
    S.commit(dd => dd.applications.unshift({
      id: 'a-' + Date.now(), kind: 'account', name: s.name, ymis: s.ymis,
      note: `請團長協助綁定監護人（未成年 ${age} 歲）`, branchId: s.branchId,
      at: new Date().toISOString().slice(0, 16).replace('T', ' '), state: 'pending', need: '該團領袖確認家長'
    }));
    S.audit('申請綁定監護人', `${s.name}`, '未成年');
    toast('已通知團長', 'ok'); go('mine');
  });
}

/* ---- 旅長／教練員版本 ---- */
function renderStaff(el) {
  const s = S.getSession();
  const u = S.currentUser();
  const d = S.load();
  const my = S.myBranches();
  const body = `
  ${card({ cls: 'pad-l', body: `<div class="flex-b">
    <div><h2 class="mb-0">${esc(s.name)}</h2>
      <div class="card-sub">${esc(ROLE_ANCHOR[s.role])} · ${esc(u?.title || '')}</div>
      <div class="mt-4">${badge(s.role === 'chief' ? '旅長' : '教練員', s.role === 'chief' ? 'gold' : 'g', true)}
      ${badge('帳號住旅 SHEET', 'b', true)}${badge('18 +（成年）', 'n', true)}</div>
    </div>
    <div class="btn-row">${can(s.role, 'user_manage') ? `<a class="btn sm" href="#/users">${icon('settings', 13)} 用戶與身份</a>` : ''}
    <a class="btn sm" href="#/branches">${icon('branch', 13)} 支部</a></div>
  </div>` })}
  ${notice(s.role === 'chief'
      ? '旅長＝全旅最高權限：所有支部、所有模組（含系統／模組開關／金鑰）。'
      : '教練員＝旅層帳號（唔係「旅層領袖」）。你只睇 branch_access 授權嘅支部；要幫其他團（例：深資團長去協助童軍團）就要目標團批「跨團幫手」。', 'info')}
  ${fold({ title: '我睇得到嘅支部', sub: `${my.length} / ${d.branches.length} 團`, open: true, body: table({
      cls: 'tbl compact', head: ['支部', '接駁狀態', '我嘅權限', '名冊', '進入'],
      rows: d.branches.map(b => {
        const ok = S.canSeeBranch(b);
        return {
          cells: [esc(b.name), badge(b.link.state === 'green' ? '已接駁' : b.link.state === 'yellow' ? '已登記 · 未閂口' : '未登記下游', b.link.state === 'green' ? 'g' : b.link.state === 'yellow' ? 'y' : 'r', true),
          ok ? badge(s.role === 'chief' ? '全旅' : '授權', 'g', true) : badge('未授權', 'n', true),
          `${S.membersOf(b.id).length} 筆`, ok ? `<a class="btn xs" href="#/branch/${b.id}">睇支部</a>` : '<span class="faint xs">—</span>']
        };
      })
    }) })}
  ${fold({ title: '跨團幫手（本職領袖兼幫他團）', sub: '要目標團批', body: `
    ${notice('你自己嘅帳號係旅層；如果要<b>加多一個團</b>嘅可見權，走「跨團幫手申請」，由<b>目標團</b>批（唔係自己批自己）。', 'warn')}
    <div class="btn-row"><a class="btn sm" href="#/pending?kind=helper">睇待批幫手申請</a></div>` })}
  `;
  el.innerHTML = page({ title: '我的支部', sub: `${s.name} · ${s.role === 'chief' ? '旅長' : '教練員'}（旅層）`, body });
}

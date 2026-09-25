/* 支部 — 一覽、詳情、接駁與登記、入支部三條路 */
import { esc, icon, money, fmtDate, copyText, qrSvg, toast, sanitizeLabel, stateDot } from '../lib/util.js';
import * as S from '../lib/store.js';
import { go } from '../lib/router.js';
import { page, card, stat, badge, linkBadge, table, kv, head, notice, progressBar, modal } from './ui.js';
import { can, moduleEnabled, shareableTargets, visName, moduleList, GATE_STATES, gateOfLink, gateMeta, loginRouteFor, loginRouteMeta, cacheLabel, RESCUE, rescueMeta, rescueKindMeta } from '../lib/registry.js';

export function render(el) {
  const d = S.load();
  const role = S.getSession()?.role;
  const mine = S.myBranches();
  const body = `
  ${notice('每個支部＝一個<b>下游節點</b>（旅 → 團 → 進度）。旅只做管理：「登記下游」之後就可以用 <span class="mono">sig</span> 讀寫；未登記嘅支部一切照舊（唔會靜靜地改變行為）。', 'info')}
  <div class="grid g3 mt-12">
    ${d.branches.map(b => {
      const ok = S.canSeeBranch(b);
      const fin = d.financeSubmits.find(f => f.branchId === b.id);
      return `<div class="branch-card">
      <div class="bar" style="background:${b.color}"></div>
      <div class="top">
        <span class="swatch" style="background:${b.color};width:14px;height:14px"></span>
        <div class="grow"><div class="bold">${esc(b.name)}</div><div class="xs faint">${esc(b.section)} · 編號 ${esc(b.code)} · 成立 ${esc(b.founded)}</div></div>
        ${linkBadge(b.link.state)}
      </div>
      <div class="body">
        <div class="flex-b sm mb-8"><span>青少年 <b>${b.youth}</b></span><span>領袖 <b>${b.adults}</b></span><span>名冊 <b>${S.membersOf(b.id).length}</b></span></div>
        <div class="xs faint">團長：${esc(b.leader)}（${esc(b.leaderEmail)}）</div>
        <div class="xs faint mt-4">進度來源：${b.progressSource ? `<span class="mono">${esc(b.progressSource)}</span>` : '<span class="tag n sm">未接</span>'}</div>
        <div class="flex-w mt-8" style="gap:6px">
          ${moduleEnabled(d, 'notices', b.id) ? '<span class="tag n sm">通告 ✓</span>' : '<span class="tag r sm">通告 ✕</span>'}
          ${moduleEnabled(d, 'calendar', b.id) ? '<span class="tag n sm">行事曆 ✓</span>' : '<span class="tag r sm">行事曆 ✕</span>'}
          ${moduleEnabled(d, 'finance', b.id) ? '<span class="tag n sm">財務 ✓</span>' : '<span class="tag r sm">財務 ✕</span>'}
          ${fin ? `<span class="tag ${fin.state === 'accepted' ? 'g' : fin.state === 'missing' ? 'r' : 'y'} sm">財務 ${fin.state === 'accepted' ? '已收' : fin.state === 'missing' ? '未提交' : fin.state === 'query' ? '退問' : '待確認'}</span>` : ''}
        </div>
      </div>
      <div class="foot">
        <a class="btn sm" href="#/branch/${b.id}">詳情</a>
        ${ok && b.hasPortal ? `<button class="btn sm primary" data-enter="${b.id}">${icon('arrowR', 13)} 進入支部</button>` : ok ? `<span class="xs faint">未接支部系統</span>` : `<span class="xs faint">未授權（搵旅長開 branch_access）</span>`}
      </div>
    </div>`;
    }).join('')}
  </div>

  ${can(role, 'branch_link_edit') ? card({
    title: '下游登記（旅層 registry = 旅 GAS ScriptProperties）',
    sub: '★ 唔入任何 Sheet、唔郁 Vercel env；換 key 就三處同步（下游重生 → 旅重新登記 → ADMIN 改 env）',
    actions: `<button class="btn sm primary" data-add-downstream>${icon('plus', 14)} 登記下游</button>`,
    body: `<div class="grid g2">
      ${table({
      cls: 'tbl compact',
      head: ['下游 id', '顯示名', 'sig 用途字串', 'API', '可讀／可寫'],
      rows: d.branches.map(b => {
        const dd = d.downstream[b.id] || {};
        return {
          cells: [
            `<span class="mono">DOWNSTREAM_${esc(b.id)}_*</span>`,
            esc(b.name),
            dd.purpose ? `<span class="mono xs">${esc(dd.purpose)}</span>` : '<span class="faint">—</span>',
            esc(dd.api || '—'),
            `${dd.readActions || 0} / ${dd.writeActions || 0}`
          ]
        };
      })
    })}
      ${notice('為什麼要登記 <b>sig 用途字串</b>？因為下游係唔同 repo（vsbadge／roverbadge／cubsbadge／vs_portal…），每個 repo 一條 purpose；跨 repo 直接簽唔通，所以旅要逐條下游知對方要邊條。下游側零改動，只係旅「照着抄」。', 'info')}
    </div>`
  }) : ''}
  `;
  el.innerHTML = page({ title: '支部', sub: `共 ${d.branches.length} 個 · 你睇得到 ${mine.length} 個`, body });
  el.querySelectorAll('[data-enter]').forEach(b => b.addEventListener('click', () => openEnterBranch(b.dataset.enter)));
  el.querySelector('[data-add-downstream]')?.addEventListener('click', () => openRegisterDownstream());
}

/* ---------------- 支部詳情 ---------------- */
export function renderDetail(el, { id }, query = {}) {
  const d = S.load();
  const b = S.branchById(id);
  if (!b) { el.innerHTML = page({ title: '搵唔到支部', body: notice('呢個支部唔存在。', 'err') }); return; }
  const tab = query.tab || 'overview';
  const dd = d.downstream[b.id] || {};
  const fin = d.financeSubmits.find(f => f.branchId === b.id);
  const mem = S.membersOf(b.id);
  const role = S.getSession()?.role;

  const tabsHtml = `<div class="tabs">
    ${[['overview', '概覽'], ['shares', '分享'], ['link', '接駁與登記'], ['account', '開戶與權限'], ['public', '公開資料'], ['finance', '財務摘要'], ['inventory', '物資'], ['progress', '進度摘要'], ['members', '名冊']]
      .map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}
  </div>`;

  let body = '';
  if (tab === 'overview') {
    body = `<div class="grid g3">
      ${stat({ k: '青少年成員', v: b.youth, u: '人' })}
      ${stat({ k: '成人領袖', v: b.adults, u: '人' })}
      ${stat({ k: '名冊（旅已登記）', v: mem.length, u: '筆', hint: '名冊正本住支部自己張 Sheet' })}
    </div>
    <div class="grid g2 mt-12">
      ${card({ title: '基本資料', body: kv([
      ['支部別', esc(b.section)], ['旅團編號', esc(b.code)], ['成立年份', esc(b.founded)],
      ['團長', `${esc(b.leader)}（${esc(b.leaderEmail)}）`],
      ['旅內顯示名', esc(b.name)],
      ['進度來源', b.progressSource ? `<span class="mono">${esc(b.progressSource)}</span>` : '未接'],
      ['公開資料等級', `${visName(b.publicRank)}（${b.publicRank}）`],
      ['支部系統登入', (() => { const gm = gateMeta(gateOfLink(b.link)); return `<span class="tag ${gm.tone} sm">${gm.label}</span>${b.link.gateBy ? ` <span class="xs faint">${esc(b.link.gateBy)} · ${esc(b.link.gateAt || '')}</span>` : ''}`; })()],
      ['支部版面', b.layout ? `${esc(b.layout.name)} <span class="tag ${b.layout.state === 'generic' ? 'n' : 'y'} sm">${b.layout.state === 'generic' ? '通用（未設計）' : '待照抄'}</span>` : '未設定']
    ]) })}
      ${card({ title: '健康狀態', body: `
        ${notice(b.link.state === 'green' ? '接駁正常：可以用 sig 讀寫，本地入口已閂（只收上游簽名）。'
        : b.link.state === 'yellow' ? '已登記，但未閂本地入口 —— 前台仍然可以直接登入呢個下游。建議先搬數、測連線，再閂口。'
          : '未接駁：該團未有自己嘅支部系統，或者未交 B / D 俾旅長登記。', b.link.state === 'green' ? 'ok' : b.link.state === 'yellow' ? 'warn' : 'err')}
        <div class="mt-12">${kv([
          ['最後測試', esc(b.link.lastPing || '—')],
          ['後端', dd.url ? `<span class="mono xs">${esc(dd.url)}</span>` : '—'],
          ['Shet Key', dd.keyMask ? `<span class="mono xs">${esc(dd.keyMask)}</span>` : '—'],
          ['回打端點', dd.superVerify ? `<span class="mono xs">${esc(dd.superVerify)}</span>` : '—']
        ])}</div>`
      })}
    </div>
    ${card({ title: '示範：五個支部嘅處理狀態一覽', sub: '真模式：每張卡由旅 GAS 讀返下游（讀 action 白名單，回應永不含 hash）',
      body: table({
        cls: 'tbl compact',
        head: ['項目', '狀態'], rows: [
          { cells: ['支部系統（團）', b.link.state === 'red' ? '<span class="tag r">未起系統</span>' : '<span class="tag g">已登記</span>'] },
          { cells: ['進度 leaf', b.progressSource ? `<span class="tag g">已接駁（${esc(b.progressSource)}）</span>` : '<span class="tag n">未接</span>'] },
          { cells: ['支部系統自己登入', (() => { const gm = gateMeta(gateOfLink(b.link)); return `<span class="tag ${gm.tone}">${gm.label}</span>`; })()] },
          { cells: ['財務提交（2026-09）', fin ? `<span class="tag ${fin.state === 'accepted' ? 'g' : 'y'}">${esc(fin.state)}</span>` : '<span class="tag n">—</span>'] },
          { cells: ['公開資料', `${visName(b.publicRank)}`] },
          { cells: ['支部版面', b.layout ? (b.layout.state === 'generic' ? '<span class="tag n">通用（未設計）</span>' : `<span class="tag y">${esc(b.layout.name)}</span><div class="xs faint">之後照抄（旅側唔另設）</div>`) : '—'] }
        ]
      }) })}
    `;
  } else if (tab === 'shares') {
    /* ★ 該支部嘅分享：收到（要佢決定）＋ 發出 */
    const inb = S.sharesToMe(b.id), out = S.sharesFromMe(b.id);
    body = `
    ${notice('★ <b>收件方決定</b>：呢一頁睇該支部收到／發出嘅分享。收到嘅要<b>該支部接收</b>先會出現喺佢自己嘅清單（未接收＝淨係喺分享中心）；退回會留紀錄。旅長可以代決定，但會記低係邊個落。', 'info')}
    <div class="grid g3 mt-12">
      ${stat({ k: '待接收', v: inb.filter(x => x.state === 'pending').length, u: '項', tone: inb.some(x => x.state === 'pending') ? 'warn' : 'ok' })}
      ${stat({ k: '已接收', v: inb.filter(x => x.state === 'accepted').length, u: '項', tone: 'ok' })}
      ${stat({ k: '呢個支部發出', v: out.length, u: '項' })}
    </div>
    ${notice('分享只做兩樣：<b>通告</b>（通告頁）同<b>活動</b>（行事曆）。接收咗先會出現喺該支部自己嘅清單。', 'info')}
    ${card({ title: '收到嘅分享', body: table({
      cls: 'tbl compact', head: ['內容', '來自', '等級', '狀態', '邊個決定'],
      rows: inb.map(x => ({
        cells: [esc(x.title), esc(S.branchName(x.from)), visName(x.level),
          { pending: badge('待接收', 'y', true), accepted: badge('已接收', 'g', true), declined: badge('已退回', 'n', true), withdrawn: badge('已撤回', 'r', true) }[x.state] || x.state,
          x.decidedBy ? `${esc(x.decidedBy)}<div class="xs faint">${esc(x.decidedAt || '')}</div>` : '—']
      })), empty: '冇收到分享'
    }) })}
    ${card({ title: '呢個支部發出嘅分享', body: table({
      cls: 'tbl compact', head: ['內容', '去邊', '等級', '狀態', '對方決定'],
      rows: out.map(x => ({
        cells: [esc(x.title), x.to === 'all' ? '全旅' : esc(S.branchName(x.to)), visName(x.level),
          { pending: badge('等對方接收', 'y', true), accepted: badge('已接收', 'g', true), declined: badge('已退回', 'n', true), withdrawn: badge('已撤回', 'r', true) }[x.state] || x.state,
          x.decidedBy ? esc(x.decidedBy) + (x.decideNote ? `<div class="xs faint">理由：${esc(x.decideNote)}</div>` : '') : '—']
      })), empty: '未發出分享'
    }) })}
    `;
  } else if (tab === 'link') {
    body = `
    ${card({ title: '下游登記（ScriptProperties）', sub: `id 前綴：DOWNSTREAM_${esc(b.id)}_`,
      actions: can(role, 'branch_link_edit') ? `<button class="btn sm" data-register="${b.id}">${icon('edit', 13)} 改登記</button>` : '',
      body: kv([
      ['URL（必須 /exec）', dd.url ? `<span class="mono xs">${esc(dd.url)}</span>` : '<span class="faint">未登記</span>'],
      ['SHEET KEY（D）', dd.keyMask ? `<span class="mono xs">${esc(dd.keyMask)}</span> <span class="xs faint">（只存 server，永不落前端）</span>` : '—'],
      ['顯示名（_NAME）', esc(b.name)],
      ['sig 用途字串（_PURPOSE）', dd.purpose ? `<span class="mono xs">${esc(dd.purpose)}</span>` : '<span class="faint">未填 —— 未填就簽唔出去</span>'],
      ['API 版本（_API）', esc(dd.api || '—')],
      ['action 白名單', dd.readActions ? `${dd.readActions} 讀 / ${dd.writeActions} 寫` : '—'],
      ['登記時間（_AT）', esc(b.link.registeredAt || '—')]
    ]) })}
    ${(() => {
      const gate = gateOfLink(b.link);
      const gm = gateMeta(gate);
      const canEdit = can(role, 'branch_link_edit');
      const red = b.link.state === 'red';
      return card({
        title: '★ 支部系統登入通道（閂／開）', sub: '支部系統嗰邊冇掣 —— 呢個掣喺旅側',
        body: `
        ${notice('只有一件事：<b>旅決定閂唔閂「支部系統自己登入」嗰條通道</b>。閂咗之後，支部系統<b>就算已登記、經 sig 睇到張 SHEET，都唔畀佢自己登入</b>（回 403 <span class="mono">upstream_only:true</span>）—— 出入只經旅入口。<br>兩邊都開都完全得（有時反而方便）；冇話邊個係「標準」，純粹係旅嘅決定。', 'info')}
        <div class="grid g3 mt-12">
          ${stat({ k: '而家', v: gm.label, tone: gm.tone, hint: gm.desc })}
          ${stat({ k: '上次改動', v: b.link.gateBy || '—', hint: b.link.gateAt || '未改過' })}
          ${stat({ k: '下游確認', v: red ? '未登記（改唔到）' : 'confirmed', tone: red ? 'danger' : 'ok', hint: red ? '先登記下游先控制得到' : 'fail-closed：讀唔到就當閂咗' })}
        </div>
        ${red ? notice('未登記下游：呢個掣改唔到（唔會當成功）。先撳「改登記」填 URL ＋ KEY ＋ sig 用途。', 'warn') : ''}
        ${canEdit ? `<div class="btn-row mt-12">
          <button class="btn sm ${gate === 'open' ? 'primary' : ''}" data-gate="${b.id}" data-g="open" ${gate === 'open' || red ? 'disabled' : ''}>${icon('unlock', 13)} 開返支部系統登入</button>
          <button class="btn sm ${gate === 'sig-only' ? 'primary' : ''}" data-gate="${b.id}" data-g="sig-only" ${gate === 'sig-only' || red ? 'disabled' : ''}>${icon('lock', 13)} 閂支部系統登入（只經旅入口）</button>
        </div>` : `<div class="xs faint mt-12">你嘅角色唔可以改（要 <span class="mono">branch_link_edit</span> ＝ 旅長）。</div>`}
        <div class="mono-block mt-12">POST ${esc(dd.url || '（未登記）')}
{ action:"setGate", gate:"open"|"sig-only", sig:…, sig_ts:…, sig_nonce:… }
→ { success:true, data:{ unit, localLogin:true|false, confirmed:true } }</div>
        <div class="xs faint mt-8">下游寫入 · 上游唔會代寫 · 每次改動入審計（邊個／幾時）</div>
        <div class="xs faint mt-4">★ 有冇人入唔到？佢哋撳「🆘 求救」就送到嚟呢度（免登入）；閂之前唔使登記任何匙。★ 平台超管唔受呢個掣影響（驗身唔經下游登記）；本地領袖戶／SUPER 本地戶就一樣 <span class="mono">403</span>。</div>
        <div class="xs faint mt-4">★ 落閂前會自動做<b>前置檢查</b>：接駁燈綠／測試連線成功／進度下游已登記（升級 MD §12④）；未達標出警告，但唔硬擋（你仍然可以閂）。</div>
        `,
        ...(canEdit ? {} : {})
      });
    })()}
    ${(() => {
      const mine = S.rescuesOf(b.id);
      const open = mine.filter(r => r.state !== 'done');
      const canGate = can(role, 'branch_link_edit');
      const canPw = can(role, 'user_manage');
      const canReply = can(role, 'audit_view');
      return card({
        title: '🆘 求救（呢個支部送嚟嘅）', sub: `入口（免登入）：${RESCUE.entry}&b=${b.id} —— 入唔到就撳呢個，唔使自己搞任何嘢`,
        actions: `<button class="btn sm" data-copy-rescue="${b.id}">${icon('copy', 13)} 複製求救連結</button>`,
        body: `
        ${notice('求救制（取代之前嘅「逃生門」）：<b>入唔到／有咩問題 → 撳求救掣，送請求去 ADMIN</b>。ADMIN 喺旅系統處理（開返支部系統登入／重設密碼／答覆）。<br><b>求救唔會自動開任何嘢</b> —— ADMIN 一定要人手核實身份先做（唔然任何人打個字就入得）。', 'info')}
        ${notice('★ 求救表同 <b>Scout Admin「問題回報 TICK」對正合同</b>：標題 ＋ 嚴重度（低／中／高／緊急）＋ 問題詳情；送出時一份入旅系統求救單、一份以 <span class="mono">type:\'issue\'</span>（＋<span class="mono">sourceApp / troopId / name / contact</span>）經 <span class="mono">/api/proxy</span> 送去 ADMIN 收件匣 —— <b>ADMIN 張「問題回報」表唔使改任何嘢</b>。', 'info')}
        ${open.length ? `<div class="grid g3 mt-12">
          ${stat({ k: '待處理', v: open.length, u: '單', tone: 'warn' })}
          ${stat({ k: '最新', v: open[0].by, hint: open[0].at })}
          ${stat({ k: '類型', v: rescueKindMeta(open[0].kind).label, tone: 'n' })}
        </div>` : ''}
        ${table({
          cls: 'tbl compact', head: ['時間', '邊個', '標題 / 嚴重度', '類型', '內容', '狀態', 'ADMIN 動作'],
          rows: mine.map(r => ({
            cells: [
              `<span class="xs">${esc(r.at)}</span>`,
              `${esc(r.by)}<div class="xs faint">${esc(r.contact)}</div>`,
              `<b>${esc(r.title || '（未填標題）')}</b><div class="xs faint">嚴重度：${esc(r.severity || '—')}</div>`,
              rescueKindMeta(r.kind).label,
              `${esc(r.note || '—')}${r.reply ? `<div class="xs faint">ADMIN 回覆：${esc(r.reply)}</div>` : ''}`,
              r.state === 'done' ? badge('已處理', 'g', true) : badge('待處理', 'y', true),
              r.state === 'done'
                ? `<span class="xs faint">${esc(r.done?.by || '')} · ${esc(r.done?.at || '')} · ${esc(rescueMeta(r.done?.action).label || '')}</span>`
                : `<div class="btn-row">
                    ${canGate ? `<button class="btn xs primary" data-rescue="${r.id}" data-r-act="open-gate">開返支部系統登入</button>` : ''}
                    ${canPw ? `<button class="btn xs" data-rescue="${r.id}" data-r-act="reset-pw">重設密碼</button>` : ''}
                    ${canReply ? `<button class="btn xs" data-rescue="${r.id}" data-r-act="reply">答覆並結案</button>` : ''}
                  </div>`
            ]
          })),
          empty: '冇求救單'
        })}
        ${(!canGate && !canPw) ? '<div class="xs faint mt-8">你嘅角色唔可以開閘／重設密碼（要旅長）—— 但可以答覆並結案。</div>' : ''}
        `
      });
    })()}
    ${card({ title: '求救係「請求」，唔係控制面', sub: '呢條線唔可以踩過去',
      body: `
      ${table({ cls: 'tbl compact', head: ['', '係咩', '可唔可以'], rows: [
      { cells: ['🆘 求救掣', '送請求去 ADMIN（免登入；支部系統 403 頁／旅閘／旅系統支部頁都有）', '<span class="tag g sm">可以</span>'] },
      { cells: ['自動開閘／自動解鎖', '任何人打字就入得 —— 就唔係「旅側決定」', '<span class="tag r sm">永遠唔會</span>'] },
      { cells: ['自動重設密碼', '未核實身份就改密碼＝幫人偷帳號', '<span class="tag r sm">永遠唔會</span>'] },
      { cells: ['支部系統前台「開返／解鎖」掣', '有掣＝支部自己決定，違反定案', '<span class="tag r sm">永遠冇</span>'] }
      ] })}
      <div class="xs faint mt-8">極少數情況（旅側同平台都連唔到）：${RESCUE.fallback}。唔再喺 UI 做逃生門（用戶定案）。</div>
      ` })}
    ${card({ title: '求救可以處理咩情況', sub: '「咩情況求救都可以處理」—— 唔使再分好多種制度',
      body: `
      ${table({ cls: 'tbl compact', head: ['類型', '例子', 'ADMIN 通常點做'], rows: RESCUE.kinds.map(k => ({
        cells: [k.label, `<span class="xs">${esc(k.hint)}</span>`, `<span class="xs">${esc({ locked: '開返支部系統登入', password: '重設密碼（發臨時密碼）', link: '查接駁／登記下游', rights: '改身份／權限', other: '答覆佢' }[k.id] || '答覆佢')}</span>`]
      })) })}
      <div class="xs faint mt-8">求救要填：${RESCUE.fields.join('、')}。${RESCUE.note}</div>
      ` })}
    ${card({ title: '邊個鎖得住、邊個鎖唔住', sub: '求救係第一站；下面兩層係求救都處理唔到嗰陣',
      body: `
      ${table({ cls: 'tbl compact', head: ['', '靠咩入', '鎖得住嗎', '限制'], rows: [
      { cells: ['<b>旅側 ADMIN（旅長／教練員）</b>', '旅 SHEET ＋ 接駁（<span class="mono">sig</span>）', '<span class="tag y sm">自己壞就跟住壞</span>', '求救要佢收到先處理到；GAS／Vercel／密鑰／人冇咗就冇'] },
      { cells: [`<b>${RESCUE.platform.label}</b>`, '中央／平台驗身 —— <b>唔經下游登記</b>', '<span class="tag g sm">鎖唔住</span>', 'ADMIN 都入唔到嗰陣，超管入得返重設 ADMIN 密碼／補登記；要平台＋網絡'] },
      { cells: ['本地領袖戶／SUPER 本地戶', '支部系統本地密碼', '<span class="tag r sm">一樣 403</span>', '唔係出路（否則「閂」就冇意思）'] }
      ] })}
      <div class="xs faint mt-8">超管入口：<span class="mono">${RESCUE.platform.entry}</span>（唔喺任何名單／導航出現）。</div>
      ` })}
    ${card({ title: '接駁測試與診斷', actions: `<button class="btn sm" data-ping="${b.id}">${icon('refresh', 13)} 測試連線（sig）</button>`,
      body: `<div class="mono-block">POST ${esc(dd.url || '（未登記）')}
？sig=&sts=…&snonce=…   （query 通道；防 GAS 302 轉址遺失）
{ action:"getLinkState", sig:…, sig_ts:…, sig_nonce:… }   （body 通道）
→ { success:true, data:{ unit, version, localLogin, tables, rows } }</div>
      <div class="xs faint mt-8">時窗 ±5 分鐘 · nonce 一次性（CacheService 10 分鐘）· body ≤900KB · sig 必須 64 位 hex · 一律 POST 唔收 GET 帶 sig</div>` })}
    ${notice('示範模式：撳掣會即刻回應「成功／失敗」示範結果，但唔會真係發任何請求。', 'info')}
    `;
  } else if (tab === 'account') {
    body = `
    ${notice('開戶錨點（死規矩）：<b>成員（SCOUT_ID／YMIS）＝該團支部 SHEET</b>（名冊所在）；<b>領袖（EMAIL）＝所屬層</b>；<b>家長（EMAIL）＝有旅就旅</b>。旅可以「揀團開戶」，但落筆嘅永遠係該團。', 'info')}
    <div class="grid g2 mt-12">
      ${card({ title: '為下游開戶（旅長代做）', sub: '① 旅本地開戶 → ② 讀回 password_hash → ③ sig 打下游 upsertUser（兩邊同一 hash）',
        body: `<div class="btn-row">
          <button class="btn sm primary" data-open-account="${b.id}">${icon('users', 14)} 為 ${esc(b.name)} 開戶</button>
          <button class="btn sm" data-bulk="${b.id}">批量 CSV（成員）</button>
          <button class="btn sm" data-migrate="${b.id}">搬舊數（JSON 含 hash）</button>
        </div>
        <div class="xs faint mt-8">成員戶只可以由該團落筆（旅經 sig 入去寫，AUDIT 記 actor=旅長 via=sig）。</div>` })}
      ${card({ title: '本地領袖戶（災難恢復）', body: kv([
      ['本地領袖戶', '1 個（監護）'],
      ['SUPER 備援', '需要時由平台 SUPER_KEY 重設'],
      ['密碼雜湊', 'PBKDF2-SHA256 ≥100k · per-user salt'],
      ['登入保護', '每帳號 5 次失敗鎖 15 分鐘']
    ]) })}
    </div>
    ${card({ title: `名冊（${mem.length} 筆示範）`, sub: '真模式：名冊正本住該團支部 Sheet，旅只經 sig 讀摘要', body: table({
      cls: 'tbl compact', head: ['YMIS', '姓名', '身份', '小隊', '生日', '狀態'],
      rows: mem.map(m => ({ cells: [{ text: m.ymis, cls: 'mono' }, esc(m.name), esc(m.identity), esc(m.patrol), esc(m.dob), badge(m.status === 'ACTIVE' ? 'ACTIVE' : m.status, m.status === 'ACTIVE' ? 'g' : 'y', true)] })),
      empty: '示範名冊未包含此支部'
    }) })}
    `;
  } else if (tab === 'public') {
    const items = d.publicProfile.branches.filter(p => p.branchId === b.id);
    body = `${card({ title: '支部公開資料', sub: '等級 0＝免登入；1＝其他支部；2＝團員；3＝執委；4＝領袖；5＝團長', body: table({
      cls: 'tbl compact', head: ['項目', '內容', '可見等級'],
      rows: items.map(p => ({ cells: [esc(p.title), `<span class="mono xs">${esc(p.value)}</span>`, badge(visName(p.vis), p.vis === 0 ? 'b' : 'n', true)] })),
      empty: '此支部未上報公開資料'
    }) })}
    ${notice('分享前設：接收方（支部）要有該模組先分享得到 —— 呢個清單由模組註冊表過濾，唔會出現「分享咗入唔到」嘅情況。', 'info')}`;
  } else if (tab === 'finance') {
    body = fin ? `${card({ title: `財務提交 · ${esc(fin.fy)} · ${esc(fin.period)}`, body: `
      <div class="grid g4">${stat({ k: '收入', v: money(fin.income) })}${stat({ k: '支出', v: money(fin.expense) })}${stat({ k: '結餘', v: money(fin.balance) })}${stat({ k: '憑證筆數', v: fin.entries, u: '筆' })}</div>
      <div class="mt-12">${kv([['提交人', esc(fin.submittedBy || '—')], ['提交時間', esc(fin.at)], ['狀態', badge(fin.state, fin.state === 'accepted' ? 'g' : fin.state === 'query' ? 'r' : 'y')], ['簽名', fin.signed ? '✓ 支部用自己 key 簽' : '✕']])}</div>
      ${fin.query ? `<div class="mt-12">${notice('旅長退問：' + esc(fin.query), 'warn')}</div>` : ''}
      <div class="btn-row mt-12"><button class="btn sm" data-ask-fin="${b.id}">退問／要求補件</button></div>` })}`
      : `<div class="empty">此支部未提交財務摘要</div>`;
  } else if (tab === 'inventory') {
    const items = d.inventory.filter(i => i.owner === b.id || (i.loans || []).some(l => l.to === b.id));
    body = `${card({ title: '物資（此支部擁有或借用中）', body: table({
      cls: 'tbl compact', head: ['物資', '擁有者', '總數', '借出', '共享範圍', '狀態'],
      rows: items.map(i => ({
        cells: [esc(i.name), esc(S.branchName(i.owner)), String(i.total), String(i.out),
          i.scope === 'all' ? '全旅' : i.scope === 'troop' ? '旅內' : '本支部',
          badge(i.state === 'shared' ? '共享中' : i.state === 'broken' ? '待維修' : '本支部自用', i.state === 'shared' ? 'g' : i.state === 'broken' ? 'r' : 'n', true)]
      })), empty: '冇物資紀錄'
    }) })}`;
  } else if (tab === 'progress') {
    if (!b.progressSource) { body = notice('此支部未接進度 leaf（或者未開支部系統）。', 'warn'); }
    else {
      const prog = Object.entries(d.progress).filter(([, v]) => v.source === b.progressSource);
      body = `${notice('旅系統<b>唔會</b>自己做進度 UI —— 進度 leaf 保留自己詳細 UI（UI 豁免）。旅只讀<b>摘要</b>用嚟做家長頁／儀表板。', 'info')}
      ${card({ title: '進度摘要', body: table({
        cls: 'tbl compact', head: ['YMIS', '成員', '獎章', '進度', '最新'],
        rows: prog.map(([y, v]) => ({ cells: [{ text: y, cls: 'mono' }, esc(S.memberByYmis(y)?.name || '—'), esc(v.award), progressBar(v.awardPct, v.awardPct + '%'), `<span class="xs faint">${esc(v.updated)}</span>`] })),
        empty: '冇進度紀錄'
      }) })}`;
    }
  } else {
    body = `${card({ title: '名冊', body: table({
      cls: 'tbl compact', head: ['YMIS', '姓名', '身份', '狀態'],
      rows: mem.map(m => ({ cells: [{ text: m.ymis, cls: 'mono' }, esc(m.name), esc(m.identity), badge(m.status, 'g', true)] })),
      empty: '（示範名冊未包含）'
    }) })}`;
  }

  el.innerHTML = page({
    title: b.name, sub: `${b.section} · ${b.code} · 團長 ${b.leader}`, back: 'branches',
    actions: `${linkBadge(b.link.state)} ${S.canSeeBranch(b) && b.hasPortal ? `<button class="btn sm primary" data-enter="${b.id}">${icon('arrowR', 13)} 進入支部</button>` : ''}`,
    body: tabsHtml + body
  });

  el.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => go(`branch/${b.id}?tab=${t.dataset.tab}`)));
  el.querySelectorAll('[data-enter]').forEach(x => x.addEventListener('click', () => openEnterBranch(x.dataset.enter)));
  el.querySelector('[data-ping]')?.addEventListener('click', () => pingBranch(b.id));
  el.querySelectorAll('[data-gate]').forEach(x => x.addEventListener('click', () => setBranchGateUI(b.id, x.dataset.g)));
  el.querySelector('[data-copy-rescue]')?.addEventListener('click', () => {
    copyText(location.origin + '/index.html?step=rescue&b=' + b.id);
    toast('已複製求救連結（貼去團長群／支部系統 403 頁都用得）', 'ok', '', null, 5000);
  });
  el.querySelectorAll('[data-rescue]').forEach(x => x.addEventListener('click', () => handleRescue(x.dataset.rescue, x.dataset.rAct)));
  el.querySelector('[data-register]')?.addEventListener('click', () => openRegisterDownstream(b.id));
  el.querySelector('[data-open-account]')?.addEventListener('click', () => openAccountFor(b.id));
  el.querySelector('[data-bulk]')?.addEventListener('click', () => openBulk(b.id));
  el.querySelector('[data-migrate]')?.addEventListener('click', () => openMigrate(b.id));
  el.querySelector('[data-ask-fin]')?.addEventListener('click', () => askFinance(b.id));
}

/* ---------------- 入支部：三條路 ---------------- */
export function openEnterBranch(id) {
  const d = S.load();
  const b = S.branchById(id);
  const u = S.currentUser();
  const dd = d.downstream[b.id] || {};
  const origin = location.origin;
  const roleFor = { chief: 'troop_leader', coach: 'coach', parent: 'parent', member: 'branch_person' }[S.getSession()?.role] || 'branch_person';
  const portalUrl = dd.portalOrigin
    ? `${dd.portalOrigin}/?from=portal&u=${b.code}&role=${roleFor}&src=${encodeURIComponent(origin)}&ymis=${encodeURIComponent(u?.id || '')}&name=${encodeURIComponent(u?.name || '')}&embed=0`
    : '（該下游未設 portalOrigin，portal 路未開放）';
  const route = b.link.state === 'red' ? 'A' : (b.link.state === 'yellow' ? 'P' : 'S');

  const bodyHtml = `
  <div class="tabs" id="enter-routes">
    ${[['P', 'Portal 入口'], ['S', 'sig 轉發'], ['A', 'apikey 過渡']].map(([k, l]) => `<button class="${k === route ? 'on' : ''}" data-r="${k}">${l}</button>`).join('')}
  </div>
  <div id="enter-body"></div>
  <div class="mt-12">${notice('三條路都係 server-side 揀路，前端唔知亦唔可以改；揀唔到就老實講「未接通」，唔會靜靜地當成功。', 'info')}</div>`;

  const ROUTE = {
    P: {
      title: 'P · Portal 入口（推薦、今日可行）',
      desc: '旅把<b>已驗證身份</b>交俾下游：帶 <span class="mono">from=portal</span> 同 <span class="mono">src=旅 origin</span>，下游核來源＋角色白名單之後發一次性 <span class="mono">portalToken</span> → 免登入入去。',
      pros: ['下游零改動（vs_portal 已經 built）', '唔使交任何 key', '身份仍然由下游重新確認'],
      cons: ['會跳去下游網域（係另一頁）'],
      url: portalUrl,
      status: dd.portalOrigin ? 'g' : 'r',
      statusText: dd.portalOrigin ? '此下游已設 portalOrigin' : '此下游未設 portalOrigin（fail closed）'
    },
    S: {
      title: 'S · sig 轉發（真正整合）',
      desc: '旅 server-side 用 <span class="mono">sig</span> 讀寫下游，聚合資料<b>原地顯示</b>（唔跳轉）；要代支部做嘅操作（開戶、搬數、閂口）同樣走呢條。',
      pros: ['體驗最完整（唔跳轉）', '可以代支部做事', '下游同步回結果，成敗即刻知'],
      cons: ['要先有下游側 sign 驗簽實作'],
      url: dd.url ? `POST ${dd.url}（sig 雙通道）` : '（未登記下游）',
      status: b.link.state === 'green' ? 'g' : b.link.state === 'yellow' ? 'y' : 'r',
      statusText: b.link.state === 'green' ? '已接駁，可用' : b.link.state === 'yellow' ? '已登記但未閂本地入口' : '未接駁'
    },
    A: {
      title: 'A · apikey 過渡（P1 之後退役）',
      desc: '用 Vercel env <span class="mono">TROOP_&lt;團&gt;_BACKEND / _APIKEY</span> 由伺服器端讀。只在該下游未有 sig 時用，而且<b>閂口之後即失效</b>。',
      pros: ['今日即刻有的讀取'],
      cons: ['寫入要另計權限', '閂口後完全唔通', '等於繞過上游控制'],
      url: dd.url ? `POST /api/troop → ${dd.url}` : '（未登記）',
      status: gateOfLink(b.link) === 'open' ? 'y' : 'r',
      statusText: gateOfLink(b.link) === 'open' ? '支部系統自己登入得（旅容許）' : '旅閂咗支部系統登入 —— 呢條路唔通'
    }
  };

  const m = modal({
    title: `入 ${b.name}`,
    wide: true,
    body: bodyHtml,
    footer: `<button class="btn" data-close>關閉</button>
      <button class="btn" data-copy>${icon('copy', 14)} 複製網址</button>
      ${route === 'P' && dd.portalOrigin ? `<a class="btn primary" href="${esc(portalUrl)}" target="_blank" rel="noopener">示範：模擬跳轉 ${icon('arrowR', 14)}</a>` : ''}`
  });

  const paint = k => {
    const r = ROUTE[k];
    const box = m.el.querySelector('#enter-body');
    box.innerHTML = `
      <div class="flex-b mb-8"><h3 class="mb-0">${r.title}</h3><span class="tag ${r.status}">${esc(r.statusText)}</span></div>
      <p>${r.desc}</p>
      <div class="mono-block mb-12">${esc(r.url)}</div>
      <div class="grid g2">
        <div class="ok-box"><b>好處</b><ul class="mt-4">${r.pros.map(p => `<li>${p}</li>`).join('')}</ul></div>
        <div class="warn-box"><b>代價</b><ul class="mt-4">${r.cons.map(p => `<li>${p}</li>`).join('')}</ul></div>
      </div>
      <div class="flex mt-12" style="gap:14px;align-items:flex-start">
        <div class="qr-box">${qrSvg(r.url, 3, 1)}</div>
        <div class="grow xs faint">
          <div><b>QR 永不帶 key</b>（分享連結／QR 只帶旅團編號同身份標記）。</div>
          <div class="mt-4">示範模式：跳轉只會去一個假的支部頁（唔會離開呢個示範）。</div>
          <div class="mt-4">真模式：下游核 <span class="mono">Referer/Origin</span> 同 <span class="mono">portalOrigin</span>，對唔上就 <span class="mono">referer_mismatch</span>（fail closed）。</div>
        </div>
      </div>`;
    m.el.querySelectorAll('[data-r]').forEach(b2 => b2.classList.toggle('on', b2.dataset.r === k));
    m.el.dataset.url = r.url;
  };
  paint(route);
  m.el.querySelectorAll('[data-r]').forEach(x => x.addEventListener('click', () => paint(x.dataset.r)));
  m.el.querySelector('[data-close]').onclick = m.close;
  m.el.querySelector('[data-copy]').onclick = () => copyText(m.el.dataset.url || '');
}

/* ---------------- 操作：測試連線 / 閂口 / 登記 / 開戶 / 搬數 ---------------- */
function pingBranch(id) {
  const b = S.branchById(id);
  const ok = b.link.state !== 'red';
  setTimeout(() => {
    if (ok) {
      toast(`sig 測試成功：${b.name} 回 { success:true } · gate=${gateOfLink(b.link)}（localLogin=${gateOfLink(b.link) === 'open' ? 'on' : 'off'}）`, 'ok', '', null, 5200);
      S.audit('測試下游連線', `${b.name}（${id}）`, 'sig 驗證成功');
      S.commit(d => { const t = d.branches.find(x => x.id === id); if (t) t.link.lastPing = new Date().toISOString().slice(0, 16).replace('T', ' '); }, { markDirty: false });
    } else {
      toast(`${b.name}：未登記下游（或者 URL 唔係正式 /exec）→ 拒收`, 'err', '', null, 5200);
    }
  }, 600);
}

/* ★ 閂口前置檢查（升級 MD §12④：先搬數、先測連線，先至閂口）
   未達標＝出警告；唔硬擋（用戶 2026-09-25 定案：未達標出警告，同意）。 */
export function gatePreflight(id) {
  const b = S.branchById(id);
  if (!b) return [];
  const dd = S.load().downstream[id] || {};
  return [
    {
      k: '接駁燈綠（已接駁）', ok: b.link.state === 'green',
      hint: b.link.state === 'green' ? '已接駁、名冊／進度讀得到' : `而家係${b.link.state === 'yellow' ? '黃燈（已登記、未閂口）' : '紅燈（未登記）'} —— 接駁未落實`
    },
    {
      k: '測試連線成功（sig）', ok: !!b.link.testedAt,
      hint: b.link.testedAt ? `上次測試：${b.link.testedAt}` : '未測過連線 —— 閂咗之後有事查唔到'
    },
    {
      k: '進度下游已登記', ok: !!b.progressSource,
      hint: b.progressSource ? `進度來源：${b.progressSource}` : '進度頁未接好 —— 升級 MD 寫明「未起好呢條路之前唔好閂口」'
    },
    {
      k: '帳號下限（該 leaf 仲有領袖戶）', ok: true,
      hint: '本地領袖戶照留；閂咗之後佢一樣 403，但戶口唔會消失（有咩事入 Sheet 都搵得返人）'
    }
  ].map(x => ({ ...x, key: x.k }));
}

/* ★ 支部系統登入通道：兩個狀態，旅側唯一控制面 */
async function setBranchGateUI(id, gate) {
  const b = S.branchById(id);
  const { confirmDlg } = await import('../lib/util.js');
  if (gateOfLink(b.link) === gate) return;
  const copy = {
    open: {
      title: '開返「支部系統自己登入」',
      msg: `之後：支部系統前台可以自己登入呢個下游（旅入口亦照入）。<br>旅嘅決定 —— 兩邊都開都得，冇話邊個先啱。`,
      ok: '開返', danger: false
    },
    'sig-only': {
      title: '閂「支部系統自己登入」',
      msg: `之後：支部系統<b>唔可以自己登入</b>（本地直接登入回 403）—— <b>就算已登記、經 sig 睇到張 SHEET，都唔畀佢入</b>；出入只經旅入口。<div class="mt-8">• 下游唔會收到本地登入請求（前端路徑已由旅接手）<br>• <b>有人入唔到唔使怕</b>：佢撳「🆘 求救」就會送到嚟（免登入，旅閘／支部系統 403 頁／呢一頁都有連結）<br>• 你收到求救單之後：撳「開返支部系統登入」或者「重設密碼」就搞返 —— 唔使登記任何匙</div>`,
      ok: '閂咗佢', danger: true
    }
  }[gate];
  let msg = copy.msg + (gate === 'sig-only'
    ? `<div class="mt-12 xs faint">有人入唔到：叫佢撳 <b>🆘 求救</b>（${RESCUE.entry}&b=${id}，免登入）—— 求救單會出現喺呢一頁同「待辦與批核」，你撳一下「開返支部系統登入」就搞返。</div>`
    : '');
  /* 閂口前置檢查（未達標＝警告；唔硬擋） */
  let failed = [];
  if (gate === 'sig-only') {
    const checks = gatePreflight(id);
    failed = checks.filter(c => !c.ok);
    msg += `<div class="mt-12"><b>閂口前置檢查</b>（升級 MD §12④：先搬數、先測連線，先至閂口）<div class="mt-8">
      ${checks.map(c => `<div class="${c.ok ? '' : 'err'}">${c.ok ? '✓' : '✗'} <b>${esc(c.k)}</b> <span class="xs faint">${esc(c.hint)}</span></div>`).join('')}
    </div>${failed.length ? `<div class="err mt-8"><b>⚠ ${failed.length} 項未達標</b> —— 你仍然可以閂（唔硬擋），但先確認：名冊／進度已搬齊？救援路線（求救掣）貼咗去團長群？</div>` : '<div class="xs faint mt-8">全部達標 ✓</div>'}</div>`;
  }
  if (await confirmDlg({ title: copy.title, message: msg, ok: copy.ok, danger: copy.danger })) {
    await applyGate(id, gate, failed.length ? `前置檢查未達標：${failed.map(c => c.k).join('、')}` : '前置檢查全部達標');
  }
}

/* 🆘 求救：ADMIN 處理（開返閘／重設密碼／答覆結案）—— 全部人手做，逐單留紀錄 */
async function handleRescue(id, action) {
  const r = S.rescueById(id);
  if (!r) return;
  const b = S.branchById(r.branchId);
  const { confirmDlg, promptDlg } = await import('../lib/util.js');
  const name = b ? b.name : r.branchId;
  if (action === 'open-gate') {
    const ok = await confirmDlg({
      title: `開返「支部系統自己登入」· ${name}`,
      message: `求救：<b>${esc(r.by)}</b> · ${esc(rescueKindMeta(r.kind).label)}<br><div class="xs faint">${esc(r.note || '')}</div><br>會發 <span class="mono">sig setGate gate=open</span> 落下游 —— 之後支部系統自己登入得，旅入口亦入得。<div class="xs faint mt-8">身份要自己核實（電話／熟人）：求救單本身冇驗身份。</div>`,
      ok: '開返'
    });
    if (!ok) return;
    const res = S.resolveRescue(id, { action: 'open-gate' });
    if (!res.ok) { toast(res.msg, 'err', '', null, 6000); return; }
    S.audit('求救處理：開返支部系統登入', `${name}（${r.branchId}）`, `求救單 ${id} · ${r.by}`, 'sig');
    toast('已開返：下游回 confirmed（支部系統自己登入得）', 'ok', '', null, 5000);
  } else if (action === 'reset-pw') {
    const acc = await promptDlg({ title: '重設密碼', label: '帳號（email 或 YMIS）', placeholder: 'sc-cpl@demo.troop', hint: '成員戶真模式要該團團長執行（帳號住該團）' });
    if (!acc) return;
    const res = S.resolveRescue(id, { action: 'reset-pw', account: acc });
    if (!res.ok) { toast(res.msg, 'err', '', null, 6000); return; }
    S.audit('求救處理：重設密碼', acc, `求救單 ${id} · 臨時密碼已發（首登強制改）`, 'UI');
    toast(`已重設：臨時密碼 ${res.tempPw}（示範）—— 首登會強制改；記得用電話／熟人核實過身份先講`, 'ok', '', null, 7000);
  } else {
    const reply = await promptDlg({ title: `答覆 · ${name}`, label: '答覆內容（求救紀錄會留住）', placeholder: '例：已經開返，你試下再登入；唔得就打我電話。' });
    if (!reply) return;
    const res = S.resolveRescue(id, { action: 'reply', reply });
    if (!res.ok) { toast(res.msg, 'err'); return; }
    S.audit('求救處理：答覆結案', `${name}（${r.branchId}）`, `求救單 ${id}；回覆：${reply}`, 'UI');
    toast('已答覆並結案（求救單入紀錄）', 'ok');
  }
  go('branch/' + r.branchId + '?tab=link');
}

async function applyGate(id, gate, detail = '') {
  const b = S.branchById(id);
  const r = S.setBranchGate(id, gate);
  if (!r.ok) { toast(r.msg, 'err', '', null, 6000); return; }   // 誠實失敗：唔會當成功
  S.audit(gate === 'sig-only' ? '閂支部系統登入' : '開返支部系統登入', `${b.name}（${id}）`,
    `gate=${gate}（示範：唔會真發 sig；真模式＝下游 setGate 回 confirmed）${detail ? ' · ' + detail : ''}`, 'sig');
  toast(gate === 'sig-only'
    ? '已送 sig：下游回 confirmed —— 支部系統唔可以自己登入'
    : '已送 sig：下游回 confirmed —— 支部系統可以自己登入', 'ok', '', null, 5000);
  go('branch/' + id + '?tab=link');
}

function openRegisterDownstream(editId = '') {
  const d = S.load();
  const b = editId ? S.branchById(editId) : null;
  const dd = b ? (d.downstream[b.id] || {}) : {};
  const presetPurposes = ['vsbadge-troop-sig-v1', 'roverbadge-troop-sig-v1', 'cubsbadge-troop-sig-v1', 'scoutbadge-troop-sig-v1', 'vsportal-troop-sig-v1'];
  const m = modal({
    title: b ? `改登記 · ${b.name}` : '登記下游（旅 → 團）',
    body: `
    ${notice('只寫入旅 GAS <b>ScriptProperties</b>：<span class="mono">DOWNSTREAM_&lt;id&gt;_URL / _KEY / _NAME / _AT / _PURPOSE / _API</span>。唔入任何 Sheet、唔郁 Vercel env。', 'info')}
    <label class="f mt-12"><span class="lb">下游 id（英數／底線／連字號，最長 32）</span><input type="text" id="rd-id" value="${esc(b?.id || '')}" placeholder="vs0082" ${b ? 'readonly' : ''}></label>
    <label class="f"><span class="lb">URL（必須係正式 GAS /exec）</span><input type="text" id="rd-url" value="${esc(dd.url || '')}" placeholder="https://script.google.com/macros/s/…/exec"></label>
    <label class="f"><span class="lb">SHEET KEY（下游嘅 D）</span><input type="text" id="rd-key" value="" placeholder="（只存 server；示範唔會保存真 key）"></label>
    <label class="f"><span class="lb">顯示名（_NAME）</span><input type="text" id="rd-name" value="${esc(b?.name || '')}" placeholder="童軍團"></label>
    <label class="f"><span class="lb">sig 用途字串（_PURPOSE）★ 必填</span>
      <input type="text" id="rd-purpose" value="${esc(dd.purpose || '')}" placeholder="vsbadge-troop-sig-v1" list="rd-purposes">
      <datalist id="rd-purposes">${presetPurposes.map(p => `<option value="${p}"></option>`).join('')}</datalist>
      <div class="hint">每個下游 repo 一條（例 <span class="mono">vsbadge-troop-sig-v1</span>）。填錯＝測試連線即刻報「簽名不符」，唔會靜靜地唔通。</div></label>
    <label class="f"><span class="lb">下游 action API 版本（_API）</span><input type="text" id="rd-api" value="${esc(dd.api || 'v1')}"></label>
    `,
    footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-save>${icon('check', 14)} 登記</button>`
  });
  m.el.querySelector('[data-close]').onclick = m.close;
  m.el.querySelector('[data-save]').onclick = () => {
    const id = sanitizeLabel(m.el.querySelector('#rd-id').value).toLowerCase();
    const url = m.el.querySelector('#rd-url').value.trim();
    const purpose = m.el.querySelector('#rd-purpose').value.trim();
    if (!id) return toast('要填下游 id', 'err');
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{10,}\/exec\/?$/.test(url)) return toast('URL 一定要係 https://script.google.com/macros/s/…/exec', 'err');
    if (!purpose) return toast('要填 sig 用途字串（唔填簽唔出去）', 'err');
    S.commit(dd2 => {
      dd2.downstream[id] = { ...(dd2.downstream[id] || {}), url, purpose, api: m.el.querySelector('#rd-api').value.trim() || 'v1', readActions: 12, writeActions: 19, keyMask: '••••••••••••' };
      const ex = dd2.branches.find(x => x.id === id);
      if (ex) { ex.link.state = ex.link.state === 'red' ? 'yellow' : ex.link.state; ex.link.purpose = purpose; ex.link.api = 'v1'; ex.link.registeredAt = new Date().toISOString().slice(0, 10); }
      else dd2.branches.push({ id, code: '', name: m.el.querySelector('#rd-name').value.trim() || id, section: '（未分類）', color: '#6b7a70', youth: 0, adults: 0, founded: '—', leader: '—', leaderEmail: '', link: { state: 'yellow', purpose, api: 'v1', gate: 'open', localLogin: true, registeredAt: new Date().toISOString().slice(0, 10), lastPing: '—', backend: url, note: '新登記' }, progressSource: '', hasPortal: false, publicRank: 1 });
    });
    S.audit('登記下游', `${id}`, `purpose=${purpose}`);
    m.close();
    toast('已登記下游（ScriptProperties）—— 跟住撳「測試連線」', 'ok');
  };
}

function openAccountFor(id) {
  const b = S.branchById(id);
  const m = modal({
    title: `為下游開戶 · ${b.name}`,
    body: `
    ${notice('流程：① 旅本地開戶（角色權限、YMIS／Email 唯一性照舊）→ ② 讀回 <span class="mono">password_hash</span> → ③ <span class="mono">sig</span> 打下游 <span class="mono">upsertUser</span>。<b>兩邊同一個 hash</b>，同一個臨時密碼兩邊都啱用；首登仍然強制改密碼。', 'info')}
    <label class="f mt-12"><span class="lb">身份</span><select id="oa-role"><option value="member">支部人員：成員／團長／副團長（SCOUT_ID／YMIS）— 只可以由該團落筆</option><option value="coach">教練員（EMAIL · 旅層）</option></select></label>
    <label class="f"><span class="lb">YMIS／Email</span><input type="text" id="oa-sub" placeholder="YMIS-2100 或 coach@example.hk"></label>
    <label class="f"><span class="lb">姓名</span><input type="text" id="oa-name"></label>
    <label class="f"><span class="lb">臨時密碼</span><input type="text" id="oa-pw" value="1234"><div class="hint">首登強制改（≥4 位）。upsertUser 語義：帶明文密碼一律拒；一定要帶 64 位 hex hash。</div></label>
    <div class="warn-box">成員戶：旅唔會自己開 —— 呢一步係「經 sig 入該團落筆」，AUDIT 會記 <span class="mono">actor=旅長 via=sig</span>。</div>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-save>開戶並推落下游</button>`
  });
  m.el.querySelector('[data-close]').onclick = m.close;
  m.el.querySelector('[data-save]').onclick = () => {
    const sub = m.el.querySelector('#oa-sub').value.trim();
    const name = m.el.querySelector('#oa-name').value.trim();
    if (!sub || !name) return toast('要填編號同姓名', 'err');
    S.audit('為下游開戶', `${b.name}（${id}）${name}`, '兩邊同一 hash · 首登強制改密碼', 'sig');
    m.close();
    toast(`已為 ${name} 開戶：旅已寫入，下游回 { success:true }（兩邊同一 hash）`, 'ok', '', null, 6000);
  };
}

function openBulk(id) {
  const b = S.branchById(id);
  const m = modal({
    title: `批量開戶（CSV）· ${b.name}`,
    body: `${notice('CSV 欄位：<span class="mono">ymis,name,dob,identity,patrol</span>。一次最多 2000 筆；同 YMIS 認回同一身份＝更新；撞號會列出俾你人手處理。', 'info')}
    <label class="f mt-12"><span class="lb">貼上 CSV</span><textarea id="bl-csv">YMIS-2201,陳大文二世,2016-03-01,成員,綠六
YMIS-2202,李小明,2015-12-11,成員,綠六</textarea></label>
    <label class="check"><input type="checkbox" id="bl-dry" checked> 先驗證（唔寫入）</label>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-save>驗證並匯入</button>`
  });
  m.el.querySelector('[data-close]').onclick = m.close;
  m.el.querySelector('[data-save]').onclick = () => {
    const n = m.el.querySelector('#bl-csv').value.trim().split(/\n/).filter(Boolean).length;
    S.audit('批量開戶', b.name, `CSV ${n} 行（示範）`, 'UI');
    m.close();
    toast(`已驗證 ${n} 筆：新增 0、更新 ${n}、失敗 0（示範）`, 'ok');
  };
}

function openMigrate(id) {
  const b = S.branchById(id);
  const m = modal({
    title: `搬舊數（JSON 含 hash）· ${b.name}`,
    body: `${notice('方向係<b>下游主動吐</b>：舊進度 leaf「📤 匯出 JSON（含 hash）」→ 旅／新 sheet「📥 匯入 JSON」逐個 <span class="mono">upsertUser</span> 直插 hash（保留舊密碼）。<br><b>hash 讀唔到</b>（讀 action 回應永不包含 hash），所以唔可以「上游拉」。', 'info')}
    <label class="f mt-12"><span class="lb">Drive 連結或檔案 ID</span><input type="text" id="mg-id" placeholder="1AbC…（Drive 檔）"></label>
    <div class="grid g2"><label class="f"><span class="lb">只收</span><input type="text" value="64 位 hex hash；明文密碼／假 hash 一律拒" readonly></label>
    <label class="f"><span class="lb">上限</span><input type="text" value="一次 2000 筆；transferId 冪等" readonly></label></div>
    <div class="warn-box">匯完即刪 Drive 匯出檔（含 hash）＋核對筆數，先至閂下游直接入口。</div>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-save>匯入（示範）</button>`
  });
  m.el.querySelector('[data-close]').onclick = m.close;
  m.el.querySelector('[data-save]').onclick = () => {
    m.close();
    S.audit('匯入 JSON', b.name, '新增 18、更新 22、失敗 0（示範）', 'UI');
    toast('匯入完成：新增 18、更新 22、失敗 0', 'ok');
  };
}

async function askFinance(id) {
  const b = S.branchById(id);
  const { promptDlg } = await import('../lib/util.js');
  const reason = await promptDlg({ title: `退問 · ${b.name}`, label: '退問內容（支部會見到）', placeholder: '例：支出憑證 3 張未見（$640）' });
  if (!reason) return;
  S.commit(d => { const f = d.financeSubmits.find(x => x.branchId === id); if (f) { f.state = 'query'; f.query = reason; } });
  S.audit('財務退問', `${b.name} · 2026-09`, reason);
  toast('已退問，支部會收到通知', 'warn');
}

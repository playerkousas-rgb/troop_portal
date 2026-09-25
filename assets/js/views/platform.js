/* 平台（超管專用 · 隱藏） — 接入收件匣、units registry、金鑰與輪換
   ★ 呢個模組只有 role=super 見到；超管帳號唔會喺任何名單出現。 */
import { esc, icon, toast, copyText, downloadFile, fmtStamp } from '../lib/util.js';
import * as S from '../lib/store.js';
import { go } from '../lib/router.js';
import { page, card, table, badge, notice, tabs, stat, kv, modal, fold, chips } from './ui.js';

const TABS = [['inbox', '接入收件匣'], ['units', '旅登記（units）'], ['keys', '金鑰與輪換']];

export function render(el, params, query = {}) {
  const tab = query.tab || 'inbox';
  const d = S.load();
  const inbox = d.applications.filter(a => a.state === 'pending');
  const tabsHtml = `<div class="tabs">${TABS.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}${k === 'inbox' && inbox.length ? ` <span class="tag gold sm">${inbox.length}</span>` : ''}</button>`).join('')}</div>`;

  let body = '';
  if (tab === 'inbox') {
    body = `
    ${notice('超管專用（隱藏入口）：呢一頁唔會出現喺任何名單、導航或文件。所有接入都要<b>交俾邊個 ＋ 登記邊個 registry</b> —— 平台只做兩件事：批接入、登記 units。', 'info')}
    ${chips([
      { k: '待接入', v: inbox.length, tone: inbox.length ? 'warn' : 'ok' },
      { k: '已登記旅', v: 1 },
      { k: '下游總數', v: d.branches.length },
      { k: '紅燈支部', v: d.branches.filter(b => b.link.state === 'red').length, tone: 'danger' }
    ])}
    ${card({ title: '接入申請', sub: '新旅部署／新下游登記／超管重設請求', body: table({
      head: ['類型', '申請人', '內容', '時間', '狀態', '動作'],
      rows: inbox.map(a => ({
        cells: [
          badge({ troop: '新旅部署', account: '開戶', helper: '跨團幫手', member: '成員申請', publish: '公開上報', transfer: '移交' }[a.kind] || a.kind, a.kind === 'troop' ? 'gold' : 'n', true),
          esc(a.name), `<span class="xs">${esc(a.note)}</span>`, `<span class="xs faint">${esc(a.at)}</span>`,
          badge('待批', 'y', true),
          `<div class="btn-row"><button class="btn xs primary" data-ok="${a.id}">批准並接入</button><button class="btn xs danger" data-no="${a.id}">退回</button></div>`
        ]
      })), empty: '冇待接入申請'
    }) }) }
    ${fold({ title: '接入要做咩（7 步 checklists）', sub: '平台側動作', body: `<div class="steps">
      ${[
        '收到 B（旅後端 URL ＋ APIKEY）、C（旅名）、旅 ID',
        'data/units.json 加 entry（id / name / backend / key）',
        'Vercel env：TROOP_<旅ID>_BACKEND、_APIKEY、_NAME（Production 同 Preview 都要勾）',
        'Redeploy（唔 redeploy 唔會生效）',
        '旅長登入 → 逐個支部登記下游（URL ＋ KEY ＋ sig 用途）→ 測試連線',
        '題外提醒：map 通知旅長「已接駁」；未接駁嘅支部會顯示紅燈（誠實）',
        '輪換提醒：每季 rotate 一次；管理權者離任即刻 rotate'
      ].map(s => `<div class="step"><div>${esc(s)}</div></div>`).join('')}
    </div>` })}
    `;
  } else if (tab === 'units') {
    body = `
    ${notice('平台 registry 只有一份：<span class="mono">data/units.json</span> ＋ Vercel env。<b>唔會</b>寫入任何 Sheet；ABCD 四個變數永不落地。', 'info')}
    ${card({ title: '已登記旅', body: table({
      head: ['旅 ID', '名稱', '後端（B）', 'APIKEY（D）', '狀態', '加入日期'],
      rows: [
        { cells: ['<span class="mono">0082</span>', esc(d.unit.name), '<span class="mono xs">TROOP_0082_BACKEND</span>', badge('已設（隱藏）', 'g', true), badge('營運中', 'g', true), '2026-01-12'] }
      ]
    }) })}
    ${fold({ title: 'units.json 結構（示範）', open: true, body: `<div class="mono-block">${esc(JSON.stringify({
      units: [{ id: '0082', name: d.unit.name, backendEnv: 'TROOP_0082_BACKEND', keyEnv: 'TROOP_0082_APIKEY', nameEnv: 'TROOP_0082_NAME', region: 'hkg1', addedAt: '2026-01-12' }]
    }, null, 2))}</div>` })}
    ${card({ title: '旅閘診斷', sub: '旅長撳「診斷」時，平台側要對得上', body: `
      <div class="btn-row"><button class="btn sm" id="pf-diag">${icon('info', 13)} 模擬旅閘診斷輸出</button>
      <button class="btn sm" id="pf-copy">${icon('copy', 13)} 複製 units.json</button></div>` })}
    `;
  } else {
    body = `
    ${notice('金鑰輪換＝三處同步，漏一處就靜靜打唔通：<b>①下游 ScriptProperties</b> → <b>②上游 DOWNSTREAM_&lt;id&gt;_KEY</b> → <b>③平台 Vercel env（＋Redeploy）</b>。', 'warn')}
    ${card({ title: '目前輪換狀態', body: table({
      head: ['對象', '上次輪換', '下次到期', '狀態'],
      rows: [
        { cells: ['旅 apikey（D · TROOP_0082_APIKEY）', '2026-07-01', '2026-10-01', badge('12 日後到期', 'y', true)] },
        { cells: ['下游：童軍團 sc0082', '2026-09-01', '2026-12-01', badge('正常', 'g', true)] },
        { cells: ['下游：深資童軍 vs0082', '2026-05-20', '2026-08-20', badge('已過期 36 日', 'r', true)] },
        { cells: ['SUPER_KEY（A）', '2026-03-15', '2026-09-15', badge('已過期', 'r', true)] }
      ]
    }) })}
    ${card({ title: '外洩應變（照做，次序唔可以亂）', body: `<div class="steps">
      ${['停 SIG（旅長：接駁與金鑰 → 停簽）', '收本地密碼（支部側：閂本地登入）', '換 apikey（下游生成 → 上游登記 → 平台 env）',
      'registry 更新 ＋ flush cache', '換 SESSION_SECRET／SUPER_KEY', '查審計（邊個、幾時、用咩 key）', '恢復 SIG ＋ 通知受影響單位'].map(s => `<div class="step"><div>${esc(s)}</div></div>`).join('')}
    </div>` })}
    ${card({ title: '超管自己嘅安全', body: `<ul class="doc">
      <li>超管帳號 <span class="mono">hidden: true</span>：唔會出現喺帳號名單、唔計入統計、唔會被邀請或停用</li>
      <li>入口隱藏：<span class="mono">index.html?step=super</span>，或者旅閘撳 ⚜ 五下</li>
      <li>真模式：超管登入一樣要 PBKDF2 核對 ＋ 記入 ACCESS_LOG；SUPER_KEY 只喺 Vercel env</li>
      <li>日常唔用超管戶：超管只做「開旅、接入、輪換」，旅務一律用旅長戶</li>
      <li><b>超管登入唔靠下游登記</b>：某團未登記／紅燈／閂咗支部系統登入／接駁斷 —— 都唔影響你入唔入得（平台同任何支部頁都入得）</li>
      <li>你入得任何支部頁（方便救火）—— 但每頁有紅色橫額提醒：<b>日常唔好改嘢</b>，你嘅改動照入審計</li>
    </ul>` })}
    ${(() => {
      const n = S.rescuesPending();
      const list = S.openRescues();
      return card({
        title: '★ 超管救援（第二層）—— 你唔經支部 SHEET 登記，所以擋你唔住', sub: 'ADMIN 死咗／入唔到嗰陣，由你救',
        body: `
        ${notice('求救單正常由旅部 ADMIN 處理；呢張卡係<b>ADMIN 自己都入唔到</b>嗰陣用：<br>① 喺度<b>重設旅長（ADMIN）密碼</b> → 佢跟住就可以登入處理求救；② 或者（真模式）平台側直接開返閘。', 'warn')}
        <div class="grid g3 mt-12">
          ${stat({ k: '待處理求救', v: n, u: '單', tone: n ? 'warn' : 'ok', hint: list.length ? `最新：${esc(list[0].by)}` : '冇' })}
          ${stat({ k: '超管入得', v: '全部支部', hint: '未登記／紅燈／閂咗／接駁斷' })}
          ${stat({ k: '你嘅路徑', v: '平台驗身', hint: '唔經下游登記；要平台＋網絡' })}
        </div>
        <div class="btn-row mt-12">
          <button class="btn sm primary" id="pf-reset-admin">${icon('key', 13)} 重設旅長（ADMIN）密碼</button>
          <a class="btn sm" href="#/pending?kind=rescue">${icon('check', 13)} 睇求救單（${n}）</a>
        </div>
        <div class="xs faint mt-8">重設＝發臨時密碼、首登強制改；入 ACCESS_LOG／審計（邊個超管、幾時、重設邊個）。日常唔好用超管戶做旅務。</div>
        `,
        actions: `<a class="btn sm" href="#/branches">${icon('branch', 13)} 入任何支部</a>`
      });
    })()}
    ${card({ title: '★ 求救制（支部入唔到就撳求救，送請求去 ADMIN）', sub: '求救＋兩層備援 —— 冇逃生門、冇鑰匙登記、冇救援碼（用戶定案）', body: `
    <ul class="doc">
      <li><b>支部側（免登入）</b>：撳「🆘 求救」→ 填邊個團／你係邊個／點搵你／類型／描述 → 送出。入口：旅閘、旅系統支部頁、支部系統 403 頁（照抄連結 <span class="mono">index.html?step=rescue&b=&lt;id&gt;</span>）。</li>
      <li><b>旅部 ADMIN（旅長／教練員）</b>：喺「待辦與批核 → 🆘 求救」或支部頁處理 —— <b>開返支部系統登入</b>（sig）／<b>重設密碼</b>（發臨時密碼）／<b>答覆並結案</b>。全部人手做、逐單入紀錄。</li>
      <li><b>求救唔會自動開任何嘢</b>：唔會自動開閘、唔會自動改密碼（唔然打幾個字就入得）。身份由 ADMIN 自己核實。</li>
      <li><b>你（平台超管）＝下一站</b>：驗身<b>唔經下游 SHEET 登記</b> —— 某團未登記／紅燈／閂咗／接駁斷，都<b>鎖你唔住</b>；ADMIN 連旅系統都入唔到嗰陣，你入得返重設 ADMIN 密碼／補登記／輪換金鑰。限制：要平台＋網絡。</li>
      <li><b>唔係出路</b>：本地領袖戶／SUPER 本地戶（閂咗一樣 <span class="mono">403</span>）、支部系統前台（永遠冇解鎖掣）。</li>
    </ul>
    <div class="xs faint mt-8">詳情：建構計劃 §4.5.1；入口 <span class="mono">index.html?step=super</span>。</div>
    ` })}
    `;
  }

  el.innerHTML = page({
    title: '平台（超管 · 隱藏）', sub: `${d.unit.name} · 超管視角 · 呢個模組只有 role=super 見到`,
    body: `${notice('★ 你而家係<b>平台超管</b>。超管唔係旅長：超管做開旅／接入／輪換，唔會插手旅務日常（審計照記你嘅動作）。', 'warn')}${tabsHtml}${body}`
  });

  el.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => go('platform?tab=' + t.dataset.tab)));
  el.querySelectorAll('[data-ok]').forEach(b => b.addEventListener('click', () => {
    const a = d.applications.find(x => x.id === b.dataset.ok);
    S.commit(dd => { const t = dd.applications.find(x => x.id === a.id); if (t) { t.state = 'approved'; t.decidedBy = '平台超管'; } });
    S.audit('超管批准接入', `${a.name}`, a.note || '', 'PLATFORM');
    toast('已接入（示範）：units.json ＋ Vercel env 已更新（記得 Redeploy）', 'ok', '', null, 6000);
    go('platform?tab=inbox');
  }));
  el.querySelectorAll('[data-no]').forEach(b => b.addEventListener('click', () => {
    const a = d.applications.find(x => x.id === b.dataset.no);
    S.commit(dd => { const t = dd.applications.find(x => x.id === a.id); if (t) { t.state = 'rejected'; t.reason = '超管退回：資料未齊'; } });
    S.audit('超管退回接入', `${a.name}`, '資料未齊', 'PLATFORM');
    toast('已退回（會通知申請人補資料）', 'warn');
    go('platform?tab=inbox');
  }));
  el.querySelector('#pf-diag')?.addEventListener('click', () => modal({
    title: '旅閘診斷（模擬）',
    body: `<div class="diag-list">ok: true
server: 'ecportal'
onVercel: true
vercelEnv: 'production'
region: 'hkg1'
ids: ["0082"]
count: 1
recognizedNames: ["0082"]
suspicious: []
withKey: ["0082"]
trusted: ["0082"]
withName: ["0082"]</div>
    <div class="xs faint mt-8">有 key ＋ 有 name ＋ 名對得上 ＝ 旅閘會放行。如果有名但冇 key（或反過來）→ 會出現喺 <span class="mono">suspicious</span>，旅閘會提示「變數只勾咗 Production 但你開 Preview」。</div>`,
    footer: `<button class="btn primary" onclick="this.closest('.mask').remove()">明白</button>`
  }));
  el.querySelector('#pf-copy')?.addEventListener('click', () => copyText(JSON.stringify({ units: [{ id: '0082', name: d.unit.name }] }, null, 2)));
  /* ★ 超管救援：重設旅長（ADMIN）密碼 —— ADMIN 死咗／入唔到嗰陣嘅救命路 */
  el.querySelector('#pf-reset-admin')?.addEventListener('click', async () => {
    const { promptDlg, confirmDlg } = await import('../lib/util.js');
    const acc = await promptDlg({
      title: '重設旅長（ADMIN）密碼',
      label: '旅長帳號（email）', value: 'chief@demo.troop',
      hint: '發臨時密碼、首登強制改；入 ACCESS_LOG（邊個超管、幾時、重設邊個）。'
    });
    if (!acc) return;
    const ok = await confirmDlg({
      title: `重設 ${acc}？`,
      message: `會發臨時密碼（首登強制改），之後佢就入得返旅系統處理求救。<div class="xs faint mt-8">日常唔好用超管戶；呢一步係「ADMIN 都入唔到」先用。</div>`,
      ok: '重設'
    });
    if (!ok) return;
    const r = S.resetPasswordFor(acc);
    if (!r.ok) { toast(r.msg, 'err', '', null, 6000); return; }
    S.audit('超管重設帳號密碼', acc, '第二層備援（ADMIN 入唔到）· 臨時密碼已發', '平台');
    toast(`已重設 ${r.account}：臨時密碼 ${S.DEMO_TEMP_PW}（示範）—— 首登強制改`, 'ok', '', null, 7000);
    go('platform?tab=keys');
  });
}

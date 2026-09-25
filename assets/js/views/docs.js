/* 教學 — 角色快速入門、模組說明、開旅 checklist、功能藍圖（邊樣旅做／邊樣跳轉） */
import { esc, icon, toast, copyText } from '../lib/util.js';
import * as S from '../lib/store.js';
import { go } from '../lib/router.js';
import { page, card, table, badge, notice, tabs, stat } from './ui.js';
import { MODULES, GROUPS, moduleList } from '../lib/registry.js';

export function render(el, params = {}, query = {}) {
  const d = S.load();
  if (params.id === 'blueprint') return renderBlueprint(el);
  const tab = query.tab || 'start';
  const role = S.getSession()?.role;
  const docs = d.tutorials;
  const mine = docs.filter(x => x.who === roleLabel(role) || x.who === '全部');

  const tabsHtml = `<div class="tabs">
    ${[['start', '快速入門'], ['modules', '模組說明'], ['checklist', '開旅 checklist'], ['blueprint', '功能藍圖']].map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}
  </div>`;

  let body = '';
  if (tab === 'start') {
    body = `
    ${notice('教材三層：<b>每角色一頁快速入門</b>（首次登入必見）／<b>每模組一頁說明</b>（跟模組註冊）／<b>示範旅引導任務</b>。教材跟版本走（放喺 repo docs/，唔部署到公開頁）。', 'info')}
    <div class="grid g2 mt-12">
      ${mine.map(t => card({
        title: t.title, sub: `${t.who} · 約 ${t.mins} 分鐘`,
        body: `<div class="steps">${t.steps.map(s => `<div class="step"><div>${esc(s)}</div></div>`).join('')}</div>
        <div class="btn-row mt-8"><button class="btn sm" data-copy-doc="${t.id}">複製成 checklist</button></div>`
      })).join('')}
    </div>
    ${card({ title: '全部角色教材', body: table({
      cls: 'tbl compact', head: ['對象', '教材', '長度'],
      rows: docs.map(t => ({ cells: [badge(t.who, t.who === '全部' ? 'n' : 'b', true), esc(t.title), `${t.mins} 分鐘`] }))
    }) })}
    `;
  } else if (tab === 'modules') {
    body = `${Object.entries(GROUPS).map(([gid, glabel]) => {
      const mods = moduleList().filter(m => m.group === gid);
      if (!mods.length) return '';
      return card({
        title: glabel, body: `<div class="grid g2">${mods.map(m => `
          <div class="pub-item">
            <div class="flex-b"><b>${esc(m.label)}</b><span class="tag n sm">${esc(m.tier)}</span></div>
            <div class="sm mt-4">${esc(m.desc)}</div>
            ${m.subs ? `<div class="xs faint mt-4">子頁：${m.subs.map(s => esc(s.label)).join('、')}</div>` : ''}
            <div class="xs faint mt-4">可用角色：${m.roles.map(r => esc(roleLabel(r))).join('、')}</div>
          </div>`).join('')}</div>`
      });
    }).join('')}`;
  } else if (tab === 'checklist') {
    body = `${card({ title: '開旅 checklist（新旅上線 7 步）', body: `<div class="steps">
      ${[
        '建旅 SHEET → 貼 <span class="mono">Code.gs</span> → 執行 <span class="mono">initializeSheets()</span> → 用精靈種入<b>第一個旅長</b>（EMAIL ＋ 臨時密碼）',
        '部署 Web App（執行身分「我」、存取權「任何人」）→ Sheet 選單「🔗 旅系統 → 🔑 顯示 BACKEND／APIKEY」抄 B、D',
        '填 C（旅名）→ 旅閘「📋 新旅部署」交去 ADMIN 收件匣',
        'ADMIN：<span class="mono">data/units.json</span> 加 entry ＋ Vercel env <span class="mono">TROOP_&lt;旅ID&gt;_*</span> → Redeploy',
        '旅長登入 → 逐個支部「➕ 登記下游」（URL ＋ KEY ＋ 顯示名 ＋ <b>sig 用途字串</b>）→「📡 測試連線」',
        '逐個下游：搬舊數（下游吐 JSON 含 hash → 匯入）→ 核對筆數 → 「🚪 閂口」',
        '之後開戶：成員由該團落筆（旅揀團經 sig）；領袖／家長由旅開；跨團幫手要目標團批'
      ].map(s => `<div class="step"><div>${s}</div></div>`).join('')}
    </div>` })}
    ${card({ title: '首次登入會見到咩', body: `<ul class="doc">
      <li>頂部：旅名、你嘅角色、三色燈、「N 項未寫入」＋「儲存到後端」</li>
      <li>側邊：模組註冊表自動生成嘅導航（最多兩層）</li>
      <li>儀表板：五格總覽 ＋「需要你處理」＋ 接駁狀態</li>
      <li>示範模式橫額：明確講「資料住呢部機、唔會送去後端」</li>
    </ul>` })}
    ${card({ title: '角色 × 職責對照', body: table({
      cls: 'tbl compact', head: ['角色', '帳號住邊', '主場'],
      rows: [
        { cells: ['旅長', '旅 SHEET', '全旅：接駁、模組開關、財務確認、公開資料、審計'] },
        { cells: ['旅層領袖', '旅 SHEET ＋ branch_access', '旅通告／行事曆、跨支部物資、被授權支部'] },
        { cells: ['支部領袖', '該團支部 SHEET', '自己團（支部系統）；要旅幫手就搵旅長'] },
        { cells: ['家長', '旅 SHEET', '我的子女（跨支部進度／通告／繳費）'] },
        { cells: ['成員', '該團支部 SHEET', '自己團成員入口（旅只做導流）'] }
      ]
    }) })}
    `;
  } else {
    return renderBlueprint(el);
  }

  el.innerHTML = page({ title: '教學', sub: `跟住做就識：${docs.length} 份教材 · 13 個模組`, body: tabsHtml + body });
  el.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => t.dataset.tab === 'blueprint' ? go('docs/blueprint') : go('docs?tab=' + t.dataset.tab)));
  el.querySelectorAll('[data-copy-doc]').forEach(b => b.addEventListener('click', () => {
    const t = docs.find(x => x.id === b.dataset.copyDoc);
    copyText(`【${t.title}】\n` + t.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'));
  }));
}

const roleLabel = r => ({ chief: '旅長', leader: '旅層領袖', parent: '家長', member: '成員', guest: '訪客', super: '平台超管' }[r] || r);

/* ---------------- 功能藍圖（睇「功能係咪齊備」） ---------------- */
function renderBlueprint(el) {
  const P0 = [
    ['旅閘（揀旅、伺服器登記狀態、診斷、新旅申請接入）', '旅', '已做（UI）', 'b'],
    ['登入（旅長／旅層領袖／家長）＋首次登入強制改密碼', '旅', '已做（UI）', 'b'],
    ['成員入口導流（揀支部 → 轉去該團成員入口，密碼由團驗）', '旅', '已做（UI）', 'b'],
    ['旅員管理（角色、branch_access、停用／復原、審計）', '旅', '已做（UI）', 'g'],
    ['支部一頁（清單、顯示名、狀態、進入三路）', '旅', '已做（UI）', 'g'],
    ['下游登記／測試連線（sig）／入口掣／為下游開戶／匯出匯入 JSON', '旅', '已做（UI）', 'g'],
    ['公開資料（等級 0）＋分享連結／QR／公開頁', '旅', '已做（UI）', 'g'],
    ['審計與操作紀錄 ＋ 後端實況（diag／repair）', '旅', '已做（UI）', 'g'],
    ['體積治理（.vercelignore／零依賴／dist<5MB）＋ npm run check', '旅', '部分（lint／手動）', 'y']
  ];
  const P1 = [
    ['可見等級 0–5 全面落實（含「其他支部登記用戶」一級）', '旅', '已做（UI）', 'g'],
    ['家長頁：子女跨支部摘要（進度／通告／活動／繳費）', '旅', '已做（UI）', 'g'],
    ['旅通告（發佈、shareTo 分享、跨支部接收、公開頁報名、代填）', '旅', '已做（UI）', 'g'],
    ['★ 個人化訂閱（支部 × 分類；push 復用圖書館鏈；存本機）', '旅', '已做（UI 設定面）', 'g'],
    ['模組開關 TROOP_MODULES（全旅／指定支部；導航由註冊表生成）', '旅', '已做（UI）', 'g'],
    ['旅行事曆（每支部一色、標籤過濾、ICS 匯出）', '旅', '已做（UI）', 'g'],
    ['真 sig 讀寫（等團側補 handleSignedRequest 之後切換路 S）', '旅＋團', '未做（UI 已模擬）', 'y']
  ];
  const P2 = [
    ['財務整合（支部簽提交摘要 → 旅彙總；按支部／月／類別；退問）', '旅', '已做（UI）', 'g'],
    ['物資整合（共享範圍、借用路由去 owner、庫存加減、雙邊可見）', '旅', '已做（UI）', 'g'],
    ['相簿／公開項目上報（支部簽寫入旅、旅批）', '旅', '已做（UI）', 'g'],
    ['移交與升降團（bundle JSON ＋ sha256、transferId 冪等、撞號阻擋）', '旅', '已做（UI）', 'g'],
    ['跨團幫手（教練員＝旅長直開；本職領袖兼幫＝目標團批）', '旅', '已做（UI）', 'g']
  ];
  const P3 = [
    ['示範旅 MOCK（水印、唔自動記住、匯出帶 _exportedFrom）', '旅', '已做（UI）', 'g'],
    ['教材三層 ＋ 開旅 checklist ＋ 功能藍圖', '旅', '已做（UI）', 'g'],
    ['ADMIN 收件匣對接（新旅／新支部接入、rotate 提醒）', '旅＋平台', '未做', 'y'],
    ['外接工具目錄（stateless 先可入）', '平台', '未做', 'y'],
    ['匯出／備份（exportAll ＋ sha256、每週 Drive 13 份、三時機提醒）', '旅', '已做（UI）', 'g']
  ];
  const NOT = [
    ['會議紀錄、點名、試卷、支部財務明細、支部物資庫存', '支部系統（團）', '旅只跳轉'],
    ['進度 UI（獎章／履歷詳細介面）', '進度 leaf', 'UI 豁免，旅只讀摘要'],
    ['相片上載、影片、圖書館爬蟲', '支部／圖書館', '旅唔做'],
    ['通告推送基建（Supabase ＋ notify.py）', '圖書館（外部）', '旅只做訂閱設定前端']
  ];
  const TODO = [
    ['成員登入路線：M3 導流（建議）定 M1 旅直接驗（要團加 verifyLogin）', '待你定案'],
    ['旅 ID 格式：4 位補零；同旅多支部＝多條 DOWNSTREAM_<id>', '建議照做'],
    ['家長綁定子女：由該團領袖確認（建議）定開放自助填', '待你定案'],
    ['整合數據新鮮度：cache 5 分鐘 ＋ 手動刷新（建議）', '建議照做'],
    ['TROOP_MODULES 存邊：旅 SHEET 分頁（建議，可審計）', '建議照做'],
    ['要唔要開 readme PR（加註 DOWNSTREAM_<id>_PURPOSE 等 3 條）', '待你批']
  ];

  const body = `
  ${notice('呢一頁就係「功能係咪齊備」嘅清單。分三類：<b>旅做</b>（本系統）／<b>只跳轉</b>（用戶照樣去到，但主場係支部）／<b>唔做</b>（明確唔屬旅）。', 'info')}
  <div class="grid g4 mt-12">
    ${stat({ k: '模組', v: MODULES.length, u: '個' })}
    ${stat({ k: 'UI 已做', v: '第 1–2 期全部', tone: 'ok' })}
    ${stat({ k: '等團側', v: '1 項', hint: '真 sig 讀寫（路 S）' })}
    ${stat({ k: '等你定案', v: '6 項', tone: 'warn' })}
  </div>
  ${blueTable('P0 — 骨架・登入・接駁', P0)}
  ${blueTable('P1 — 跨支部可見・家長・通告訂閱', P1)}
  ${blueTable('P2 — 整合（財務／物資／移交）', P2)}
  ${blueTable('P3 — 平台與教材', P3)}
  ${blueTable('呢啲唔係旅做（避免重複起）', NOT, 'n')}
  ${card({ title: '待你定案（定咗就落碼）', body: table({
    cls: 'tbl compact', head: ['事項', '狀態'],
    rows: TODO.map(([a, b]) => ({ cells: [esc(a), badge(b, b.startsWith('待') ? 'y' : 'n', true)] }))
  }) })}
  ${card({ title: '真後端落地次序（UI 之後）', body: `<div class="steps">
    ${['api 端點（proxy／units／auth／super／downstreams／troop／share／registry）＋ session 驗證＋inject apikey',
    '旅 Code.gs（build-gas 單一來源）：白名單 action、ScriptLock、逐表寫自證、ScriptProperties 下游登記、sig、掣、匯出匯入',
    'initializeSheets ＋ 首個旅長種入 ＋ Sheet 選單（登記／測試／閂口／為下游開戶）',
    '守護測試 12 項（見 docs/旅系統建構計劃.md §10）＋ 真機跑一次（sig 過 302、Drive 權限、選單授權）',
    'Vercel 部署：units.json ＋ TROOP_<旅>_* env；關 Preview；dist<5MB'].map(s => `<div class="step"><div>${esc(s)}</div></div>`).join('')}
  </div>` })}
  `;

  el.innerHTML = page({ title: '功能藍圖', sub: '旅做咩、邊樣只跳轉、邊樣唔做 —— 同施工分期', back: 'docs', body });
}

function blueTable(title, rows, forceTone) {
  return card({
    title, body: table({
      cls: 'tbl compact', head: ['功能', '邊個做', '現況'],
      rows: rows.map(([f, who, status, tone]) => ({
        cells: [esc(f), badge(who, who.startsWith('旅') ? 'gold' : 'n', true), badge(status, forceTone || tone || 'n', true)]
      }))
    })
  });
}

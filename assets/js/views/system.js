/* 系統 — 旅團設定、模組開關、後端實況、審計、自動化、資料備份、PDPO、金鑰 */
import { esc, icon, toast, downloadFile, copyText, fmtDate, fmtStamp, relTime, money } from '../lib/util.js';
import * as API from '../lib/api.js';
import * as S from '../lib/store.js';
import { go } from '../lib/router.js';
import { page, card, table, badge, notice, tabs, stat, kv, modal, empty, progressBar } from './ui.js';
import { moduleList, GROUPS, visName, ROLE_LABEL } from '../lib/registry.js';
import * as SYNC from '../lib/sync.js';

const TABS = [
  ['troop', '旅團設定'], ['modules', '模組開關'], ['backend', '後端實況'], ['audit', '審計與操作紀錄'],
  ['automation', '自動化'], ['sync', '同步'], ['data', '資料與備份'], ['privacy', 'PDPO 與私隱'], ['keys', '接駁與金鑰']
];

/** 備份狀態：示範模式由本機紀錄推算；真模式由 GAS `backupState` 覆寫（見 bindBackup） */
export const BACKUP_KEEP = 13;
export function localBackupState(d = S.load()) {
  const rows = (d.backups || []).slice().sort((a, b) => String(a.at) < String(b.at) ? -1 : 1);
  const last = rows[rows.length - 1] || null;
  const at = last ? String(last.at || '') : '';
  const ms = at ? Date.parse(at.replace(' ', 'T')) : NaN;
  const ageDays = isFinite(ms) ? Math.floor((Date.now() - ms) / 86400000) : null;
  return {
    keep: BACKUP_KEEP, count: rows.length, lastAt: at, ageDays,
    stale: ageDays !== null && ageDays >= 7, missing: !last,
    remind: !last ? '未有備份紀錄：建議即刻做一次備份（升級／批量操作之前一定要）'
      : (ageDays >= 7 ? `已經 ${ageDays} 日冇備份 —— BUILD 要求每週一次、留 ${BACKUP_KEEP} 份` : `備份仲新（${ageDays} 日前）`)
  };
}

export function render(el, params, query = {}) {
  const tab = query.tab || 'troop';
  const d = S.load();
  const backupState = localBackupState(d);
  const tabsHtml = `<div class="tabs">${TABS.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>`;
  let body = '';

  if (tab === 'troop') {
    const s = d.settings;
    body = `${card({ title: '旅團基本資料', sub: '呢啲係顯示用資料；真正嘅旅 ID／後端登記喺平台 registry（units.json ＋ Vercel env）', body: `
      <div class="grid g2">
        <label class="f"><span class="lb">旅團編號（normId：補零至 4 位）</span><input type="text" value="${esc(d.unit.code)}" id="st-code"></label>
        <label class="f"><span class="lb">旅團名稱</span><input type="text" value="${esc(d.unit.name)}" id="st-name"></label>
      </div>
      <div class="grid g3">
        <label class="f"><span class="lb">英文名</span><input type="text" value="${esc(d.unit.nameEn)}" id="st-nameen"></label>
        <label class="f"><span class="lb">地區</span><input type="text" value="${esc(d.unit.district)}" id="st-district"></label>
        <label class="f"><span class="lb">贊助機構</span><input type="text" value="${esc(d.unit.sponsor)}" id="st-sponsor"></label>
      </div>
      <div class="grid g3">
        <label class="f"><span class="lb">旅長</span><input type="text" value="${esc(d.unit.chief)}" id="st-chief"></label>
        <label class="f"><span class="lb">聯絡電郵</span><input type="text" value="${esc(d.unit.publicContact)}" id="st-contact"></label>
        <label class="f"><span class="lb">財務提交截止（每月）</span><input type="number" value="${s.financeDueDay}" id="st-due" min="1" max="28"></label>
      </div>
      <label class="f"><span class="lb">旅簡介（可公開）</span><textarea id="st-intro">${esc(d.unit.publicIntro)}</textarea></label>
      <label class="check"><input type="checkbox" id="st-open" ${s.publicOpen ? 'checked' : ''}> 開放公開頁（未登入都睇得到等級 0 嘅資料）</label>
      <div class="actions-bar"><button class="btn primary" id="st-save">${icon('check', 14)} 儲存設定</button></div>` })}
    ${card({ title: '危險區', body: `
      <div class="flex-b"><div><b>還原示範資料</b><div class="xs faint">清走你改過嘅嘢，回復出廠示範（真模式＝由後端重新拉一次）。</div></div>
      <button class="btn danger" id="st-reset">還原示範資料</button></div>` })}
    `;
  } else if (tab === 'modules') {
    body = `
    ${notice('模組註冊制：每個功能 = 一個模組（名、入口位置、所需權限、開關、說明頁）。<b>未登記不得直接加導航</b>。開關可以全旅開／全旅閂／指定支部。<br>★ <b>分享前設</b>：接收方要有該模組，先分享得到 —— 分享清單由呢張表過濾。', 'info')}
    ${notice('★ <b>Q5 定案（2026-09-26）</b>：開關嘅<b>真相住旅 SHEET「模組開關」分頁</b>（改一次寫一次＋入 AUDIT_LOG，跟 Sheet 備份走）；ScriptProperties／CacheService 只做 5 分鐘快取，改動即清。<br>改得嘅只有<b>旅長</b>（支部可以反映，但唔可以自己開）；<b>閂咗模組＝隱藏，唔會刪資料</b> —— 開返即刻見返。', 'warn')}
    ${Object.entries(GROUPS).map(([gid, glabel]) => {
      const mods = moduleList().filter(m => m.group === gid);
      if (!mods.length) return '';
      return card({
        title: glabel, body: table({
          cls: 'tbl compact',
          head: ['模組', '分期', '誰可用', '全旅開關', '指定支部'],
          rows: mods.map(m => {
            const set = d.modules[m.id];
            const mode = set === undefined || set === 'all' ? 'all' : set === 'off' ? 'off' : 'custom';
            return {
              cells: [
                `<b>${esc(m.label)}</b><div class="xs faint">${esc(m.desc)}</div>${m.subs ? `<div class="xs faint">子頁：${m.subs.map(s => esc(s.label)).join('、')}</div>` : ''}`,
                `<span class="tag n sm">${esc(m.tier)}</span>`,
                m.roles.map(r => `<span class="tag n sm">${ROLE_LABEL[r] || r}</span>`).join(' '),
                `<select data-mod="${m.id}">
                  <option value="all" ${mode === 'all' ? 'selected' : ''}>全旅開啟</option>
                  <option value="off" ${mode === 'off' ? 'selected' : ''}>全旅閂</option>
                  <option value="custom" ${mode === 'custom' ? 'selected' : ''}>指定支部…</option>
                </select>`,
                mode === 'custom' ? d.branches.map(b => `<label class="check xs"><input type="checkbox" data-mod-b="${m.id}:${b.id}" ${(set || []).includes(b.id) ? 'checked' : ''}> ${esc(b.name)}</label>`).join(' ') : '<span class="faint xs">—</span>'
              ]
            };
          })
        })
      });
    }).join('')}
    ${notice('模組開關係<b>管理層</b>嘅嘢（屬旅／團系統）。進度追蹤係記錄冊 leaf，<b>冇模組註冊制</b> —— 唔可以「登記咗就加個圖書館」。', 'warn')}
    `;
  } else if (tab === 'backend') {
    const b = d.backend;
    body = `
    ${notice('後端實況＝答「寫唔寫得入、讀唔讀得出」。示範模式唔連接任何後端；真模式會由旅 GAS <span class="mono">status</span>／<span class="mono">dbInfo</span> 如實報（<b>唔報喜唔報憂</b>：行數幾多、邊個表壞、後端版本幾多，一律照講）。', 'warn')}
    <div class="grid g4 mt-12">
      ${stat({ k: 'APP 版本', v: b.appVersion })}
      ${stat({ k: '後端版本', v: b.backendVersion, tone: 'warn' })}
      ${stat({ k: '模式', v: b.mode, u: '', hint: b.mode === 'mock' ? '示範：冇後端' : b.mode })}
      ${stat({ k: '寫入路線', v: '逐表寫', hint: 'saveTables ＋ 寫完自證' })}
    </div>
    <div class="grid g2 mt-12">
      ${card({ title: '後端內容', body: kv([
      ['試算表', esc(b.spreadsheet)],
      ['資料表分頁', `${b.tables} 個表 · ${b.rows} 行`],
      ['壞表', b.broken.length ? b.broken.map(x => badge(x, 'r', true)).join(' ') : badge('冇', 'g', true)],
      ['同步紀錄', `${b.syncRows} 行`],
      ['垃圾／暫存行', String(b.stagingRows)]
    ]) })}
      ${card({ title: '上次寫入收據', body: kv([
      ['時間', esc(b.lastWrite.at)],
      ['結果', b.lastWrite.confirmed ? badge('confirmed:true（寫完讀返自證通過）', 'g', true) : badge('confirmed:false（當失敗，改動留本機）', 'r', true)],
      ['寫入表數', `${b.lastWrite.tables} 個表`],
      ['耗時', b.lastWrite.ms + ' ms']
    ]) })}
    </div>
    ${card({ title: '診斷與修復（搶救三寶精神）', body: `
      <div class="btn-row">
        <button class="btn sm" data-diag>${icon('refresh', 13)} 後端資料檢查（diag）</button>
        <button class="btn sm" data-repair>${icon('wrench', 13)} 修復後端（清垃圾／舊版本段）</button>
        <button class="btn sm danger" data-force>強制用呢部機嘅資料上載</button>
      </div>
      <div class="xs faint mt-8">三個都係真模式先有意義；示範模式只會回應示範結果。</div>` })}
    ${card({ title: '逐表寫入（saveTables）— 點解要咁做', body: `
      <div class="steps">
        <div class="step">只寫<b>有改過</b>嗰幾個表（唔係成份資料庫一鋪過寫）</div>
        <div class="step"><b>先寫新、後刪舊</b>；逐表寫冇版本鎖；壞一個表淨係 skip 嗰個表</div>
        <div class="step">寫完<b>即刻讀返自證</b>：數返行數、邊啲表齊料，先回 <span class="mono">confirmed:true</span></div>
        <div class="step">前端唔認假成功：冇 <span class="mono">confirmed</span> ＝ 當失敗，改動原封不動留喺部機</div>
      </div>` })}
    `;
  } else if (tab === 'audit') {
    body = `
    ${toolbarLocal()}
    <div class="grid g2">
      ${card({ title: `審計紀錄（AUDIT_LOG · ${d.audit.length} 行）`, sub: 'append-only、prev_hash 鏈、server-side 寫入、24 個月後 purge · ★ 只記 metadata（唔記內容：長文字＝[內容不記錄 len=N]、email／電話遮住）',
      body: table({
        cls: 'tbl compact', head: ['時間', '操作者', '動作', '對象', '途徑', '詳情'],
        rows: d.audit.map(a => ({
          cells: [`<span class="xs faint">${esc(a.at)}</span>`, `${esc(a.actor)}<div class="xs faint">${esc(a.role)}</div>`, esc(a.action), esc(a.target), badge(a.via, a.via === 'sig' ? 'g' : 'n', true), `<span class="xs">${esc(a.detail)}</span>`]
        }))
      }) })}
      ${card({ title: `操作紀錄（ACCESS_LOG · ${d.access.length} 行）`, sub: 'LOGIN_OK／FAIL／LOCKOUT／RESET（只記 metadata，唔記密碼）',
        body: table({
          cls: 'tbl compact', head: ['時間', '帳號', '事件', 'IP'],
          rows: d.access.map(a => ({
            cells: [`<span class="xs faint">${esc(a.at)}</span>`, `<span class="mono xs">${esc(a.sub)}</span>`, badge(a.event, a.event === 'LOGIN_OK' ? 'g' : a.event === 'LOCKOUT' ? 'r' : 'y', true), `<span class="xs faint">${esc(a.ip)}</span>`]
          }))
        }) })}
    </div>`;
  } else if (tab === 'automation') {
    body = `
    ${notice('★ 死規矩：<b>旅系統冇 callback endpoint、冇定時器、冇 onEdit／newTrigger</b>。下面嗰啲「定時」工作全部喺<b>平台側／外部</b>（GitHub Actions、Drive、資料庫 cron）執行，唔係裝喺你張 Sheet 度。', 'warn')}
    ${card({ body: table({
      head: ['工作', '幾時', '上次', '下次', '喺邊執行', '狀態'],
      rows: d.automations.map(a => ({
        cells: [esc(a.name), esc(a.schedule), `<span class="xs faint">${esc(a.last)}</span>`, `<span class="xs faint">${esc(a.next)}</span>`,
        { '每週備份（Drive）': '平台 → Drive', '推送補漏（7 日 rolling）': 'GitHub Actions + Supabase', '財務提交提醒（每月 5 號）': '平台排程', '離隊資料 purge（12 個月）': '平台排程', '審計紀錄 purge（24 個月）': '平台排程', 'PDPO 家長同意提醒': '平台排程' }[a.name] || '平台側',
        badge(a.stateText, a.state === 'ok' ? 'g' : 'y', true)]
      }))
    }) })}
    ${card({ title: '書籤式提醒（唔用觸發器嘅替代做法）', body: `<ul class="doc">
      <li>頂部「N 項未寫入」轉紅就係提醒你撳儲存 —— 唔靠自動寫入</li>
      <li>三個提醒時機：<b>升級前</b>、<b>批量操作前</b>、<b>7 日冇備份</b></li>
      <li>財務提交日：儀表板「等你處理」會計入「未提交」嘅支部</li>
    </ul>` })}
    `;
  } else if (tab === 'sync') {
    const st = SYNC.state();
    const li = SYNC.light();
    const qn = SYNC.queueSize();
    const tone = li.light === 'green' ? 'ok' : (li.light === 'red' ? 'danger' : 'warn');
    body = `
    ${notice('三色燈：<b>綠</b>＝後端同呢部機一致／<b>黃</b>＝有改動未寫入 或 上次失敗／<b>紅</b>＝連續失敗（改動暫存喺本機隊列，唔會跌）。燈號唔係裝飾 —— 見到黃色就代表仲有人未收到你嘅改動。', 'info')}
    <div class="grid g3">
      ${stat({ k: '後端狀態', v: li.label, tone })}
      ${stat({ k: '未寫入改動', v: st.dirty || 0, u: '項', tone: st.dirty ? 'warn' : 'ok' })}
      ${stat({ k: '本機隊列', v: qn, u: '筆', tone: qn ? 'warn' : 'ok', hint: qn ? `下次自動重試：${SYNC.queueInfo().nextRetryMs ? Math.ceil(SYNC.queueInfo().nextRetryMs / 1000) + ' 秒後' : '夠鐘（一開機就試）'}` : '乾淨' })}
    </div>
    ${card({ title: '同步一次（樂觀鎖 ＋ merge3）', sub: 'BUILD §3：三路合併；同一格兩邊都改 → 唔會自動揀，逐格問你', body: `
      <div class="kv">
        <dt>基準版本</dt><dd class="mono">${esc(st.baseVersion || '（未對齊）')}</dd>
        <dt>上次成功</dt><dd>${st.lastAt ? esc(fmtStamp(new Date(st.lastAt).toISOString())) : '未試過'}</dd>
        <dt>上次錯誤</dt><dd>${st.lastError ? esc(String(st.lastError)) : '冇'}</dd>
        <dt>下次自動重試</dt><dd>${(() => {
        const qi = SYNC.queueInfo();
        if (!qi.size) return '—';
        return qi.due ? '夠鐘（一開機／回前景就送）' : `約 ${Math.ceil(qi.nextRetryMs / 1000)} 秒後（backoff＋jitter；試過 ${qi.tries} 次）`;
      })()}</dd>
        <dt>上次寫入</dt><dd>${(st.lastWrote || []).length ? esc((st.lastWrote || []).join('、')) : '—'}</dd>
        <dt>上次逐格選擇</dt><dd>${st.lastConflictPicked ? `用我 ${st.lastConflictPicked.mine} 格／用佢 ${st.lastConflictPicked.theirs} 格` : '—'}</dd>
      </div>
      <div class="btn-row mt-8">
        <button class="btn sm primary" data-sync>${icon('refresh', 13)} 立即同步（有衝突會逐格問）</button>
        <button class="btn sm" data-sync-batch>${icon('clock', 13)} 無人看場（serverTime 新者勝）</button>
        <button class="btn sm" data-queue>${icon('upload', 13)} 重試本機隊列（${qn}）</button>
      </div>
      ${(st.pending || []).length ? `<div class="mt-12">${notice(`有 ${st.pending.length} 格未答（上次同步中途停低）—— 撳「立即同步」會再問你一次。`, 'warn')}</div>` : ''}
      <div class="xs faint mt-8">示範模式：零 fetch（唔會真連後端）；真模式經同源 <span class="mono">/api/proxy</span>，apikey 只喺 server 側注入。</div>` })}
    ${card({ title: '離線隊列（≤200 筆）', sub: '送唔到唔會跌：入本機隊列，backoff ＋ jitter 重試', body: (() => {
        const q = SYNC.queueSize();
        const qi = SYNC.queueInfo();
        return q ? `${notice(`本機仲有 ${q} 筆未送（最多 200 筆，滿咗就唔會再加 —— 唔會靜靜跌舊嘢）。${qi.due ? '已經夠鐘：下次同步／開 APP 會自動送。' : `仲喺 backoff 中（約 ${Math.ceil(qi.nextRetryMs / 1000)} 秒後）—— 撳「即刻重試」可以人手優先。`}`, 'warn')}
          <div class="btn-row mt-8"><button class="btn sm" data-queue2>${icon('upload', 13)} 即刻重試</button></div>`
          : `<div class="empty">${icon('check', 22)}<div class="mt-8"><b>隊列乾淨</b></div><div class="sm faint mt-8">冇未送嘅改動。</div></div>`;
      })() })}`;
  } else if (tab === 'data') {
    body = `
    <div class="grid g3">
      ${stat({ k: '資料表', v: d.backend.tables, u: '個' })}
      ${stat({ k: '行數', v: d.backend.rows, u: '行' })}
      ${stat({ k: '未寫入改動', v: S.dirtyCount(), u: '項', tone: S.dirtyCount() ? 'warn' : 'ok' })}
    </div>
    ${card({ title: '匯出／匯入', sub: 'exportAll ＝ 一鍵全庫單一 JSON（{meta:{unit,exportedAt,version,sha256}, data}）；預設剝密碼欄',
      body: `<div class="btn-row">
        <button class="btn primary" data-export>${icon('download', 14)} 匯出 JSON（唔含密碼）</button>
        <button class="btn" data-export-hash>${icon('download', 14)} 匯出 JSON（<b>含 hash</b> · 後掛上游批量開戶用）</button>
        <button class="btn" data-import>${icon('upload', 14)} 匯入 JSON</button>
        <button class="btn" data-print>${icon('print', 14)} 列印現況</button>
      </div>
      <div class="mt-12">${notice('「含 hash」嘅檔用完即刻刪（Drive 建立後即設 PRIVATE、Permission NONE；Drive 失敗就寫 Logger，唔入 Sheet）。', 'warn')}</div>` })}
    ${card({ title: '備份（Drive 留 13 份）', sub: 'BUILD §3：每週自動 ＋ 13 份輪替；三時機提醒（升級前／批量操作前／7 日冇備份）', body: `
      <div class="grid g3">
        ${stat({ k: 'Drive 保留', v: backupState.count, u: `/ ${backupState.keep} 份`, tone: backupState.count >= backupState.keep ? 'warn' : 'ok' })}
        ${stat({ k: '上次備份', v: backupState.ageDays === null ? '未做過' : backupState.ageDays, u: backupState.ageDays === null ? '' : '日前', tone: backupState.stale ? 'warn' : 'ok' })}
        ${stat({ k: '輪替', v: '13', u: '份自動刪最舊' })}
      </div>
      ${notice(backupState.stale || backupState.count === 0
      ? `⚠️ ${backupState.remind}`
      : `✅ ${backupState.remind}`, backupState.stale || backupState.count === 0 ? 'warn' : 'ok')}
      <div class="btn-row mt-8">
        <button class="btn sm primary" data-backup>${icon('upload', 13)} 即刻做 Drive 備份</button>
        <button class="btn sm" data-backup-export>${icon('download', 13)} 先落本機（唔靠 Drive）</button>
      </div>
      <div class="xs faint mt-8">備份檔建立後<b>即設 PRIVATE</b>、Permission NONE；超過 13 份自動刪最舊（只刪本系統命名格式嘅檔，唔會掂你 Drive 其他嘢）。</div>` })}
    ${card({ title: '三時機提醒（照 BUILD 落）', body: `<div class="steps">
      <div class="step"><div><b>升級前</b>：改版／搬遷之前撳一次「匯出 JSON」或 Drive 備份（有紀錄先好升級）。</div></div>
      <div class="step"><div><b>批量操作前</b>：匯入／大批開戶／閂閘之前 —— 冇 7 日內嘅備份會先出警告。</div></div>
      <div class="step"><div><b>7 日冇備份</b>：系統會喺呢一版提示（唔會自動幫你備 —— 備份一定要人手知）。</div></div>
    </div>` })}
    `;
  } else if (tab === 'privacy') {
    const members = d.members.length;
    body = `
    ${notice('PDPO 規矩（照真理倉 §8）：開戶要帶<b>家長同意</b>欄位 ＋ 可複製文案；數據清單一張表；離隊 <span class="mono">TRANSFERRED_OUT／LEFT</span> 12 個月後 purge 或匿名化；審計 24 個月。', 'info')}
    ${card({ title: '數據清單（Data Inventory）', body: table({
      head: ['資料', '住邊', '用途', '邊個睇到', '保留'],
      rows: [
        { cells: ['成員名冊（YMIS／姓名／生日）', '該團支部 SHEET', '團務運作', '該團領袖；旅長經 sig 摘要', '在役期間 ＋ 離隊 12 個月'] },
        { cells: ['家長聯絡', '旅 SHEET（有旅）', '通告與緊急聯絡', '旅長／該團領袖', '同上'] },
        { cells: ['進度／獎章', '進度 leaf（該團）', '考核紀錄', '該團領袖＋本人＋家長', '長期（履歷）'] },
        { cells: ['財務摘要', '旅 SHEET（摘要）／支部 SHEET（明細）', '財務監察', '旅長／支部司庫', '7 年'] },
        { cells: ['審計／操作紀錄', '旅 SHEET', '保安與追責', '旅長（+平台超管）', '24 個月'] },
        { cells: ['密碼雜湊', '各 leaf SHEET（server-side）', '登入', '冇人睇到（hash 永不吐出）', '帳號存續期間'] }
      ]
    }) })}
    <div class="grid g2 mt-12">
      ${card({ title: '家長同意狀態', body: `
        ${progressBar(Math.round((members - 2) / Math.max(1, members) * 100), `${members - 2}/${members} 位已收同意書`)}
        <div class="xs faint">未收：2 位（小童軍團）</div>
        <div class="btn-row mt-8"><button class="btn sm" data-consent-text>${icon('copy', 13)} 複製同意書文案</button></div>` })}
      ${card({ title: '離隊處理', body: table({
        cls: 'tbl compact', head: ['成員', '狀態', '處理'], rows: [
          { cells: ['曾俊宇', badge('TRANSFERRED_OUT', 'n', true), '歷史留來源唯讀；12 個月後 purge'] },
          { cells: ['（示範）2 位', badge('LEFT', 'n', true), '已匿名化聯絡資料'] }
        ]
      }) })}
    </div>`;
  } else {
    body = `
    ${notice('變數 ABCD（四個都<b>唔會寫入任何 Sheet</b>）：<span class="mono">A SUPER_KEY</span>（超管，與旅接駁無關）／<span class="mono">B TROOP_&lt;旅ID&gt;_BACKEND</span>／<span class="mono">C TROOP_&lt;旅ID&gt;_NAME</span>／<span class="mono">D TROOP_&lt;旅ID&gt;_APIKEY</span>。<br>下游登記：<span class="mono">DOWNSTREAM_&lt;id&gt;_URL／_KEY／_NAME／_AT／_PURPOSE／_API</span>。', 'info')}
    ${card({ title: '目前登記', body: table({
      head: ['代號／key', '值', '放喺邊', '邊個改'],
      rows: [
        { cells: ['B · 旅後端', '<span class="mono xs">TROOP_0082_BACKEND</span>', 'Vercel env', 'ADMIN（收件匣 → Redeploy）'] },
        { cells: ['C · 旅名', '<span class="mono xs">TROOP_0082_NAME</span>', 'Vercel env', 'ADMIN'] },
        { cells: ['D · 旅 apikey', '<span class="mono xs">TROOP_0082_APIKEY</span> <span class="xs faint">（同時係 sig 根密鑰）</span>', 'Vercel env ＋ 旅 GS ScriptProperties', 'ADMIN ／ 旅長重生'] },
        { cells: ['下游 registry', d.branches.map(b => `<span class="mono xs">DOWNSTREAM_${esc(b.id)}_*</span>`).join('<br>'), '旅 GAS ScriptProperties', '旅長（Sheet 選單／旅前端）'] },
        { cells: ['A · SUPER_KEY', '（隱藏）', 'Vercel env', 'ADMIN'] }
      ]
    }) })}
    ${card({ title: '金鑰輪換（換 D ＝ 三處同步，漏一處就靜靜打唔通）', body: `
      <div class="steps">
        <div class="step">下游 Script Properties 刪 <span class="mono">API_KEY</span> → 跑 <span class="mono">showApiKey()</span> 生成新 key</div>
        <div class="step">上游（旅）重新登記該下游（逐條 <span class="mono">DOWNSTREAM_&lt;id&gt;_KEY</span>）</div>
        <div class="step">ADMIN 改 Vercel env ＋ Redeploy</div>
        <div class="step">查審計 → 通知受影響單位 → 恢復 sig</div>
      </div>
      <div class="mt-8">${notice('每季例行 rotate；有管理權者離任<b>即時</b> rotate。外洩應變：停 SIG → 收本地密碼 → 換 apikey → registry 更新 + flush cache → 換 SESSION_SECRET／SUPER_KEY → 查審計 → 恢復。', 'warn')}</div>` })}
    ${card({ title: '輪換紀錄（示範）', body: table({
      cls: 'tbl compact', head: ['日期', '對象', '原因', '經手'], rows: [
        { cells: ['2026-06-30', '前旅司庫 key', '離任', '陳大文'] },
        { cells: ['2026-07-01', '旅 apikey', '例行（每季）', '陳大文'] },
        { cells: ['2026-09-01', '童軍團下游 key', '該團換 Sheet', '陳大文'] }
      ]
    }) })}
    `;
  }

  el.innerHTML = page({ title: '系統', sub: `${d.unit.name} · 只有旅長入得`, body: tabsHtml + body });
  el.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => go('system?tab=' + t.dataset.tab)));
  el.querySelector('#st-save')?.addEventListener('click', () => {
    S.commit(dd => {
      dd.unit.code = dd.unit.code; dd.unit.name = el.querySelector('#st-name').value;
      dd.unit.nameEn = el.querySelector('#st-nameen').value;
      dd.unit.district = el.querySelector('#st-district').value;
      dd.unit.sponsor = el.querySelector('#st-sponsor').value;
      dd.unit.chief = el.querySelector('#st-chief').value;
      dd.unit.publicContact = el.querySelector('#st-contact').value;
      dd.unit.publicIntro = el.querySelector('#st-intro').value;
      dd.settings.financeDueDay = Number(el.querySelector('#st-due').value || 5);
      dd.settings.publicOpen = el.querySelector('#st-open').checked;
    });
    S.audit('改旅團設定', d.unit.name, '');
    toast('已儲存（記得撳「儲存到後端」）', 'ok');
  });
  el.querySelector('#st-reset')?.addEventListener('click', async () => {
    const { confirmDlg } = await import('../lib/util.js');
    if (await confirmDlg({ title: '還原示範資料', message: '會清走你改過嘅嘢。', ok: '還原', danger: true })) { S.resetDemo(); toast('已還原', 'ok'); go('system?tab=troop'); }
  });
  el.querySelectorAll('[data-mod]').forEach(s => s.addEventListener('change', () => {
    const id = s.dataset.mod, v = s.value;
    S.commit(dd => { dd.modules[id] = v === 'custom' ? (d.modules[id] && Array.isArray(d.modules[id]) ? d.modules[id] : d.branches.map(b => b.id)) : v; });
    S.audit('改模組開關', id + '（' + moduleList().find(m => m.id === id)?.label + '）', v);
    toast('已更新模組開關', 'ok'); go('system?tab=modules');
  }));
  el.querySelectorAll('[data-mod-b]').forEach(c => c.addEventListener('change', () => {
    const [mid, bid] = c.dataset.modB.split(':');
    S.commit(dd => {
      const cur = Array.isArray(dd.modules[mid]) ? dd.modules[mid] : [];
      const i = cur.indexOf(bid);
      if (c.checked && i < 0) cur.push(bid);
      if (!c.checked && i >= 0) cur.splice(i, 1);
      dd.modules[mid] = cur;
    });
    toast('已更新（指定支部）', 'ok');
  }));
  el.querySelector('[data-diag]')?.addEventListener('click', () => modal({
    title: '後端資料檢查（diag）',
    body: `<div class="mono-block">{
  unit: "${esc(d.unit.code)}",
  spreadsheet: "${esc(d.backend.spreadsheet)}",
  backendVersion: "${esc(d.backend.backendVersion)}",
  mode: "${esc(d.backend.mode)}",
  tables: ${d.backend.tables}, rows: ${d.backend.rows},
  broken: [${(d.backend.broken || []).map(x => `"${x}"`).join(', ')}],
  stagingRows: ${d.backend.stagingRows}
}</div><div class="xs faint mt-8">示範模式：數字係假嘅。真模式呢個檢查會直接講「邊張 Sheet、有咩分頁、各幾多行、對唔對得上名冊」。</div>`,
    footer: `<button class="btn primary" onclick="this.closest('.mask').remove()">明白</button>`
  }));
  el.querySelector('[data-sync]')?.addEventListener('click', () => runSync(el, 'ask'));
  el.querySelector('[data-sync-batch]')?.addEventListener('click', () => runSync(el, 'batch'));
  [el.querySelector('[data-queue]'), el.querySelector('[data-queue2]')].forEach(b => b?.addEventListener('click', async () => {
    if (!API.isLive()) return toast('示範模式：唔會真送（隊列係真模式先有）', '');
    const r = await SYNC.drainQueue({ force: true });           // 人手撳＝唔等 backoff
    toast(r.ok ? `已送走 ${r.sent} 筆` : `仲送唔到（${r.msg || r.code}）—— 留住 ${r.remaining ?? ''} 筆，約 ${Math.ceil((r.nextRetryMs || 0) / 1000)} 秒後再試`, r.ok ? 'ok' : 'err');
    go('system?tab=sync');
  }));
  el.querySelector('[data-repair]')?.addEventListener('click', () => { S.audit('修復後端', d.unit.name, '示範：清舊版本段／垃圾行'); toast('修復完成（示範）：清 0 行垃圾、0 段舊版本', 'ok'); });
  el.querySelector('[data-force]')?.addEventListener('click', async () => {
    const { confirmDlg } = await import('../lib/util.js');
    if (await confirmDlg({ title: '強制上載', message: '會跳過版本鎖，用呢部機嘅資料覆蓋後端。打字「上載」確認。', ok: '上載', danger: true, requireTyping: '上載' })) toast('（示範）已模擬強制上載', 'ok');
  });
  el.querySelector('[data-backup]')?.addEventListener('click', async () => {
    if (!API.isLive()) {
      S.commit(x => { (x.backups = x.backups || []).push({ at: new Date().toISOString().slice(0, 16).replace('T', ' '), file: `troop-${d.unit.code}-（示範）.json`, kb: d.backend.rows ? Math.max(1, Math.round(d.backend.rows / 2)) : 1 }); });
      S.audit('備份去 Drive', '（示範）', '示範模式：只入本機紀錄，冇真打 Drive');
      toast('示範模式：已記一次備份（真模式會真打 GAS → Drive，並做 13 份輪替）', 'ok', '', null, 6000);
      go('system?tab=data');
      return;
    }
    toast('備份中…（GAS 會建立檔＋設 PRIVATE＋做 13 份輪替）', '');
    const r = await API.gasAction('backupToDrive');
    if (!r.ok) { toast(String(r.msg || r.code), 'err', '', null, 7000); return; }
    toast(`已備份：${r.data.name}（${r.data.kb} KB）｜Drive 而家有 ${(r.data.kept || r.data.count || '?')} 份`, 'ok', '', null, 8000);
    go('system?tab=data');
  });
  el.querySelector('[data-backup-export]')?.addEventListener('click', () => {
    downloadFile(`troop-${d.unit.code}-backup.json`, JSON.stringify(S.exportAll(), null, 2));
    toast('已落本機（唔靠 Drive）', 'ok');
  });
  el.querySelector('[data-export]')?.addEventListener('click', () => {
    const j = S.exportAll();
    delete j._exportedFrom;
    downloadFile(`troop-${d.unit.code}-backup.json`, JSON.stringify(j, null, 2));
  });
  el.querySelector('[data-export-hash]')?.addEventListener('click', () => {
    const j = S.exportAll(); j._includeHash = true;
    j.users = j.users.map(u => ({ ...u, password_hash: '（64 位 hex 示範）' }));
    downloadFile(`troop-${d.unit.code}-withhash.json`, JSON.stringify(j, null, 2));
    toast('含 hash 匯出：用完即刻刪檔', 'warn');
  });
  el.querySelector('[data-import]')?.addEventListener('click', () => {
    const m = modal({
      title: '匯入 JSON',
      body: `<label class="f"><span class="lb">貼上 JSON</span><textarea id="im-json" style="min-height:160px" placeholder='{"unit":…}'></textarea></label>
      ${notice('匯入會驗 sha256（真模式）、transferId 冪等、撞號阻擋。', 'info')}
      ${backupState.stale || backupState.count === 0
      ? notice(`⚠️ <b>批量操作前提醒</b>：${backupState.remind}<br>建議先撳「即刻做 Drive 備份」或者「匯出 JSON」再匯入（匯入係覆蓋式，出事冇回頭）。`, 'warn')
      : notice('批量操作前：已經有新鮮備份，可以放心匯入。', 'ok')}`,
      footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-do>匯入</button>`
    });
    m.el.querySelector('[data-close]').onclick = m.close;
    m.el.querySelector('[data-do]').onclick = () => {
      try { S.importAll(JSON.parse(m.el.querySelector('#im-json').value)); m.close(); toast('已匯入（示範）', 'ok'); go('dashboard'); }
      catch (e) { toast('JSON 格式錯誤', 'err'); }
    };
  });
  el.querySelector('[data-print]')?.addEventListener('click', () => window.print());
  el.querySelector('[data-consent-text]')?.addEventListener('click', () => copyText(CONSENT));
}

/* ---------- 同步：即場做一次（有衝突＝逐格問，唔會自動揀） ---------- */
async function runSync(el, mode) {
  if (!API.isLive()) return toast('示範模式：零 fetch —— 唔會假裝同步（真模式先會連後端）', '');
  const r = await SYNC.syncNow({ mode });
  if (r.ok) {
    toast(`已同步：${r.wrote.length ? r.wrote.join('、') : '冇改動'}${r.overwrote.length ? `（${r.overwrote.length} 格用 serverTime 新者勝，已留底）` : ''}`, 'ok', '', null, 6000);
    return go('system?tab=sync');
  }
  if (r.code === 'need_decisions') return askConflicts(el, r.conflicts);
  toast(`同步未成（${r.msg || r.code}）${r.queued ? `—— 已暫存 ${r.queued} 筆喺本機隊列` : ''}`, 'err', '', null, 7000);
  go('system?tab=sync');
}

/** 逐格確認：每一格只問一句「用我／用佢」，唔會幫你揀 */
function askConflicts(el, conflicts = []) {
  const row = c => `<tr>
    <td><div class="bold">${esc(c.label)}</div><div class="xs faint mono">${esc(String(c.mine ?? ''))} ／ ${esc(String(c.theirs ?? ''))}</div></td>
    <td class="nowrap"><label class="check"><input type="radio" name="cf-${c.i}" value="mine" checked> 用我</label></td>
    <td class="nowrap"><label class="check"><input type="radio" name="cf-${c.i}" value="theirs"> 用佢</label></td>
  </tr>`;
  const m = modal({
    title: `同一格兩邊都改過：逐格揀（${conflicts.length} 格）`,
    wide: true,
    body: `${notice('呢啲格仔<b>兩邊都改過</b>：系統唔會幫你自動揀。冇揀嘅＝保持你嘅版本。（其餘唔同欄嘅改動會自動合併，唔會問你。）', 'warn')}
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>邊一格</th><th>我嘅版本</th><th>佢嘅版本</th></tr></thead>
      <tbody>${conflicts.map(row).join('')}</tbody></table></div>
      <div class="xs faint mt-8">「佢」＝後端最新；「我」＝你呢部機。揀完會即刻寫返後端，並記入本機同步紀錄。</div>`,
    footer: `<button class="btn" data-cancel>取消（留返隊列）</button><button class="btn primary" data-ok>套用並同步</button>`,
    onMount: (dlg, close) => {
      dlg.querySelector('[data-cancel]').onclick = close;
      dlg.querySelector('[data-ok]').onclick = async () => {
        const decisions = {};
        conflicts.forEach(c => { decisions[c.key] = dlg.querySelector(`input[name="cf-${c.i}"]:checked`)?.value || 'mine'; });
        close();
        const r2 = await SYNC.syncNow({ decisions });
        if (r2.ok) { toast(`逐格揀完，已同步（用我 ${r2.picked?.mine ?? 0} 格／用佢 ${r2.picked?.theirs ?? 0} 格）`, 'ok', '', null, 6000); el.innerHTML = ''; go('system?tab=sync'); }
        else { toast(`套用之後仲未成（${r2.msg || r2.code}）`, 'err'); el.innerHTML = ''; go('system?tab=sync'); }
      };
    }
  });
  return m;
}

const CONSENT = `【個人資料收集同意書（家長同意）】
1. 收集咩：子女姓名、出生日期、童軍編號（YMIS）、進度紀錄、參與活動紀錄，以及家長聯絡資料。
2. 用途：團務運作、活動安排、進度考核、緊急聯絡。
3. 邊個睇到：貴子女所屬支部嘅團長／副團長；旅長及教練員經授權可看摘要；平台超管只處理技術問題。
4. 保存：在役期間保存；離隊（TRANSFERRED_OUT／LEFT）後 12 個月刪除或匿名化。
5. 查閱／改正：可隨時向團長要求查閱或改正。
6. 查詢：請聯絡本旅旅長。`;

function toolbarLocal() {
  return `<div class="flex-w mb-12 no-print">
    <span class="grow"></span>
    <button class="btn sm" onclick="window.print()">${icon('print', 13)} 列印</button>
  </div>`;
}

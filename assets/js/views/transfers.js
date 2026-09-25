/* 移交與升降團 — 移出 tombstone、移交套裝 JSON（sha256）、目標接收、升團季批量 */
import { esc, icon, toast, downloadFile, fmtDate, copyText } from '../lib/util.js';
import * as S from '../lib/store.js';
import { go } from '../lib/router.js';
import { page, card, table, badge, notice, tabs, stat, modal, kv, empty } from './ui.js';

export function render(el, params, query = {}) {
  const tab = query.tab || 'pending';
  const d = S.load();
  const pending = d.transfers.filter(t => t.state === 'pending');

  const tabsHtml = `<div class="tabs">
    ${[['pending', '待接收'], ['batch', '升團季批量'], ['history', '歷史']].map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}${k === 'pending' && pending.length ? ` <span class="tag gold sm">${pending.length}</span>` : ''}</button>`).join('')}
  </div>`;

  let body = '';
  if (tab === 'pending') {
    body = `
    ${notice('全部轉換（跨支部／轉旅／調區／海轉空）都係<b>同一套</b>：① 來源領袖「移出」→ 記錄 <span class="mono">TRANSFERRED_OUT</span>（tombstone）＋ transferTo／transferDate，歷史留來源唯讀；② 生成移交套裝 JSON ＋ sha256；③ 目標領袖「接收」→ 驗撞號 → 新 ACTIVE membership（同一個 SCOUT_ID）；④ <span class="mono">transferId</span> 冪等，重複匯入拒絕。', 'info')}
    <div class="grid g2 mt-12">
      ${pending.length ? pending.map(t => card({
      title: `${t.name}（${t.scoutId}）`, sub: `${S.branchName(t.from)} → ${S.branchName(t.to)} · ${t.reason}`,
      actions: `<button class="btn sm primary" data-accept="${t.id}">接收</button><button class="btn sm danger" data-decline="${t.id}">退回</button>`,
      body: `${kv([['申請日', fmtDate(t.at)], ['套裝雜湊', `<span class="mono xs">${esc(t.bundle)}</span>`], ['密碼安排', '目標團開戶流程（1234 ＋ 強制改密碼）'], ['家長', '同旅移動零改動（children 用全球 SCOUT_ID）']])}
        <div class="mt-8">${notice(esc(t.note), 'warn')}</div>
        <div class="btn-row mt-8"><button class="btn xs" data-view-bundle="${t.id}">睇移交套裝 JSON</button></div>`
    })).join('') : card({ body: empty('暫時冇待接收嘅移交') })}
    </div>`;
  } else if (tab === 'batch') {
    const members = d.members.filter(m => m.identity === '成員');
    body = `
    ${card({ title: '升團季批量', sub: '多選成員 → 一個 bundle 檔（升團季一次過處理）',
      actions: `<button class="btn sm primary" id="tf-build">${icon('download', 13)} 產生 bundle</button>`,
      body: `
      <div class="grid g2 mb-12">
        <label class="f"><span class="lb">由邊個支部升</span><select id="tf-from">${S.myBranches().map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></label>
        <label class="f"><span class="lb">升去邊個支部</span><select id="tf-to">${S.myBranches().map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></label>
      </div>
      ${table({
        cls: 'tbl compact', head: ['選', 'YMIS', '姓名', '現屬支部', '生日', '狀態'],
        rows: members.map(m => ({
          cells: [
            `<input type="checkbox" data-pick="${m.ymis}">`,
            { text: m.ymis, cls: 'mono' }, esc(m.name), esc(S.branchName(m.branchId)), esc(m.dob), badge(m.status, 'g', true)
          ]
        })),
        empty: '冇可移交成員'
      })}
      <div class="mt-12">${notice('bundle 內容：<span class="mono">{transferId, scout_id, ymis, name, dob, 家長聯絡, 先修章摘要}</span> ＋ sha256；檔案面交或私密頻道傳送（唔好經公開群組）。', 'info')}</div>` })}
    `;
  } else {
    body = `${card({ title: '移交歷史', body: table({
      head: ['成員', '由', '去', '原因', '日期', '狀態', '套裝'],
      rows: d.transfers.map(t => ({
        cells: [{ text: t.scoutId, cls: 'mono' }, esc(t.name), esc(S.branchName(t.from)), esc(S.branchName(t.to)), esc(t.reason), fmtDate(t.at),
        badge({ pending: '待接收', done: '已完成', out: '已移出' }[t.state] || t.state, { done: 'g', pending: 'y', out: 'n' }[t.state] || 'n', true),
        `<span class="mono xs">${esc(t.bundle)}</span>`]
      }))
    }) })}`;
  }

  el.innerHTML = page({ title: '移交與升降團', sub: `${pending.length} 單待接收 · ${d.transfers.length} 單歷史`, body: tabsHtml + body });

  el.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => go('transfers?tab=' + t.dataset.tab)));
  el.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', () => accept(b.dataset.accept)));
  el.querySelectorAll('[data-decline]').forEach(b => b.addEventListener('click', () => {
    S.commit(dd => { const t = dd.transfers.find(x => x.id === b.dataset.decline); if (t) t.state = 'out'; });
    S.audit('退回移交', b.dataset.decline, '');
    toast('已退回來源團', 'warn'); go('transfers?tab=pending');
  }));
  el.querySelectorAll('[data-view-bundle]').forEach(b => b.addEventListener('click', () => viewBundle(b.dataset.viewBundle)));
  el.querySelector('#tf-build')?.addEventListener('click', () => {
    const picks = Array.from(el.querySelectorAll('[data-pick]:checked')).map(x => x.dataset.pick);
    if (!picks.length) return toast('請先揀成員', 'err');
    const bundle = {
      transferId: 'bundle-' + Date.now(), issuedAt: new Date().toISOString(),
      from: el.querySelector('#tf-from').value, to: el.querySelector('#tf-to').value,
      count: picks.length,
      members: picks.map(y => {
        const m = S.memberByYmis(y);
        return { scout_id: y, ymis: y, name: m.name, dob: m.dob, 家長聯絡: '（示範：由來源團決定帶唔帶）' };
      }),
      sha256: '（真模式：server-side 計算，附喺檔頭）'
    };
    downloadFile(`transfer-bundle-${Date.now()}.json`, JSON.stringify(bundle, null, 2));
    S.audit('產生升團 bundle', `${picks.length} 位成員`, '');
    toast(`已產生 bundle（${picks.length} 位成員）`, 'ok');
  });
}

function viewBundle(id) {
  const t = S.load().transfers.find(x => x.id === id);
  const j = JSON.stringify({
    transferId: t.bundle.replace('sha256:', 'tid-'),
    scout_id: t.scoutId, ymis: t.scoutId, name: t.name,
    dob: '2007-04-12', 家長聯絡: 'parent@demo.troop',
    先修章摘要: ['深資童軍章', '服務章'],
    transferTo: t.to, transferDate: new Date().toISOString().slice(0, 10),
    sha256: t.bundle
  }, null, 2);
  const m = modal({
    title: `移交套裝 JSON · ${t.name}`,
    body: `<div class="mono-block" style="max-height:340px">${esc(j)}</div>
    <div class="xs faint mt-8">真實模式：檔案面交或私密頻道傳送；目標領袖匯入時驗 sha256 ＋ transferId 冪等 ＋ 撞號阻擋。</div>`,
    footer: `<button class="btn" data-close>關閉</button><button class="btn primary" data-copy>複製 JSON</button>`
  });
  m.el.querySelector('[data-close]').onclick = m.close;
  m.el.querySelector('[data-copy]').onclick = () => copyText(j);
}

async function accept(id) {
  const t = S.load().transfers.find(x => x.id === id);
  if (!t) return;
  const { confirmDlg } = await import('../lib/util.js');

  /* 冪等：同一張移交接收過就唔會再建（transferId 係唯一鍵） */
  if (t.state === 'done' && t.transferId) {
    toast(`呢單已經接收過（transferId ${t.transferId}）—— 重複匯入一律被拒`, 'warn', '', null, 5200);
    return;
  }
  /* 撞號阻擋：目標支部未可以已經有同一個 SCOUT_ID 現役 */
  const dup = S.load().members.filter(m => m.ymis === t.scoutId && m.branchId === t.to && m.status === 'ACTIVE');
  if (dup.length) {
    S.audit('接收移交被拒（撞號）', `${t.name}（${t.scoutId}）`, `${S.branchName(t.to)} 已有同號現役成員`);
    toast('撞號：目標支部已經有同一個 SCOUT_ID 現役 —— 唔會重複建，請人手核對', 'err', '', null, 6000);
    return;
  }
  if (!await confirmDlg({
    title: `接收 ${t.name}`,
    message: `由 <b>${esc(S.branchName(t.from))}</b> 接收 <b>${esc(t.name)}</b>（${esc(t.scoutId)}）？<div class="mt-8">• 會驗：scout_id／ymis 無現役撞號<br>• 新建 ACTIVE membership（同一個 SCOUT_ID）<br>• 發一個 transferId（冪等鍵）：重複匯入會被拒<br>• 密碼行開戶流程：1234 ＋ 首登強制改</div>`,
    ok: '接收'
  })) return;

  const transferId = t.transferId || ('tid-' + String(t.scoutId).replace(/[^0-9A-Za-z]/g, '') + '-' + Date.now().toString(36).toUpperCase());
  const at = new Date().toISOString().slice(0, 16).replace('T', ' ');
  S.commit(dd => {
    const x = dd.transfers.find(y => y.id === id);
    if (x) {
      x.state = 'done';
      x.transferId = transferId;
      x.acceptedAt = at;
      x.acceptedBy = S.currentUser()?.name || '';
      x.note = `已接收，名冊已建 ACTIVE（transferId ${transferId}）`;
    }
    const m = dd.members.find(y => y.ymis === t.scoutId);
    if (m) { m.branchId = t.to; m.status = 'ACTIVE'; m.fromBranch = t.from; m.transferId = transferId; m.joined = at.slice(0, 10); }
    else dd.members.push({ ymis: t.scoutId, name: t.name, branchId: t.to, identity: '成員', status: 'ACTIVE', fromBranch: t.from, transferId, joined: at.slice(0, 10) });
  });
  S.audit('接收移交', `${t.name}（${t.scoutId}）`, `${S.branchName(t.from)} → ${S.branchName(t.to)} · transferId ${transferId}`);
  toast(`已接收：名冊已建 ACTIVE（同一個 SCOUT_ID）· transferId ${transferId}`, 'ok', '', null, 5600);
  go('transfers?tab=history');
}

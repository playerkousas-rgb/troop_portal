/* 移交與升降團 — 移出 tombstone、移交套裝 JSON（sha256）、目標接收、升團季批量 */
import { esc, icon, toast, downloadFile, fmtDate, copyText, todayISO } from '../lib/util.js';
import * as S from '../lib/store.js';
import * as API from '../lib/api.js';
import { hashForBundle } from '../lib/hash.js';
import { verifyBundle, acceptRow, outPatch } from '../lib/transfer.js';
import { go } from '../lib/router.js';
import { page, card, table, badge, notice, tabs, stat, modal, kv, empty } from './ui.js';

export function render(el, params, query = {}) {
  const tab = query.tab || 'pending';
  const d = S.load();
  const pending = d.transfers.filter(t => t.state === 'pending');

  const tabsHtml = `<div class="tabs">
    ${[['out', '移出（來源團）'], ['pending', '接收（目標團）'], ['batch', '升團季批量'], ['history', '歷史']].map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}${k === 'pending' && pending.length ? ` <span class="tag gold sm">${pending.length}</span>` : ''}</button>`).join('')}
  </div>`;

  let body = '';
  if (tab === 'out') {
    const members = d.members.filter(m => m.status === 'ACTIVE');
    const branches = S.myBranches();
    body = `
    ${notice('移出＝記 <span class="mono">TRANSFERRED_OUT</span>（tombstone）＋ transferTo／transferDate；來源團歷史<b>留唯讀</b>。跟住出一份<b>移交套裝 JSON ＋ sha256</b>，面交或者經私密頻道交俾目標團 —— 目標團撳「接收」先會建新名冊（同一個 SCOUT_ID）。', 'info')}
    ${card({ title: '① 移出（來源團做）', sub: '移出之後：本團唔會再改呢位成員嘅紀錄；家長處理睇下面嗰格', body: `
      <div class="grid g2">
        <label class="f"><span class="lb">成員</span><select id="to-scout">${members.map(m => `<option value="${esc(m.ymis)}" data-branch="${esc(m.branchId)}">${esc(m.name)}（${esc(m.ymis)}）· ${esc(S.branchName(m.branchId))}</option>`).join('')}</select></label>
        <label class="f"><span class="lb">移去邊度</span><input type="text" id="to-to" placeholder="vs0082 / 第八十三旅 / 調區"></label>
        <label class="f"><span class="lb">原因</span><select id="to-reason">
          <option value="升團">升團（支部升支部）</option><option value="轉旅">轉旅</option>
          <option value="調區">調區</option><option value="海轉空">海轉空</option><option value="其他">其他</option></select></label>
        <label class="f"><span class="lb">生效日</span><input type="date" id="to-date" value="${todayISO()}"></label>
        <label class="f"><span class="lb">家長聯絡（套裝會帶，方便接收旅重開家長戶）</span><input type="text" id="to-parent" placeholder="parent@example.hk"></label>
        <label class="f"><span class="lb">先修章摘要（可空）</span><input type="text" id="to-badges" placeholder="深資童軍章、服務章"></label>
      </div>
      <div class="mt-12">${notice('<b>家長點處理？</b>同旅移動＝零改動（children 用全球 SCOUT_ID）；轉旅／調區＝來源家長戶會轉 LEFT，接收旅用套裝內 email 發一次性邀請連結重開（系統會出一段通知文案俾你 copy）。', 'warn')}</div>
      <label class="check mt-8"><input type="checkbox" id="to-same"> 呢次係<b>同一旅</b>內部移動（家長零改動）</label>
      <div class="btn-row mt-8">
        <button class="btn primary" id="to-go">${icon('logout', 14)} 移出 ＋ 產生移交套裝</button>
      </div>
      <div class="xs faint mt-8">真模式：經同源 <span class="mono">/api/proxy</span> 交俾旅 GAS 記 tombstone 同算 sha256（apikey 只喺 server 側）。示範模式：只記本機示範資料 ＋ 標明示範雜湊。</div>` })}
    ${card({ title: '② 接收（目標團做）', sub: '收到個檔之後：驗 sha256 → 冪等 → 撞號阻擋 → 建名冊', body: `
      <div class="btn-row"><button class="btn" id="tf-import">${icon('upload', 14)} 匯入移交套裝（貼 JSON 或揀檔）</button></div>
      <div class="xs faint mt-8">接收完會建 <span class="mono">pending_hash</span>（等開戶流程：首登強制改密碼）；撞號＝唔會重複建，會叫你人手核對。</div>` })}
    `;
  } else if (tab === 'pending') {
    body = `
    ${card({ title: '收到套裝？喺度匯入', sub: '面交／私密頻道收到嘅 JSON：驗 sha256 → 冪等 → 撞號 → 建名冊',
      body: `<div class="btn-row"><button class="btn primary" id="tf-import">${icon('upload', 14)} 匯入移交套裝</button>
        <button class="btn" id="tf-import-file">${icon('doc', 14)} 揀 .json 檔</button></div>
      <div class="xs faint mt-8">撞號／重複匯入一律唔會靜靜建 —— 會明確講發生咩事，等人手核對。</div>` })}
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
  el.querySelector('#to-go')?.addEventListener('click', () => doTransferOut(el));
  el.querySelectorAll('#tf-import').forEach(b => b.addEventListener('click', () => importBundle(el)));
  el.querySelector('#tf-import-file')?.addEventListener('click', () => pickBundleFile(el));
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

/* ---------- ① 移出（來源團）：真模式叫 GAS；示範模式本機做，並標明雜湊種類 ---------- */
async function doTransferOut(el) {
  const scout = el.querySelector('#to-scout')?.value || '';
  const to = el.querySelector('#to-to')?.value.trim() || '';
  const reason = el.querySelector('#to-reason')?.value || '';
  const date = el.querySelector('#to-date')?.value || todayISO();
  const parentEmail = el.querySelector('#to-parent')?.value.trim() || '';
  const badges = el.querySelector('#to-badges')?.value.trim() || '';
  const sameTroop = !!el.querySelector('#to-same')?.checked;
  if (!scout) return toast('請揀成員', 'err');
  if (!to) return toast('請填移去邊度', 'err');
  const m = S.memberByYmis(scout) || {};
  const from = m.branchId || S.myBranches()[0]?.id || '';

  const bundle = {
    transferId: 'tid-' + scout.replace(/[^0-9A-Za-z]/g, '') + '-' + Date.now().toString(36).toUpperCase(),
    scout_id: scout, ymis: scout, name: m.name || '', dob: m.dob || '',
    parentContact: parentEmail, badgeSummary: badges,
    transferTo: to, transferDate: date
  };
  const h = await hashForBundle(bundle);     // canonical 欄序（同 GAS 一樣）
  const sha = h.hash;

  let res = null;
  if (API.isLive()) {
    res = await API.transferOut({ scoutId: scout, name: m.name, dob: m.dob, from, to, reason, date, parentEmail, badgeSummary: badges, parentSameTroop: sameTroop, sha256: sha });
    if (!res.ok) return toast(`移出未成（${res.msg || res.code}）—— 冇記低任何嘢`, 'err');
  } else {
    /* 示範：記本機（真模式唔會行呢段）—— 規則同 GAS 一樣，住 lib/transfer.js */
    S.commit(dd => {
      const patch = outPatch({ ...bundle, sha256: sha }, { from, to, reason, date, sameTroop });
      patch.row.bundle = `${h.kind === 'sha256' ? 'sha256' : 'demo'}:${sha}`;
      patch.row.note = '示範模式：套裝由前端計雜湊；真模式由旅 GAS 再算一次';
      const x = dd.members.find(y => y.ymis === scout);
      if (x) Object.assign(x, patch.member);
      dd.transfers.push(patch.row);
    });
  }
  S.audit('移出（' + reason + '）', `${m.name || scout}（${scout}）`, `${from} → ${to}｜${h.kind} ${sha.slice(0, 12)}`);
  downloadFile(`transfer-${scout}.json`, JSON.stringify({ ...bundle, sha256: sha, hashKind: h.kind }, null, 2));
  toast(`已移出 ＋ 出咗套裝（${h.kind === 'sha256' ? 'sha256' : '示範雜湊'} ${sha.slice(0, 10)}…）`, 'ok', '', null, 6000);
  const notice2 = res?.data?.parentNotice;
  if (notice2) {
    const mm = modal({
      title: '家長通知文案（copy 落群組／WhatsApp）',
      body: `<div class="mono-block">${esc(notice2)}</div><div class="xs faint mt-8">同旅移動＝唔需要呢段（家長零改動）。</div>`,
      footer: `<button class="btn" data-close>關閉</button><button class="btn primary" data-copy>複製</button>`
    });
    mm.el.querySelector('[data-close]').onclick = mm.close;
    mm.el.querySelector('[data-copy]').onclick = () => copyText(notice2);
  }
  go('transfers?tab=history');
}

/* 揀 .json 檔 → 讀入 → 直接開匯入框（唔會自動接收，仲要撳一次） */
function pickBundleFile(el) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { const m = importBundle(el); const ta = m.el.querySelector('#tf-json'); if (ta) ta.value = String(r.result || ''); };
    r.onerror = () => toast('讀唔到個檔', 'err');
    r.readAsText(f);
  };
  inp.click();
}

/* ---------- ② 接收（目標團）：驗 sha256 → 冪等 → 撞號 → 建名冊 ---------- */
function importBundle(el) {
  const m = modal({
    title: '匯入移交套裝（目標團）',
    body: `${notice('貼成套 JSON 落去。系統會：① 驗 sha256（改過一個字都唔收）② 睇 transferId（重複匯入＝拒）③ 驗撞號（本旅已有同一個 SCOUT_ID 現役＝阻住，人手處理）④ 建 <span class="mono">pending_hash</span> 等開戶流程。', 'info')}
      <label class="f mt-8"><span class="lb">移交套裝 JSON</span><textarea id="tf-json" rows="8" placeholder='{"transferId":"tid-…","scout_id":"YMIS-…",…,"sha256":"…"}'></textarea></label>
      <label class="f"><span class="lb">收去邊個支部（可空）</span><input type="text" id="tf-to" placeholder="vs"></label>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-do>驗證並接收</button>`,
    onMount: (dlg, close) => {
      dlg.querySelector('[data-close]').onclick = close;
      dlg.querySelector('[data-do]').onclick = async () => {
        let raw = null, obj = null;
        try { obj = JSON.parse(dlg.querySelector('#tf-json').value || ''); } catch { return toast('JSON 格式唔啱', 'err'); }
        raw = obj && obj.sha256;
        const to = dlg.querySelector('#tf-to').value.trim();
        if (API.isLive()) {
          const r = await API.importTransferBundle({ bundle: obj, sha256: raw, to });     // GAS 會自己再驗一次（final 話事）
          if (r.ok && r.data?.duplicate) return toast('呢個 transferId 已經接收過 —— 唔會建第二次（冪等）', 'warn', '', null, 6000), close();
          if (!r.ok) return toast(`接收唔到（${r.msg || r.code}）`, 'err', '', null, 6500);
          toast(`已接收（${obj.scout_id}）—— 名冊 status＝pending_hash，首登會強制改密碼`, 'ok', '', null, 6500);
          S.audit('接收移交（真模式）', obj.scout_id, `transferId ${obj.transferId}`);
          close(); return go('transfers?tab=history');
        }
        /* 示範模式：同一套規矩（驗 hash／冪等／撞號）都做 —— 規則住 lib/transfer.js，同 GAS 對齊 */
        const dd = S.load();
        const v = await verifyBundle(obj, { sha256: raw, members: dd.members, transfers: dd.transfers });
        if (!v.ok) return toast(v.msg, v.code === 'duplicate' ? 'warn' : 'err', '', null, 6500);
        S.commit(x => {
          x.members.push(acceptRow(obj, to, todayISO()));
          x.transfers.push({
            id: obj.transferId, scoutId: obj.scout_id, name: obj.name || '', from: obj.transferFrom || '（來源團）',
            to: to || obj.transferTo || '', reason: '接收匯入', at: todayISO(), state: 'done',
            bundle: `sha256:${v.hash}`, sha256: v.hash, transferId: obj.transferId,
            note: '已接收（示範）：pending_hash，首登強制改密碼'
          });
        });
        S.audit('接收移交（示範）', obj.scout_id, `transferId ${obj.transferId}`);
        toast('已接收（示範）—— 名冊 status＝pending_hash', 'ok');
        close(); go('transfers?tab=history');
      };
    }
  });
  return m;
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

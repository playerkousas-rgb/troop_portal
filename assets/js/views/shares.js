/* ============================================================
   分享中心 — ★ 收件方決定（你嘅規則）
   ------------------------------------------------------------
   規矩（你 2026-09-25 定）：
     A 團 share 去 B 團 → **B 團自己決定要唔要佢出現**
     · 未接收＝淨係喺「待接收」見到（唔會混入你嘅清單）
     · 接收＝先會出現喺接收方嘅通告／活動／物資／進度
     · 退回＝連紀錄都留住（記邊個決定），唔會靜靜地消失
   決定權：該支部執委或以上（rank ≥ 3）；旅長／教練員可以代勞（會記低係邊個落決定）。
   ============================================================ */
import { esc, icon, toast } from '../lib/util.js';
import * as S from '../lib/store.js';
import { go } from '../lib/router.js';
import { page, card, table, badge, notice, tabs, modal, kv, fold } from './ui.js';
import { can, visName, visClass, canDecideShare, SHARE_KINDS } from '../lib/registry.js';

export function render(el, params, query = {}) {
  const tab = query.tab || 'inbox';
  const d = S.load();
  const s = S.getSession();
  const role = s?.role || 'guest';
  const myBid = S.myBranchId();
  const isTroop = ['chief', 'coach'].includes(role);
  const inbox = isTroop ? S.shares().filter(x => x.state === 'pending') : S.pendingShares(myBid);
  const toMe = isTroop ? S.shares() : S.sharesToMe(myBid);
  const mine = isTroop ? S.shares().filter(x => x.state !== 'pending') : S.sharesFromMe(myBid);
  const canDecide = isTroop ? role === 'chief' : canDecideShare(role, S.viewerRank());

  const tabsHtml = tabs([
    ['inbox', `待接收${inbox.length ? ` (${inbox.length})` : ''}`],
    ['accepted', '已接收'],
    ['sent', isTroop ? '全部分享' : '我哋發出'],
    ['rules', '分享規矩']
  ], tab);

  const kindTag = k => badge(S.KIND_LABEL[k] || k, { notice: 'b', event: 'g' }[k] || 'n', true);
  const stateTag = st => ({
    pending: badge('待你哋決定', 'y', true),
    accepted: badge('已接收', 'g', true),
    declined: badge('已退回', 'n', true),
    withdrawn: badge('已撤回', 'r', true)
  }[st] || badge(st, 'n', true));
  const row = x => ({
    cells: [
      `${kindTag(x.kind)} <b>${esc(x.title)}</b>${x.note ? `<div class="xs faint">${esc(x.note)}</div>` : ''}`,
      `${esc(S.branchName(x.from))} → ${x.to === 'all' ? '<span class="tag gold sm">全旅</span>' : esc(S.branchName(x.to))}`,
      `<span class="tag n sm ${visClass(x.level)}">${esc(visName(x.level))}</span>`,
      `<span class="xs">${esc(x.by || '')}<br><span class="faint">${esc(x.at || '')}</span></span>`,
      x.state === 'pending' && canDecide && (x.to !== 'all' || isTroop)
        ? `<div class="btn-row"><button class="btn xs primary" data-ok="${x.id}">接收（畀佢出現）</button><button class="btn xs" data-no="${x.id}">退回</button></div>`
        : `${stateTag(x.state)}${x.suggest ? `<div class="xs">${esc(x.suggest.by)} 建議：${esc(x.suggest.text)}</div>` : ''}${x.decidedBy ? `<div class="xs faint">${esc(x.decidedBy)} · ${esc(x.decidedAt || '')}</div>` : ''}${x.state === 'pending' && !canDecide ? `<button class="btn xs mt-8" data-note="${x.id}">加註解交團長／執委</button>` : ''}${x.state === 'pending' && x.to === 'all' && !isTroop ? `<div class="xs faint">全旅分享：由旅長決定</div>` : ''}`
    ]
  });

  const headInbox = ['分享內容', '由邊度嚟', '可見等級', '幾時／邊個發', '你嘅決定'];
  const headSent = ['分享內容', '去邊', '可見等級', '幾時／邊個發', '狀態'];

  let body;
  if (tab === 'inbox') {
    body = `
    ${notice('★ <b>收件方決定</b>：其他人 share 嚟嘅嘢，<b>要你哋接收先會出現</b>喺你嘅通告／活動／物資／進度清單。未接收＝淨係喺呢一頁見到。', 'info')}
    ${card({
      title: `待接收（${inbox.length}）`, sub: isTroop ? '旅長／教練員視角：全部支部之間嘅待接收分享' : `發去 ${esc(S.branchName(myBid))} 但未決定嘅分享`,
      body: table({ head: headInbox, rows: inbox.map(row), empty: '冇待接收 —— 冇人 share 嘢畀你／你已經決定晒' })
    })}
    ${!canDecide && inbox.length ? notice('你嘅身份唔夠決定權：接收／退回要 <b>執委或以上</b>（或者團長）。你可以撳「<b>加註解交團長／執委</b>」留低意見 —— 你嘅註解會顯示喺決定人嗰行，但<b>唔會</b>當你決定咗。', 'warn') : ''}
    `;
  } else if (tab === 'accepted') {
    const acc = toMe.filter(x => x.state === 'accepted');
    body = `
    ${card({
      title: `已接收（${acc.length}）`, sub: '呢啲先會真係出現喺你嘅清單；可以隨時收回（收回＝即刻唔再出現）',
      body: table({
        head: headInbox, rows: acc.map(x => ({
          cells: [...row(x).cells.slice(0, 4), `${stateTag('accepted')}<div class="xs faint">${esc(x.decidedBy || '')} · ${esc(x.decidedAt || '')}</div>${x.to !== 'all' && canDecide ? `<button class="btn xs mt-8" data-revoke="${x.id}">收回（唔再出現）</button>` : ''}`]
        })), empty: '未有已接收嘅分享'
      })
    })}
    ${fold({
      title: '接收之後，喺邊度見到？', sub: '只有兩樣（你定嘅範圍）', body: table({
        cls: 'tbl compact', head: ['種類', '接收後出現喺', '備註'], rows: [
          { cells: ['通告', '通告頁', '每項標明「來自 XX 團」，同自己團嘅通告同一版但分開一組'] },
          { cells: ['活動', '行事曆（月曆格 ＋ 本月活動）', '用「分享」樣式，唔會混入你自己支部嘅顏色'] }
        ]
      })
    })}
    `;
  } else if (tab === 'sent') {
    body = `
    ${card({
      title: isTroop ? `全部分享（${S.shares().length}）` : `我哋發出（${mine.length}）`,
      sub: '發出去嘅分享：未接收之前，對方唔會見到（除咗「分享中心」）',
      body: table({
        head: headSent, rows: (mine.length ? mine : S.shares()).map(x => ({
          cells: [row(x).cells[0], row(x).cells[1], row(x).cells[2], row(x).cells[3],
            `${stateTag(x.state)}${x.decidedBy ? `<div class="xs faint">${esc(x.decidedBy)} · ${esc(x.decidedAt || '')}</div>` : ''}${x.state === 'pending' && canDecide ? `<button class="btn xs mt-8" data-pull="${x.id}">撤回</button>` : ''}`]
        })), empty: '你哋未發出過分享'
      }),
      actions: (isTroop || canDecide) ? `<button class="btn sm primary" id="sh-new">${icon('plus', 13)} 發起分享</button>` : ''
    })}
    ${notice('分享係<b>一對一</b>（或全旅）嘅：例如你係深資決定 share 去童軍，童軍收唔收就係童軍決定 —— 唔會自動彈去所有支部。<br>★ 目前只做兩樣：<b>通告</b>同<b>活動（行事曆）</b>；物資／進度／相簿等之後先加。', 'info')}
    `;
  } else {
    body = `
    ${card({
      title: '分享規矩（一頁睇清）', body: table({
        cls: 'tbl compact', head: ['步驟', '邊個做', '做咩'], rows: [
          { cells: ['1 發出', '物主支部（執委或以上）', '揀種類、內容、目標支部、可見等級 → 送出'] },
          { cells: ['2 接收', '<b>收件支部</b>（執委或以上／團長）', '接收＝先會出現；退回＝留紀錄（記理由）'] },
          { cells: ['3 出現', '系統', '混入接收方清單（<b>通告頁</b>／<b>行事曆</b>），每項標明「來自 XX 團」'] },
          { cells: ['4 收回', '收件支部 或 物主', '任何時間可以收回；收回即刻唔再出現'] },
          { cells: ['旅公開', '旅長', '要對外（免登入）嘅，另外上報旅長批'] }
        ]
      })
    })}
    ${card({
      title: '冇收件方決定會點？', body: `你嘅原話：<i>「我係深資決定 share 畀童軍，童軍畀唔畀佢出現就係童軍決定」</i> —— 所以：
      <ul class="doc">
        <li><b>唔會自動出現</b>：未接收嘅分享只喺「分享中心 · 待接收」。</li>
        <li><b>唔會靜靜地消失</b>：退回都會留紀錄（邊個決定、幾時、理由）。</li>
        <li><b>撤回權留返物主</b>：物主可以撤回未接收嘅分享。</li>
        <li><b>未夠決定權</b>：成員／青少年領袖見到「待接收」，可以加註解交團長／執委決定（唔等於決定）。</li>
        <li><b>只做兩樣</b>：通告（通告頁）同活動（行事曆）；其他種類 UI 唔開，但資料欄已經留住。</li>
      </ul>` })}
    `;
  }

  el.innerHTML = page({
    title: '分享中心', sub: `待你哋決定 ${inbox.length} · 已接收 ${toMe.filter(x => x.state === 'accepted').length} · 我哋發出 ${S.sharesFromMe(myBid).length}`,
    body: tabsHtml + body
  });

  el.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => go('shares?tab=' + t.dataset.tab)));

  const doDecide = (id, state) => {
    const x = S.shares().find(v => v.id === id);
    if (!x) return;
    if (state === 'declined') {
      const m = modal({
        title: '退回分享', body: `<div class="sm">${esc(x.title)}（來自 ${esc(S.branchName(x.from))}）</div>
        <label class="f mt-12"><span class="lb">理由（會交返物主）</span><input type="text" id="sh-why" placeholder="例：同本團活動撞期／成員未夠年齡"></label>`,
        footer: `<button class="btn" data-close>唔退回</button><button class="btn danger" data-save>確認退回</button>`
      });
      m.el.querySelector('[data-close]').onclick = m.close;
      m.el.querySelector('[data-save]').onclick = () => {
        S.decideShare(id, 'declined', m.el.querySelector('#sh-why').value.trim());
        S.audit('退回分享', x.title, `來自 ${S.branchName(x.from)}`);
        m.close(); toast('已退回（紀錄已留）', 'ok'); go('shares?tab=inbox');
      };
      return;
    }
    S.decideShare(id, state);
    S.audit(state === 'accepted' ? '接收分享' : '收回分享', x.title, `來自 ${S.branchName(x.from)}`);
    toast(state === 'accepted' ? '已接收 —— 由而家開始會出現喺你嘅清單' : '已收回 —— 即刻唔再出現', 'ok');
    go('shares?tab=' + (state === 'accepted' ? 'accepted' : 'inbox'));
  };
  el.querySelectorAll('[data-note]').forEach(b => b.addEventListener('click', () => {
    const x = S.shares().find(v => v.id === b.dataset.note);
    const m = modal({
      title: '加註解（交團長／執委決定）',
      body: `<div class="sm">${esc(x.title)}（來自 ${esc(S.branchName(x.from))}）</div>
      <label class="f mt-12"><span class="lb">你嘅意見</span><input type="text" id="sh-note2" placeholder="例：我覺得可以收，但要問吓家長"></label>
      <div class="xs faint">留低嘅係<b>意見</b>，唔係決定 —— 決定權仍然喺執委或以上。</div>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-save>留低註解</button>`
    });
    m.el.querySelector('[data-close]').onclick = m.close;
    m.el.querySelector('[data-save]').onclick = () => {
      const txt = m.el.querySelector('#sh-note2').value.trim();
      if (!txt) return toast('要填意見', 'err');
      S.commit(dd => {
        const t = (dd.shares || []).find(v => v.id === x.id);
        if (t) t.suggest = { by: S.getSession()?.name || '', text: txt, at: new Date().toISOString().slice(0, 16).replace('T', ' ') };
      });
      S.audit('分享加註解', x.title, `${S.getSession()?.name}：${txt}`);
      m.close(); toast('已交畀團長／執委', 'ok'); go('shares?tab=inbox');
    };
  }));
  el.querySelectorAll('[data-ok]').forEach(b => b.addEventListener('click', () => doDecide(b.dataset.ok, 'accepted')));
  el.querySelectorAll('[data-no]').forEach(b => b.addEventListener('click', () => doDecide(b.dataset.no, 'declined')));
  el.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', () => doDecide(b.dataset.revoke, 'withdrawn')));
  el.querySelectorAll('[data-pull]').forEach(b => b.addEventListener('click', () => doDecide(b.dataset.pull, 'withdrawn')));

  el.querySelector('#sh-new')?.addEventListener('click', () => {   // 種類：通告／活動（行事曆）兩樣
    const targets = S.myBranches().filter(b => b.id !== myBid);
    const m = modal({
      title: '發起分享', body: `
      <div class="xs faint mb-12">發出之後：<b>對方接收先會出現</b>；對方可以退回（會通知你）。</div>
      <label class="f"><span class="lb">種類</span><select id="sh-kind">${SHARE_KINDS.map(k => `<option value="${k.id}">${esc(k.label)} → 出現喺${esc(k.to)}</option>`).join('')}</select></label>
      <label class="f"><span class="lb">內容</span><input type="text" id="sh-title" placeholder="例：營幕 ×4（可外借）"></label>
      <div class="grid g2">
        <label class="f"><span class="lb">去邊個支部</span><select id="sh-to"><option value="all">全旅（所有支部）</option>${targets.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></label>
        <label class="f"><span class="lb">可見等級</span><select id="sh-level">${[0, 1, 2, 3, 4].map(n => `<option value="${n}" ${n === 2 ? 'selected' : ''}>${n} · ${esc(visName(n))}</option>`).join('')}</select></label>
      </div>
      <label class="f"><span class="lb">備註（對方會見到）</span><input type="text" id="sh-note" placeholder="例：想邀請一齊行／9 至 11 月可借"></label>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-save>送出分享</button>`
    });
    m.el.querySelector('[data-close]').onclick = m.close;
    m.el.querySelector('[data-save]').onclick = () => {
      const title = m.el.querySelector('#sh-title').value.trim();
      if (!title) return toast('要填內容', 'err');
      S.addShare({
        kind: m.el.querySelector('#sh-kind').value, title,
        from: myBid || 'troop', to: m.el.querySelector('#sh-to').value,
        level: Number(m.el.querySelector('#sh-level').value), note: m.el.querySelector('#sh-note').value.trim()
      });
      S.audit('發出分享', title, `去 ${S.branchName(m.el.querySelector('#sh-to').value)}`);
      m.close(); toast('已送出 —— 等對方接收', 'ok'); go('shares?tab=sent');
    };
  });
}

# ---- registry：求救 meta 幫手 ----
p = 'assets/js/lib/registry.js'
s = open(p).read()
old = """/* ============================================================
   ★ 分享種類：只做兩樣"""
new = """/** 求救類型 meta */
export const rescueKindMeta = id => RESCUE.kinds.find(k => k.id === id) || RESCUE.kinds[RESCUE.kinds.length - 1];
/** ADMIN 處理動作 meta */
export const rescueMeta = id => RESCUE.actions.find(a => a.id === id) || { id: '', label: '' };

/* ============================================================
   ★ 分享種類：只做兩樣"""
assert old in s
s = s.replace(old, new, 1)
open(p, 'w').write(s)
print('registry meta OK')

# ---- pending.js：求救 tab + 處理 ----
p = 'assets/js/views/pending.js'
s = open(p).read()


def rep(old, new):
    global s
    assert old in s, 'MISS: ' + old[:80]
    s = s.replace(old, new, 1)


rep("""import { esc, icon, fmtDate, toast, promptDlg } from '../lib/util.js';""",
"""import { esc, icon, fmtDate, toast, promptDlg } from '../lib/util.js';
import { RESCUE, rescueKindMeta } from '../lib/registry.js';""")

rep("""  { id: 'transfer', label: '移交接收' }
];""",
"""  { id: 'transfer', label: '移交接收' },
  { id: 'rescue', label: '🆘 求救' }
];""")

rep("""  d.inventory.forEach(i => (i.loans || []).filter(l => l.state === 'pending').forEach(l => items.push({
    kind: 'loan', at: l.at, name: `${i.name} ×${l.qty}`, sub: `${S.branchName(l.to)} 借用（負責人 ${l.by}）`,
    need: '物主批核', state: 'pending', id: i.id, src: 'loan'
  })));""",
"""  d.inventory.forEach(i => (i.loans || []).filter(l => l.state === 'pending').forEach(l => items.push({
    kind: 'loan', at: l.at, name: `${i.name} ×${l.qty}`, sub: `${S.branchName(l.to)} 借用（負責人 ${l.by}）`,
    need: '物主批核', state: 'pending', id: i.id, src: 'loan'
  })));
  /* 🆘 求救（免登入送嚟）：ADMIN 人手核實身份先做，唔會自動開任何嘢 */
  (d.rescues || []).filter(r => r.state !== 'done').forEach(r => items.push({
    kind: 'rescue', at: r.at, name: `${r.by}${r.branchId ? `（${S.branchName(r.branchId)}）` : ''}`,
    sub: `🆘 ${rescueKindMeta(r.kind).label}：${r.note || '—'}　聯絡：${r.contact}`,
    need: 'ADMIN 人手核實身份後處理', state: 'pending', id: r.id, src: 'rescue'
  }));""")

rep("""    ${stat({ k: '跨團／移交', v: counts('helper') + counts('transfer'), u: '項' })}
  </div>""",
"""    ${stat({ k: '跨團／移交', v: counts('helper') + counts('transfer'), u: '項' })}
    ${stat({ k: '🆘 求救', v: counts('rescue'), u: '單', tone: counts('rescue') ? 'warn' : 'ok', hint: '免登入送得；要人手核實身份先做' })}
  </div>
  ${counts('rescue') ? notice(`🆘 有 <b>${counts('rescue')}</b> 張求救單等你：處理＝<b>開返支部系統登入</b>／<b>重設密碼</b>／<b>答覆並結案</b>（全部人手做、逐單留紀錄）。求救唔會自動開任何嘢。`, 'warn') : ''}""")

rep("""          `<b>${esc(i.name)}</b><div class="xs faint">${esc({ account: '開戶申請', member: '成員申請', helper: '跨團幫手', publish: '公開上報', finance: '財務', transfer: '移交', loan: '物資借用' }[i.kind] || i.kind)}</div>`,""",
"""          `<b>${esc(i.name)}</b><div class="xs faint">${esc({ account: '開戶申請', member: '成員申請', helper: '跨團幫手', publish: '公開上報', finance: '財務', transfer: '移交', loan: '物資借用', rescue: '🆘 求救（免登入）' }[i.kind] || i.kind)}</div>`,""")

rep("""          `<div class="btn-row">
            <button class="btn xs primary" data-act="approve" data-id="${i.id}" data-src="${i.src}">批准</button>
            <button class="btn xs danger" data-act="reject" data-id="${i.id}" data-src="${i.src}">拒絕</button>
            ${i.src === 'finance' ? `<button class="btn xs" data-act="ask" data-id="${i.id}">退問</button>` : ''}
          </div>`""",
"""          `<div class="btn-row">
            ${i.src === 'rescue' ? `
              <button class="btn xs primary" data-act="open-gate" data-id="${i.id}" data-src="rescue">開返支部系統登入</button>
              <button class="btn xs" data-act="reset-pw" data-id="${i.id}" data-src="rescue">重設密碼</button>
              <button class="btn xs" data-act="reply" data-id="${i.id}" data-src="rescue">答覆並結案</button>`
            : `
            <button class="btn xs primary" data-act="approve" data-id="${i.id}" data-src="${i.src}">批准</button>
            <button class="btn xs danger" data-act="reject" data-id="${i.id}" data-src="${i.src}">拒絕</button>
            ${i.src === 'finance' ? `<button class="btn xs" data-act="ask" data-id="${i.id}">退問</button>` : ''}`}
          </div>`""")

rep("""async function act(what, id, src) {
  const d = S.load();""",
"""async function act(what, id, src) {
  const d = S.load();
  /* 🆘 求救：三個動作都係人手做，做完留紀錄（同支部頁共用 store 函式） */
  if (src === 'rescue') {
    const r = S.rescueById(id);
    if (!r) return;
    const bName = r.branchId ? S.branchName(r.branchId) : '（未指明支部）';
    if (what === 'open-gate') {
      const ok = await confirmDlg2({
        title: `開返「支部系統自己登入」· ${bName}`,
        message: `求救：<b>${esc(r.by)}</b>（${esc(r.contact)}）· ${esc(rescueKindMeta(r.kind).label)}<br><div class="xs faint">${esc(r.note || '')}</div><br>會發 <span class="mono">sig setGate gate=open</span>。<div class="xs faint mt-8">身份要自己核實（求救單冇驗身份）。</div>`,
        ok: '開返'
      });
      if (!ok) return;
      const res = S.resolveRescue(id, { action: 'open-gate' });
      if (!res.ok) { toast(res.msg, 'err', '', null, 6000); return; }
      S.audit('求救處理：開返支部系統登入', bName, `求救單 ${id} · ${r.by}`, 'sig');
      toast('已開返：下游回 confirmed', 'ok', '', null, 5000);
    } else if (what === 'reset-pw') {
      const acc = await promptDlg({ title: `重設密碼 · ${bName}`, label: '帳號（email 或 YMIS）', hint: '成員戶真模式要該團團長執行（帳號住該團）' });
      if (!acc) return;
      const res = S.resolveRescue(id, { action: 'reset-pw', account: acc });
      if (!res.ok) { toast(res.msg, 'err', '', null, 6000); return; }
      S.audit('求救處理：重設密碼', acc, `求救單 ${id} · 臨時密碼已發（首登強制改）`, 'UI');
      toast(`已重設：臨時密碼 ${res.tempPw}（示範）—— 首登強制改；記得核實身份先講`, 'ok', '', null, 7000);
    } else {
      const reply = await promptDlg({ title: `答覆 · ${bName}`, label: '答覆內容（求救紀錄會留住）' });
      if (!reply) return;
      const res = S.resolveRescue(id, { action: 'reply', reply });
      if (!res.ok) { toast(res.msg, 'err'); return; }
      S.audit('求救處理：答覆結案', bName, `求救單 ${id}；回覆：${reply}`, 'UI');
      toast('已答覆並結案', 'ok');
    }
    go('pending?kind=rescue');
    return;
  }""")

rep("""import { RESCUE, rescueKindMeta } from '../lib/registry.js';""",
"""import { RESCUE, rescueKindMeta } from '../lib/registry.js';
import { confirmDlg as confirmDlg2 } from '../lib/util.js';""")

open(p, 'w').write(s)
print('pending OK')

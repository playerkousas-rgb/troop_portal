p = 'assets/js/views/branches.js'
s = open(p).read()


def rep(old, new):
    global s
    assert old in s, 'MISS: ' + old[:80]
    s = s.replace(old, new, 1)


rep("""import { can, moduleEnabled, shareableTargets, visName, moduleList, GATE_STATES, gateOfLink, gateMeta, GATE_ESCAPE } from '../lib/registry.js';""",
"""import { can, moduleEnabled, shareableTargets, visName, moduleList, GATE_STATES, gateOfLink, gateMeta, RESCUE, rescueMeta, rescueKindMeta } from '../lib/registry.js';""")

# ---- 換走成個逃生門區塊（由「★ 防死鎖：逃生門（單向）」卡起，至逃生門用過之後／其他卡為止）----
start = s.find("    ${(() => {\n      const gate = gateOfLink(b.link);\n      const escRec")
end = s.find("    ${card({ title: '接駁測試與診斷'")
assert start != -1 and end != -1 and start < end

new_block = """    ${(() => {
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
        ${open.length ? `<div class="grid g3 mt-12">
          ${stat({ k: '待處理', v: open.length, u: '單', tone: 'warn' })}
          ${stat({ k: '最新', v: open[0].by, hint: open[0].at })}
          ${stat({ k: '類型', v: rescueKindMeta(open[0].kind).label, tone: 'n' })}
        </div>` : ''}
        ${table({
          cls: 'tbl compact', head: ['時間', '邊個', '類型', '內容', '狀態', 'ADMIN 動作'],
          rows: mine.map(r => ({
            cells: [
              `<span class="xs">${esc(r.at)}</span>`,
              `${esc(r.by)}<div class="xs faint">${esc(r.contact)}</div>`,
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
"""
s = s[:start] + new_block + s[end:]

# 「支部系統登入通道」卡：尾註改寫（唔再提逃生門鑰匙）
rep("""        <div class="xs faint mt-4">★ 平台超管唔受呢個掣影響（驗身唔經下游登記）；本地領袖戶／SUPER 本地戶就一樣 <span class="mono">403</span>。</div>""",
"""        <div class="xs faint mt-4">★ 有冇人入唔到？佢哋撳「🆘 求救」就送到嚟呢度（免登入）；閂之前唔使登記任何匙。★ 平台超管唔受呢個掣影響（驗身唔經下游登記）；本地領袖戶／SUPER 本地戶就一樣 <span class="mono">403</span>。</div>""")

# 閂之前嘅確認文案：由逃生門鑰匙 → 求救制
rep("""  /* 冇登記逃生門鑰匙 ＝ 冇離線退路，要旅長親手打一句先過（用戶定案 2026-09-25） */
  const needKey = gate === 'sig-only' && !S.escOwner(id);
  const typed = needKey ? GATE_ESCAPE.rules.noKeyTyping : '';
  const msg = needKey
    ? `${copy.msg}<div class="err mt-12"><b>⚠ 呢個下游未登記「逃生門鑰匙」</b> —— 即係冇寫明邊個係該團 Sheet／Apps Script 專案擁有者。<br>萬一旅側控制面壞（GAS／Vercel／密鑰／人），呢個團就<b>冇人自動救得返</b>（要臨時去搵擁有者嗰個 Google 帳號）。</div>`
    : copy.msg;
  if (await confirmDlg({ title: copy.title, message: msg, ok: copy.ok, danger: copy.danger, requireTyping: typed })) await applyGate(id, gate);""",
"""  const msg = copy.msg + (gate === 'sig-only'
    ? `<div class="mt-12 xs faint">有人入唔到：叫佢撳 <b>🆘 求救</b>（${RESCUE.entry}&b=${id}，免登入）—— 求救單會出現喺呢一頁同「待辦與批核」，你撳一下「開返支部系統登入」就搞返。</div>`
    : '');
  if (await confirmDlg({ title: copy.title, message: msg, ok: copy.ok, danger: copy.danger })) await applyGate(id, gate);""")

# 求救 handler + 求救連結複製（放喺 ping/ gate handlers 附近）
rep("""  el.querySelector('[data-copy-esc]')?.addEventListener('click', () => { copyText(escStepsText()); toast('已複製逃生門步驟（可以直接貼去團長群）', 'ok', '', null, 5000); });""",
"""  el.querySelector('[data-copy-rescue]')?.addEventListener('click', () => {
    copyText(location.origin + '/index.html?step=rescue&b=' + b.id);
    toast('已複製求救連結（貼去團長群／支部系統 403 頁都用得）', 'ok', '', null, 5000);
  });
  el.querySelectorAll('[data-rescue]').forEach(x => x.addEventListener('click', () => handleRescue(x.dataset.rescue, x.dataset.rAct)));""")

rep("""/* ★ 逃生門（防死鎖）：旅側只係「知悉／登記鑰匙」—— 開返嘅動作本身喺下游 Sheet 級做；
   ⚠ 偵測到本地解鎖只提示，唔會自動改記錄、亦唔會自動再閂（用戶定案 2026-09-25） */
const escStepsText = () => GATE_ESCAPE.steps.map((s2, i) => `${i + 1}. ${s2}`).join('\\n');

""",
"""/* 🆘 求救：ADMIN 處理（開返閘／重設密碼／答覆結案）—— 全部人手做，逐單留紀錄 */
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

""")

open(p, 'w').write(s)
print('branches OK')

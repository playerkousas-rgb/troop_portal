/* 行事曆 — 旅一個、每支部一個（各自一色），可勾選、按標籤過濾、匯出 ICS */
import { esc, icon, fmtDate, fmtDateFull, iso, parseISO, DOW, todayISO, toast, downloadFile } from '../lib/util.js';
import * as S from '../lib/store.js';
import { go } from '../lib/router.js';
import { page, card, table, badge, notice, toolbar, modal, stat } from './ui.js';
import { can } from '../lib/registry.js';

export function render(el, params, query = {}) {
  const d = S.load();
  const role = S.getSession()?.role;
  const month = query.m || todayISO().slice(0, 7);
  const on = (query.on ? query.on.split(',') : ['troop', ...d.branches.filter(b => S.canSeeBranch(b)).map(b => b.id)]).filter(Boolean);
  const events = S.calendarForViewer().filter(e => on.includes(e.cal));
  /* ★ 已接收嘅活動分享（收件方接收咗先會出現） */
  const sharedEv = S.acceptedShares(S.myBranchId(), 'event').filter(x => x.from !== S.myBranchId());
  const sharedRows = sharedEv.map(x => ({
    date: x.date || x.at.slice(0, 10), title: x.title,
    cal: x.from, time: x.time || '', place: x.place || '', shared: true
  }));
  /* 分享活動要落喺活動本身嘅日期；示範資料冇逐條日期就用發出日 */
  const sharedOn = (date) => sharedRows.filter(r => r.date === date);
  const monthShared = sharedRows.filter(r => r.date.startsWith(month)).length;
  const [y, mm] = month.split('-').map(Number);
  const first = new Date(y, mm - 1, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(y, mm, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push({ out: true, date: iso(new Date(y, mm - 1, i - startDow + 1)) });
  for (let dd = 1; dd <= daysInMonth; dd++) cells.push({ date: `${month}-${String(dd).padStart(2, '0')}` });
  while (cells.length % 7) cells.push({ out: true, date: iso(new Date(y, mm - 1, daysInMonth + (cells.length % 7))) });

  const body = `
  ${toolbar(`
    <button class="btn sm" data-m="${prevMonth(month)}">${icon('arrowL', 14)}</button>
    <b class="lg">${y} 年 ${mm} 月</b>
    <button class="btn sm" data-m="${nextMonth(month)}">${icon('arrowR', 14)}</button>
    <button class="btn sm" data-m="${todayISO().slice(0, 7)}">今個月</button>
    <span class="grow"></span>
    ${can(role, 'calendar_edit') ? `<button class="btn sm primary" id="cal-new">${icon('plus', 14)} 加活動</button>` : ''}
    <button class="btn sm" id="cal-ics">${icon('download', 14)} 匯出 ICS</button>
    <button class="btn sm" id="cal-subs">${icon('bell', 14)} 訂閱日曆</button>
  `)}
  ${card({ body: `
    <div class="vis-legend mb-12">
      ${d.branches.map(b => `<label class="chip ${on.includes(b.id) ? 'on' : ''}" data-cal="${b.id}"><span class="swatch" style="background:${b.color}"></span> ${esc(b.name)}</label>`).join('')}
      <label class="chip ${on.includes('troop') ? 'on' : ''}" data-cal="troop"><span class="swatch" style="background:#14532d"></span> 旅</label>
    </div>
    <div class="cal">
      <div class="dow">${DOW.map(x => `<div>${x}</div>`).join('')}</div>
      <div class="grid7">
        ${cells.map(c => `<div class="cell ${c.out ? 'out' : ''} ${c.date === todayISO() ? 'today' : ''}">
          <div class="d">${parseISO(c.date)?.getDate()}</div>
          ${events.filter(e => e.date === c.date).map(e => `<div class="ev" style="background:${e.color}" data-ev="${e.id}" title="${esc(e.title)}">${esc(e.title)}</div>`).join('')}
          ${sharedOn(c.date).map(x => `<div class="ev shared" title="${esc(x.title)}（來自 ${esc(S.branchName(x.cal))}）">${icon('share', 10)} ${esc(x.title)}</div>`).join('')}
        </div>`).join('')}
      </div>
    </div>
    <div class="xs faint mt-8">每支部一個日曆、各自一色；用戶可勾選／按標籤 FILTER。成員／家長只睇得到自己支部＋旅。
      ${sharedEv.length ? `<br><span class="ev shared" style="display:inline-block">${icon('share', 10)} 分享</span> ＝ 其他支部 share 咗、你哋<b>接收咗</b>嘅活動（唔會混入你自己支部嘅顏色）。` : ''}</div>
  ` })}
  <div class="grid g2 mt-12">
    ${card({ title: `本月活動（${events.filter(e => e.date.startsWith(month)).length} 項${monthShared ? ` ＋ ${monthShared} 項分享` : ''}）`, body: table({
      cls: 'tbl compact', head: ['日期', '活動', '日曆', '時間', '地點'],
      rows: events.filter(e => e.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date)).map(e => ({
        cells: [esc(fmtDate(e.date, true)), esc(e.title), `<span class="swatch" style="background:${e.color}"></span> ${esc(S.branchName(e.cal))}`, esc(e.time || ''), esc(e.place || '')]
      })).concat(sharedRows.map(x => ({
        cells: [esc(fmtDate(x.date, true)), esc(x.title) + '<span class="tag b sm" style="margin-left:6px">分享</span>', `<span class="tag b sm">來自 ${esc(S.branchName(x.cal))}</span>`, esc(x.time || '—'), esc(x.place || '—')]
      }))), empty: '本月冇活動'
    }) })}
    ${card({ title: '標籤過濾', sub: '事件帶支部自訂標籤', body: `
      <div class="flex-w">${Array.from(new Set(S.calendarForViewer().map(e => S.branchName(e.cal)))).map(t => `<span class="chip">#${esc(t)}</span>`).join('')}</div>
      <div class="mt-12">${notice('旅日曆同支部日曆係<b>兩層</b>：支部自己出嘅活動留喺支部；旅只放旅層活動（旅露營、旅務會議、聯合服務）。★ 其他支部嘅活動要<b>你哋接收咗分享</b>先會出現（標明「來自 XX 團」）。', 'info')}</div>` })}
  </div>
  `;
  el.innerHTML = page({
    title: '行事曆',
    sub: `${d.branches.length + 1} 個日曆 · 本月 ${events.filter(e => e.date.startsWith(month)).length} 項活動${monthShared ? ` ＋ ${monthShared} 項分享` : ''}`,
    body
  });

  el.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => setQuery({ m: b.dataset.m, on: on.join(',') })));
  el.querySelectorAll('[data-cal]').forEach(c => c.addEventListener('click', () => {
    const id = c.dataset.cal;
    const next = on.includes(id) ? on.filter(x => x !== id) : [...on, id];
    setQuery({ m: month, on: next.join(',') });
  }));
  el.querySelectorAll('[data-ev]').forEach(x => x.addEventListener('click', () => {
    const e = d.calendar.find(y => y.id === x.dataset.ev);
    modal({
      title: e.title, body: kv2([
        ['日期', fmtDateFull(e.date)], ['時間', e.time || '—'], ['地點', e.place || '—'], ['日曆', S.branchName(e.cal)]
      ]),
      footer: `<button class="btn" onclick="this.closest('.mask').remove()">關閉</button>`
    });
  }));
  el.querySelector('#cal-new')?.addEventListener('click', () => openNew(el, on, month));
  el.querySelector('#cal-ics')?.addEventListener('click', () => {
    downloadFile('troop-calendar.ics', ics(events), 'text/calendar');
  });
  el.querySelector('#cal-subs')?.addEventListener('click', () => openSubscribeFeed(events));
}

function setQuery(q) {
  const p = new URLSearchParams();
  if (q.m) p.set('m', q.m);
  if (q.on) p.set('on', q.on);
  go('calendar?' + p.toString());
}
const prevMonth = m => { const [y, mm] = m.split('-').map(Number); const d = new Date(y, mm - 2, 1); return iso(d).slice(0, 7); };
const nextMonth = m => { const [y, mm] = m.split('-').map(Number); const d = new Date(y, mm, 1); return iso(d).slice(0, 7); };
const pad = n => String(n).padStart(2, '0');

/* ---------------- 訂閱日曆（.ics feed ＋ 簽名分享） ---------------- */
function openSubscribeFeed(events) {
  const base = location.origin + location.pathname.replace(/[^/]*$/, '');
  const feed = `${base}api/troop?unit=${encodeURIComponent(S.load()?.unit?.code || '0082')}&calendar=1`;
  const icsUrl = `${base}troop-calendar.ics`;
  const m = modal({
    title: '訂閱／分享日曆',
    body: `
    ${notice('訂閱＝出面嘅日曆 app（Google／Apple）自己定時嚟攞；<b>分享連結</b>＝一條過，帶簽名同到期日。兩種都<b>唔使登入</b>，亦冇任何 key 落 URL。', 'info')}
    <div class="card pad-l">
      <b class="sm">① 訂閱（feed）</b>
      <div class="mono xs mt-4" style="word-break:break-all">${esc(feed.replace(/\?.*$/, '?unit=…（真模式先有 feed；示範唔提供）'))}</div>
      <div class="xs faint mt-4">真模式：<span class="mono">/api/troop?calendar=1</span> 回 ICS（唯讀、有 cache）；Apple／Google 加「用 URL 訂閱」就長期跟住旅嘅活動。<br>示範模式：唔會發請求 —— 請用下面「匯出 ICS」。</div>
      <div class="btn-row mt-8"><button class="btn sm" data-dl>${icon('download', 13)} 即刻匯出 ICS（${events.length} 項）</button>
      <button class="btn sm" data-copy-ics>${icon('copy', 13)} 複製 .ics 檔名</button></div>
    </div>
    <div class="card pad-l mt-12">
      <b class="sm">② 分享單一活動（簽名連結，最長 90 日）</b>
      <div class="xs faint mt-4">同一條 <span class="mono">/api/share</span>：種類只開放<b>通告</b>同<b>活動</b>（Sprint 4 定案）；過期／改過一律驗唔到。</div>
      <div class="xs faint mt-4">示範模式：下面會列出會用嘅參數，唔會真發請求。</div>
      <div id="cal-share-out" class="mt-8"></div>
      <div class="btn-row mt-8"><button class="btn sm primary" data-share-ev>${icon('link', 13)} 產生活動分享連結</button></div>
    </div>`,
    footer: `<button class="btn" data-close>關閉</button>`
  });
  const out = m.el.querySelector('#cal-share-out');
  m.el.querySelector('[data-close]').onclick = m.close;
  m.el.querySelector('[data-dl]').onclick = () => downloadFile('troop-calendar.ics', ics(events), 'text/calendar');
  m.el.querySelector('[data-copy-ics]').onclick = () => copyText('troop-calendar.ics');
  m.el.querySelector('[data-share-ev]').onclick = async () => {
    const ev = events[0];
    if (!ev) { out.innerHTML = '<div class="xs faint">今個月冇活動可以分享。</div>'; return; }
    const r = await API.shareLink({ kind: 'calendar', id: ev.id, days: 30 });
    if (!r.ok && r.code === 'mock') {
      out.innerHTML = `<div class="info-box xs">示範模式：<span class="mono">/api/share {kind:'calendar', id:'${esc(ev.id)}', unit:'${esc(S.load()?.unit?.code || '')}', days:30}</span><br>真模式回 <span class="mono">/public.html?tab=calendar&amp;e=…&amp;s=&lt;簽名&gt;</span></div>`;
      return;
    }
    if (!r.ok) { out.innerHTML = `<div class="warn-box xs">產生唔到：${esc(r.msg || r.code)}（要 ADMIN 設 SHARE_SECRET／SESSION_SECRET）</div>`; return; }
    const abs = location.origin + r.data.url;
    out.innerHTML = `<div class="mono xs" style="word-break:break-all">${esc(abs)}</div>
      <div class="btn-row mt-8"><button class="btn sm" data-c>${icon('copy', 13)} 複製</button></div>
      <div class="xs faint mt-4">活動：${esc(ev.title)}；到期 ${esc(new Date(r.data.payload.exp).toLocaleDateString('zh-HK'))}</div>`;
    out.querySelector('[data-c]').onclick = () => copyText(abs);
  };
}

function ics(events) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//troop_portal//ZH-HK//', 'CALSCALE:GREGORIAN'];
  events.forEach(e => {
    const dt = String(e.date).replace(/-/g, '');
    const t = (e.time || '09:00').replace(':', '') + '00';
    lines.push('BEGIN:VEVENT', `UID:${e.id}@troop_portal`, `DTSTAMP:${dt}T${t}Z`, `DTSTART:${dt}T${t}`, `SUMMARY:${e.title}`, `LOCATION:${e.place || ''}`, `DESCRIPTION:${S.branchName(e.cal)}`, 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
function kv2(pairs) { return `<dl class="kv">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`; }

function openNew(el, on, month) {
  const d = S.load();
  const my = S.myBranches();
  const m = modal({
    title: '加活動',
    body: `
    <label class="f"><span class="lb">活動名</span><input type="text" id="ce-title" placeholder="例：旅務委員會會議"></label>
    <div class="grid g2">
      <label class="f"><span class="lb">放喺邊個日曆</span><select id="ce-cal">
        ${(S.getSession()?.role === 'chief' ? [`<option value="troop">旅日曆</option>`] : []).join('')}
        ${my.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}
      </select></label>
      <label class="f"><span class="lb">日期</span><input type="date" id="ce-date" value="${month}-15"></label>
    </div>
    <div class="grid g3">
      <label class="f"><span class="lb">時間</span><input type="time" id="ce-time" value="19:30"></label>
      <label class="f"><span class="lb">地點</span><input type="text" id="ce-place" placeholder="旅部"></label>
      <label class="f"><span class="lb">顏色</span><input type="color" id="ce-color" value="#14532d"></label>
    </div>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn primary" data-save>${icon('check', 14)} 加落日曆</button>`
  });
  m.el.querySelector('[data-close]').onclick = m.close;
  m.el.querySelector('[data-save]').onclick = () => {
    const title = m.el.querySelector('#ce-title').value.trim();
    if (!title) return toast('要填活動名', 'err');
    const cal = m.el.querySelector('#ce-cal').value;
    S.commit(dd => {
      dd.calendar.push({
        id: 'c-' + Date.now(), cal, title,
        date: m.el.querySelector('#ce-date').value,
        time: m.el.querySelector('#ce-time').value,
        place: m.el.querySelector('#ce-place').value.trim(),
        color: m.el.querySelector('#ce-color').value
      });
    });
    S.audit('加活動', title, S.branchName(cal));
    m.close();
    toast('已加入日曆（記得撳「儲存到後端」）', 'ok');
    setQuery({ m: month, on: on.join(',') });
  };
}

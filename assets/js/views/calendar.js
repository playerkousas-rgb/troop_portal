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

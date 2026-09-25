/* ============================================================
   views/ui.js — 共用畫面元件（卡片、統計、表格、工具列、分頁）
   ============================================================ */
import { esc, icon, money, stateDot } from '../lib/util.js';

/* 對外通行：所有 view 一律由 ui.js 拎畫面元件（modal 等由 util re-export，方便統一） */
export { modal, confirmDlg, promptDlg, toast } from '../lib/util.js';

export function page({ title, sub = '', actions = '', body = '', back = '', wide = false }) {
  return `<div class="page ${wide ? 'wide' : ''}">
    <div class="flex-b mb-12">
      <div>
        <div class="flex" style="gap:6px">
          ${back ? `<a class="btn xs ghost" href="#/${back}">${icon('arrowL', 14)} 返回</a>` : ''}
          <h1 class="mt-0 mb-0">${esc(title)}</h1>
        </div>
        ${sub ? `<div class="card-sub mt-4">${sub}</div>` : ''}
      </div>
      <div class="btn-row no-print">${actions}</div>
    </div>
    ${body}
  </div>`;
}

export function card({ title = '', sub = '', actions = '', body = '', cls = '', id = '' }) {
  return `<section class="card ${cls}" ${id ? `id="${id}"` : ''}>
    ${(title || actions) ? `<div class="card-h">
      <div><h3 class="mb-0">${title}</h3>${sub ? `<div class="card-sub">${sub}</div>` : ''}</div>
      <div class="btn-row">${actions}</div>
    </div>` : ''}
    ${body}
  </section>`;
}

export function stat({ k, v, u = '', tone = '', hint = '' }) {
  return `<div class="stat ${tone}">
    <div class="k">${esc(k)}</div>
    <div class="v">${v}${u ? ` <span class="u">${esc(u)}</span>` : ''}</div>
    ${hint ? `<div class="u">${hint}</div>` : ''}
  </div>`;
}

export function badge(text, tone = 'n', small = false) {
  return `<span class="tag ${tone} ${small ? 'sm' : ''}">${esc(text)}</span>`;
}

export function linkBadge(state, text) {
  const tone = { green: 'g', yellow: 'y', red: 'r' }[state] || 'n';
  const label = text || { green: '已接駁', yellow: '已登記 · 未閂口', red: '未接駁' }[state] || '—';
  return `<span class="tag ${tone}">${icon(state === 'green' ? 'check' : state === 'yellow' ? 'warn' : 'x', 12)} ${esc(label)}</span>`;
}

export function table({ head = [], rows = [], cls = 'tbl', empty = '冇資料' }) {
  if (!rows.length) return `<div class="empty">${esc(empty)}</div>`;
  return `<div class="tbl-wrap"><table class="${cls}">
    <thead><tr>${head.map(h => `<th class="${h.num ? 'num' : ''}">${h.html || esc(h.label ?? h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr class="${r.cls || ''}">${(r.cells || r).map(c => {
      if (typeof c === 'string') return `<td>${c}</td>`;
      return `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.html ?? esc(c.text ?? '')}</td>`;
    }).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

export function kv(pairs) {
  return `<dl class="kv">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

export function empty(text, action = '') {
  return `<div class="empty">${esc(text)}${action ? `<div class="mt-8">${action}</div>` : ''}</div>`;
}

export function notice(msg, tone = 'info') {
  const cls = { info: 'info-box', ok: 'ok-box', warn: 'warn-box', err: 'err' }[tone] || 'info-box';
  return `<div class="${cls}"><div class="flex" style="gap:8px;align-items:flex-start">
    <span style="line-height:1.4">${icon(tone === 'ok' ? 'check' : tone === 'warn' ? 'warn' : 'info', 15)}</span>
    <div class="grow">${msg}</div></div></div>`;
}

export function moneyCell(n) { return `<span class="${Number(n) < 0 ? '' : ''}">${money(n)}</span>`; }

export function progressBar(pct, label = '') {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return `<div class="progress-line"><div class="bar-track"><div class="bar-fill" style="width:${p}%"></div></div><span class="nowrap xs faint">${esc(label || p + '%')}</span></div>`;
}

export function toolbar(inner) { return `<div class="flex-w mb-12 no-print">${inner}</div>`; }
export function searchBox(id, placeholder = '搜尋…') {
  return `<label class="flex" style="gap:6px">${icon('search', 15)}<input type="text" id="${id}" placeholder="${esc(placeholder)}" style="min-width:220px"></label>`;
}
export function selectBox(id, options, value = '') {
  return `<select id="${id}">${options.map(o => {
    const v = typeof o === 'string' ? o : o.v, l = typeof o === 'string' ? o : o.l;
    return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`;
  }).join('')}</select>`;
}
export function tabs(items, active) {
  return `<div class="tabs">${items.map(t => `<button class="${t.id === active ? 'on' : ''}" data-tab="${t.id}">${esc(t.label)}${t.badge ? ` <span class="tag gold sm">${esc(t.badge)}</span>` : ''}</button>`).join('')}</div>`;
}

export function saveBar({ label = '儲存到後端', hint = '', count = 0, dirty = false }) {
  return `<div class="actions-bar no-print">
    <span class="xs faint grow">${hint || '★ 鐵律：寫入後端只有一個掣；其他改動只暫存喺呢部機'}</span>
    <button class="btn primary" id="save-backend" ${dirty ? '' : 'disabled'}>${icon('upload', 15)} ${esc(label)}${count ? `（${count}）` : ''}</button>
  </div>`;
}

export function head(a, n = 1) { return `<div class="section-title"><h${n + 1}>${a}</h${n + 1}><div class="rule"></div></div>`; }

export function lightBar(items) {
  return `<div class="lights">${items.map(i => `<span class="l">${stateDot(i.state)} <span>${esc(i.label)}</span></span>`).join('')}</div>`;
}

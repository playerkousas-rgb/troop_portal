/* ============================================================
   util.js — 共用工具（DOM、提示、對話框、QR、格式、日期）
   ============================================================ */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export const attr = v => esc(v);

export function uid(prefix = 'id') {
  return prefix + '-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}
export const deepClone = o => JSON.parse(JSON.stringify(o));
export const sortBy = (arr, key, dir = 1) => arr.slice().sort((a, b) => {
  const x = a?.[key], y = b?.[key];
  if (x === y) return 0;
  return (x > y ? 1 : -1) * dir;
});
export function groupBy(arr, key) {
  return arr.reduce((m, it) => { const k = it[key] ?? ''; (m[k] = m[k] || []).push(it); return m; }, {});
}
export function sum(arr, key) { return arr.reduce((s, it) => s + Number(it?.[key] || 0), 0); }
export function uniq(arr) { return Array.from(new Set(arr)); }

/* ---------- 格式 ---------- */
export const money = n => '$' + Number(n || 0).toLocaleString('en-HK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
export const money2 = n => '$' + Number(n || 0).toLocaleString('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pct = n => Math.round(Number(n || 0) * 100) + '%';
export const num = n => Number(n || 0).toLocaleString('en-HK');

/* ---------- 日期 ---------- */
export function iso(d = new Date()) {
  const x = (d instanceof Date) ? d : new Date(d);
  if (isNaN(x)) return '';
  const p = n => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}
export const todayISO = () => iso(new Date());
export function parseISO(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
export function addDays(s, n) {
  const d = parseISO(s) || new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
}
export function daysBetween(a, b) {
  const x = parseISO(a), y = parseISO(b);
  if (!x || !y) return 0;
  return Math.round((y - x) / 86400000);
}
export const DOW = ['日', '一', '二', '三', '四', '五', '六'];
export function fmtDate(s, withDow = false) {
  const d = parseISO(s);
  if (!d) return s || '';
  const base = `${d.getMonth() + 1}/${d.getDate()}`;
  return withDow ? `${base}（${DOW[d.getDay()]}）` : base;
}
export function fmtDateFull(s) {
  const d = parseISO(s);
  if (!d) return s || '';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${DOW[d.getDay()]}）`;
}
export function fmtStamp(ts) {
  const d = new Date(Number(ts) || Date.now());
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function relTime(ts) {
  const diff = Date.now() - Number(ts || 0);
  const m = Math.round(diff / 60000);
  if (m < 1) return '剛剛';
  if (m < 60) return m + ' 分鐘前';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' 小時前';
  const d = Math.round(h / 24);
  if (d < 30) return d + ' 日前';
  return fmtStamp(ts).slice(0, 10);
}
/** 財政年度（旅年度：8 月最後一個星期六 AGM → 翌年；童軍年度 4/1–3/31） */
export function fyOf(dateISO) {
  const d = parseISO(dateISO) || new Date();
  const scoutY = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  return { scout: `${scoutY}/${String((scoutY + 1) % 100).padStart(2, '0')}`, agm: d.getMonth() + 1 >= 8 ? d.getFullYear() : d.getFullYear() - 1 };
}

/* ---------- 圖示（inline SVG，零依賴） ---------- */
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z',
  share: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 3v12M8 7l4-4 4 4',
  calendar: 'M4 6h16v14H4zM8 3v4M16 3v4M4 10h16',
  megaphone: 'M3 11v3l12 5V6L3 11zM15 8a4 4 0 0 1 0 8',
  branch: 'M12 3v5M12 12v3M6 21v-4M18 21v-4M12 15a6 6 0 0 0-6 6M12 15a6 6 0 0 1 6 6M12 8a3 3 0 1 0 0-5 3 3 0 0 0 0 5z',
  wallet: 'M3 7h18v12H3zM3 7l3-3h12l3 3M16 13h3',
  box: 'M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10',
  users: 'M8 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 21c0-3.3 2.7-6 6-6s6 2.7 6 6M17 11a3 3 0 1 0 0-6M16 15c3 0 5 2 5 6',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18',
  book: 'M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-3a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h4z',
  shield: 'M12 3l8 3v6c0 5-3.4 8.3-8 9.9C7.4 20.3 4 17 4 12V6z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  doc: 'M6 3h8l4 4v14H6zM14 3v5h4',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l4 2',
  check: 'M4 12.5 9 18 20 6',
  x: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6',
  link: 'M10 14a4 4 0 0 1 0-6l2-2a4 4 0 0 1 6 6l-1 1M14 10a4 4 0 0 1 0 6l-2 2a4 4 0 0 1-6-6l1-1',
  download: 'M12 4v10m0 0 4-4m-4 4-4-4M5 19h14',
  print: 'M7 9V3h10v6M5 9h14v7h-3M8 16H5v5h14v-5h-3M8 21v-6h8v6',
  key: 'M14 10a4 4 0 1 0-3.5 4l1.5-1.5h2v-2h2v-2h-2zM3 21l5-5',
  lock: 'M6 11h12v10H6zM9 11V7a3 3 0 0 1 6 0v4',
  unlock: 'M6 11h12v10H6zM9 11V7a3 3 0 0 1 6 0',
  power: 'M12 3v9M7.5 6.2a7 7 0 1 0 9 0',
  eye: 'M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  warn: 'M12 3l9 17H3zM12 9v5M12 17h.01',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5 21 21',
  edit: 'M4 20h4l10-10-4-4L4 16z M14 6l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
  arrowR: 'M5 12h14M13 6l6 6-6 6',
  arrowL: 'M19 12H5M11 6l-6 6 6 6',
  chevD: 'M6 9l6 6 6-6',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM16 16h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8h.01M11 12h1v5h1',
  flag: 'M6 3v18M6 4h12l-2 4 2 4H6',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  upload: 'M12 20V10m0 0 4 4m-4-4-4 4M5 5h14',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h9',
  menu: 'M4 7h16M4 12h16M4 17h16',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12l2-1-2-4-2 1-2-1-1-2h-4l-1 2-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1 1 2h4l1-2 2-1 2 1 2-4-2-1z',
  clip: 'M8 12V7a4 4 0 0 1 8 0v10a3 3 0 0 1-6 0V8',
  wrench: 'M14.5 6a4 4 0 1 0 3.5 6.9L21 16v2l-2 2h-2l-3.4-3.4A4 4 0 0 1 6 14.5L3 11.5 6 8.5l3 3a4 4 0 0 1 5.5-5.5z',
  child: 'M12 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 21v-6l-2-3 3-3h6l3 3-2 3v6',
  bell: 'M6 16V10a6 6 0 0 1 12 0v6l2 3H4zM10 22h4',
  filter: 'M3 5h18l-7 8v6l-4-2v-4z',
  table: 'M3 5h18v14H3zM3 10h18M9 10v9',
  star: 'M12 3l2.9 6 6.1.9-4.5 4.3 1.1 6.1L12 17.5 6.4 20.3l1.1-6.1L3 9.9 9.1 9z',
  heart: 'M12 20s-7-4.3-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.7-7 9-7 9z',
  ball: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.5 9h17M3.5 15h17M12 3c3 4 3 14 0 18M12 3c-3 4-3 14 0 18'
};
export function icon(name, size = 16, cls = '') {
  const d = ICONS[name] || ICONS.info;
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

/* ---------- Toast ---------- */
export function toast(msg, kind = '', actionLabel = '', onAction = null, ms = 3600) {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (actionLabel && onAction) {
    const b = document.createElement('button');
    b.textContent = actionLabel;
    b.onclick = () => { try { onAction(); } finally { el.remove(); } };
    el.appendChild(b);
  }
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
  return el;
}

/* ---------- 對話框 ---------- */
export function modal({ title = '', body = '', footer = '', wide = false, onMount = null } = {}) {
  const mask = document.createElement('div');
  mask.className = 'mask';
  mask.innerHTML = `<div class="dlg ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <header><h3>${esc(title)}</h3><button class="x" aria-label="關閉">×</button></header>
    <div class="body">${body}</div>
    ${footer ? `<footer>${footer}</footer>` : ''}
  </div>`;
  const close = () => { mask.remove(); document.removeEventListener('keydown', onKey); };
  function onKey(e) { if (e.key === 'Escape') close(); }
  mask.addEventListener('click', e => { if (e.target === mask) close(); });
  mask.querySelector('.x').onclick = close;
  document.body.appendChild(mask);
  document.addEventListener('keydown', onKey);
  if (onMount) onMount(mask.querySelector('.dlg'), close);
  return { el: mask.querySelector('.dlg'), close };
}

export function confirmDlg({ title = '確認', message = '', ok = '確定', cancel = '取消', danger = false, requireTyping = '' } = {}) {
  return new Promise(resolve => {
    const need = requireTyping ? `<label class="f mt-12"><span class="lb">請輸入「${esc(requireTyping)}」以確認</span><input type="text" id="cf-typing" autocomplete="off"></label>` : '';
    const m = modal({
      title,
      body: `<div class="${danger ? 'err' : ''}">${message}</div>${need}`,
      footer: `<button class="btn" data-no>${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes ${requireTyping ? 'disabled' : ''}>${esc(ok)}</button>`
    });
    const yes = m.el.querySelector('[data-yes]');
    const typing = m.el.querySelector('#cf-typing');
    if (typing) {
      typing.oninput = () => { yes.disabled = typing.value.trim() !== requireTyping; };
      typing.focus();
    }
    m.el.querySelector('[data-no]').onclick = () => { m.close(); resolve(false); };
    yes.onclick = () => { m.close(); resolve(true); };
    m.el.querySelector('.x').onclick = () => { m.close(); resolve(false); };
  });
}

export function promptDlg({ title = '輸入', label = '', value = '', ok = '確定', type = 'text', placeholder = '', hint = '' } = {}) {
  return new Promise(resolve => {
    const m = modal({
      title,
      body: `<label class="f"><span class="lb">${esc(label)}</span><input type="${type}" id="pd-v" value="${attr(value)}" placeholder="${attr(placeholder)}">${hint ? `<div class="hint">${hint}</div>` : ''}</label>`,
      footer: `<button class="btn" data-no>取消</button><button class="btn primary" data-yes>${esc(ok)}</button>`
    });
    const input = m.el.querySelector('#pd-v');
    input.focus(); input.select();
    const done = () => { const v = input.value.trim(); m.close(); resolve(v || null); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') done(); });
    m.el.querySelector('[data-no]').onclick = () => { m.close(); resolve(null); };
    m.el.querySelector('[data-yes]').onclick = done;
    m.el.querySelector('.x').onclick = () => { m.close(); resolve(null); };
  });
}

/* ---------- QR／複製／下載 ---------- */
export function qrSvg(text, cell = 3, margin = 2) {
  try {
    if (typeof window.qrcode !== 'function') return '<div class="faint sm">QR 模組未載入</div>';
    const q = window.qrcode(0, 'M');
    q.addData(String(text), 'Byte');
    q.make();
    return q.createSvgTag({ cellSize: cell, margin, scalable: true });
  } catch (e) {
    return '<div class="faint sm">QR 產生失敗</div>';
  }
}
export async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
    toast('已複製', 'ok');
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('已複製', 'ok'); return true; }
    catch (e2) { toast('複製失敗，請人手選取', 'err'); return false; }
    finally { ta.remove(); }
  }
}
export function downloadFile(name, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('已下載 ' + name, 'ok');
}
export function toCSV(rows) {
  const cell = v => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '\ufeff' + rows.map(r => r.map(cell).join(',')).join('\r\n');
}
/** 防儲存格算式注入（上游標籤先消毒，只留 0-9A-Za-z_.@-） */
export const sanitizeLabel = v => String(v == null ? '' : v).replace(/[^0-9A-Za-z_.@-]/g, '').slice(0, 64);

/* ---------- 其他 ---------- */
export function normId(v) {
  let s = String(v == null ? '' : v).trim().toUpperCase();
  const m = s.match(/^(\d+)([A-Z]*)$/);
  if (m) s = m[1].padStart(4, '0') + m[2];
  return s;
}
export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export function initials(name) {
  const s = String(name || '').trim();
  if (!s) return '？';
  return /[\u4e00-\u9fff]/.test(s) ? s.slice(-2) : s.slice(0, 2).toUpperCase();
}
export function plural(n, unit) { return `${n} ${unit}${n === 1 ? '' : ''}`; }
/** 三色燈（跟 VS 慣例：綠=已寫入後端、黃=只在本機、紅=衝突／失敗） */
export function stateDot(state) {
  const map = { synced: ['g', '已同步'], dirty: ['y', '只在本機'], conflict: ['r', '有衝突'], failed: ['r', '寫入失敗'], idle: ['n', '未變更'] };
  const [c, t] = map[state] || map.idle;
  return `<span class="dot ${c}" title="${t}"></span>`;
}

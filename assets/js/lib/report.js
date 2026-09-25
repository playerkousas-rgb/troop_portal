/* 問題回報 → Scout Admin「問題回報 TICK」合約
   ────────────────────────────────────────────────────────────────
   ADMIN 收嘅格式（同一支 GAS、同一張表；同圖書館 report.html?app=圖書館 一樣）：
     POST { type:'issue', sourceApp, title, desc, severity, troopId, name, contact }
   ⚠ 合約由 registry.REPORT 定義（唯一來源）。呢個 lib 只負責「點送」：
     · 示範模式（mock）：唔會 fetch，只入本機＋審計 → 回 { ok:true, mode:'mock' }
     · 真模式：POST 同源 /api/proxy（action='issue'）→ server 側注入端點送出
       （GAS 端點永不出現喺前端；失敗＝誠實講失敗，唔會扮送到）
   ADMIN 側唔使改任何嘢：佢見 type:'issue' 就自己寫入「問題回報」表＋Email 通知。 */
import { REPORT } from './registry.js';
import * as S from './store.js';

export const isMock = () => {
  const d = S.load();
  const m = d?.meta?.mode || d?.backend?.mode || 'mock';
  return m !== 'live';
};

/**
 * 送出問題回報（唯一出口）
 * @param {{title:string,desc:string,severity?:string,troopId?:string,name?:string,contact?:string}} form
 * @returns {Promise<{ok:boolean, mode:string, msg:string, payload?:object}>}
 */
export async function sendAdminReport(form = {}) {
  const chk = REPORT.check(form);
  if (!chk.ok) return { ok: false, mode: isMock() ? 'mock' : 'live', msg: chk.msg };
  const payload = REPORT.payload(form);

  if (isMock()) {
    S.addAdminReport(payload, { mode: 'mock', ok: true });
    S.audit('問題回報（示範）', payload.title, `對正 ADMIN 合約：type=issue · sourceApp=${payload.sourceApp} · severity=${payload.severity}`);
    return { ok: true, mode: 'mock', payload, msg: '示範模式：已入本機紀錄（真模式＝經 /api/proxy 送去 ADMIN 收件匣）' };
  }

  try {
    const r = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'issue', ...payload })
    });
    const body = await r.json().catch(() => ({}));
    const ok = r.ok && body && body.success !== false;
    S.addAdminReport(payload, { mode: 'live', ok, error: ok ? '' : (body?.error || `HTTP ${r.status}`) });
    S.audit('問題回報', payload.title, ok ? `已送去 ADMIN 收件匣（severity=${payload.severity}）` : `送唔到：${body?.error || r.status}`);
    return ok
      ? { ok: true, mode: 'live', payload, msg: '已送去 ADMIN 收件匣（會寫入「問題回報」表＋Email 通知）' }
      : { ok: false, mode: 'live', payload, msg: `送唔到：${body?.error || 'HTTP ' + r.status} —— 可以改用官方回報頁（同一張表）` };
  } catch (e) {
    S.addAdminReport(payload, { mode: 'live', ok: false, error: String(e?.message || e) });
    return { ok: false, mode: 'live', payload, msg: '連唔到旅側後端 —— 可以改用官方回報頁（同一張表）' };
  }
}

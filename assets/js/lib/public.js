/* ============================================================
   public.js — 公開頁（免登入）↔ 旅後端嘅唯一通道
   ------------------------------------------------------------
   點解獨立一支：公開頁**冇 session**，但法例／BUILD 都話要收得到（報名／借用／開戶申請／求救）。
   所以：
     · 一律 POST 同源 `/api/proxy`，由 server 側 inject apikey（前端**永不見**旅 GAS URL／key）
     · 只可以用**匿名可寫面白名單**嗰六個 action（proxy 同 GAS 兩邊都擋）
     · 示範模式：即刻回 `{ok:false, code:'mock'}`，一個請求都唔發
     · 送唔到就老實講（唔會扮成功、唔會靜靜吞）
   ============================================================ */
import * as S from './store.js';

/** 匿名可寫面（同 api/proxy.js `ANON_GAS` 對得上） */
export const ANON_ACTIONS = ['noticeSignup', 'borrowApply', 'financeApply', 'progressApply', 'accountApply', 'saveRescue'];

export const isLive = () => !S.isMock();
export const unitId = () => String(S.load()?.unit?.code || '').replace(/^0+(?=\d)/, '') || '';

/** 免登入提交；`kind` 只可以係 ANON_ACTIONS */
export async function submitAnon(kind, payload = {}) {
  if (!ANON_ACTIONS.includes(kind)) return { ok: false, code: 'not_allowed', msg: `「${kind}」唔係公開可寫面嘅 action` };
  if (!isLive()) return { ok: false, code: 'mock', msg: '示範模式：只記本機，冇真送後端' };
  const unit = unitId();
  if (!unit) return { ok: false, code: 'no_unit', msg: '未設定旅 ID（？u=旅ID）' };
  try {
    const r = await fetch('/api/proxy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ action: kind, unit, payload })
    });
    const j = await r.json().catch(() => null);
    if (!j) return { ok: false, code: 'bad_response', msg: `回應唔係 JSON（HTTP ${r.status}）` };
    return j.success === true ? { ok: true, data: j.data, note: j.note } : { ok: false, code: j.code || 'fail', msg: j.error || '送唔到' };
  } catch (e) { return { ok: false, code: 'network', msg: '連唔到後端：' + String(e?.message || e) }; }
}

/** 送出之後嘅「人話」結果（公開頁共用，唔好每頁自己寫一套） */
export function receiptText(res, { what = '申請', localAt = '' } = {}) {
  if (res.ok) {
    const dup = res.data && res.data.duplicate;
    return { tone: 'ok', text: dup ? `你之前已經送過（${what}唔會重複）—— 領袖會對名冊核對。` : `已送出${what}：旅部會核對名冊／物資之後再處理。` };
  }
  if (res.code === 'mock') return { tone: '', text: `示範模式：${what}只有本機紀錄（${localAt || '本機時間'}）。真模式會送去旅 SHEET 待批表。` };
  return { tone: 'err', text: `送唔到（${res.msg || res.code}）—— 請稍後再試，或者用官方回報頁。` };
}

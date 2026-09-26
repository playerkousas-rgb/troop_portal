/* ============================================================
   transfer.js — 移交規則（BUILD §6）· 一套規矩，四個地方用
   ------------------------------------------------------------
   同一套規矩喺：① 前端示範模式 ② 前端真模式（打 API 之前先自查）
              ③ 旅 GAS（final 話事） ④ 測試
   所以規則住呢度一份，唔好四處抄。

   接收（匯入套裝）嘅次序（同 GAS importTransferBundle 一樣）：
     1. sha256 對唔上 → bad_hash（改過一個字都唔收）
     2. 冇 transferId／SCOUT_ID → bad_transfer／bad_scout（冇冪等鍵唔收）
     3. transferId 已接收過（state='done'）→ duplicate（冪等，唔會建第二次）
     4. 本旅已有同一個 SCOUT_ID 現役或等開戶 → clash（阻住，交人手處理）
   ============================================================ */
import { canonicalBundle, hashForBundle } from './hash.js';

/** 邊啲狀態＝「已經有人喺度」，會撞號 */
export const LIVE_STATUS = ['ACTIVE', 'PENDING_HASH'];
const live = st => LIVE_STATUS.includes(String(st || '').toUpperCase());

/** 純規則：唔碰網絡、唔碰 store —— 傳入嘅 hash 已經算好 */
export function verifyImport({ bundle = {}, sha256 = '', hash = '', members = [], transfers = [] } = {}) {
  if (sha256 && hash && String(sha256) !== String(hash)) {
    return { ok: false, code: 'bad_hash', msg: `sha256 唔對（檔 ${String(sha256).slice(0, 10)}…／算出 ${String(hash).slice(0, 10)}…）—— 個檔改過或者傳壞咗` };
  }
  const scout = String(bundle.scout_id || bundle.ymis || '');
  if (!scout) return { ok: false, code: 'bad_scout', msg: '套裝冇 SCOUT_ID' };
  const tid = String(bundle.transferId || '');
  if (!tid) return { ok: false, code: 'bad_transfer', msg: '套裝冇 transferId（冇冪等鍵唔收）' };
  if ((transfers || []).some(t => String(t.transferId) === tid && String(t.state) === 'done')) {
    return { ok: false, code: 'duplicate', msg: '呢個 transferId 已經接收過（冪等：唔會建第二次）' };
  }
  const clash = (members || []).find(m => String(m.ymis) === scout && live(m.status));
  if (clash) return { ok: false, code: 'clash', msg: `撞號：本旅已經有 ${scout}（${clash.name || '（冇名）'}）—— 唔會重複建，請人手核對` };
  return { ok: true, code: 'ok', scout, transferId: tid };
}

/** 接收之後嘅新名冊行（同 GAS 一樣係 pending_hash：密碼行開戶流程） */
export function acceptRow(bundle = {}, to = '', today = '') {
  return {
    ymis: String(bundle.scout_id || bundle.ymis || ''),
    name: String(bundle.name || ''),
    branchId: to || bundle.transferTo || '',
    identity: '成員', status: 'pending_hash',
    dob: String(bundle.dob || ''),
    fromBranch: String(bundle.fromBranch || ''),
    transferId: String(bundle.transferId || ''),
    joined: today
  };
}

/** 移出之後嘅兩件事：① 成員轉 TRANSFERRED_OUT（tombstone）② 開一行移交紀錄 */
export function outPatch(bundle = {}, { from = '', to = '', reason = '', date = '', sameTroop = false } = {}) {
  const row = {
    id: bundle.transferId, kind: 'transfer',
    scoutId: bundle.scout_id, name: bundle.name || '',
    from, to, reason, at: date, state: 'out',
    bundle: 'sha256:' + (bundle.sha256 || ''), sha256: bundle.sha256 || '',
    transferId: bundle.transferId, parentSameTroop: !!sameTroop,
    parentAction: sameTroop ? '（同旅移動：家長零改動）' : '來源家長戶轉 LEFT；接收旅發邀請連結重開'
  };
  const member = { status: 'TRANSFERRED_OUT', transferTo: to, transferDate: date };
  return { row, member };
}

/** 一次過：算 hash（canonical 欄序）＋ 驗證 */
export async function verifyBundle(bundle = {}, { sha256 = '', members = [], transfers = [] } = {}) {
  const h = await hashForBundle(bundle);
  return { ...verifyImport({ bundle, sha256, hash: h.hash, members, transfers }), hash: h.hash, hashKind: h.kind };
}
export { canonicalBundle, hashForBundle };

/* ============================================================
   hash.js — sha256（移交套裝要跟住個檔走，改一個字就驗唔到）
   ------------------------------------------------------------
   真環境（https／localhost）用 WebCrypto；示範模式（無 crypto.subtle，
   例如舊瀏覽器或 jsdom）用一個**明確標示**嘅降級雜湊：唔可以扮係 sha256。
   ★ 規則：真後端永遠自己再算一次（GAS sha256Hex_）—— 前端嘅只係俾人核對。
   ============================================================ */
export const hasWebCrypto = () => !!(globalThis.crypto && globalThis.crypto.subtle && globalThis.crypto.subtle.digest);
const toHex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');

/** 真 sha256（64 位 hex）；冇 WebCrypto 就回 null（唔會靜靜用假嘢頂） */
export async function sha256Hex(text) {
  if (!hasWebCrypto()) return null;
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return toHex(buf);
}
/** 降級：FNV-1a 變體（64 hex 外觀）。**唔係密碼學雜湊**，只可以喺示範模式作比對用 */
export function demoHash64(text) {
  let h1 = 0x811c9dc5, h2 = 0xc2b2ae35;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0; h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = (h2 + c * (i + 7)) >>> 0; h2 = Math.imul(h2 ^ (h2 >>> 13), 2654435761) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 8; i++) {
    h1 = Math.imul(h1 ^ (h1 >>> 15), 2246822519) >>> 0;
    h2 = Math.imul(h2 ^ (h2 >>> 13), 3266489917) >>> 0;
    out += (h1 >>> 0).toString(16).padStart(8, '0');
    h1 = (h1 + h2) >>> 0; h2 = (h2 + h1) >>> 0;
  }
  return out.slice(0, 64);
}
/** 移交套裝嘅固定欄序（**要同 GAS `bundleCanonical_` 一模一樣**，唔係就兩邊算唔同 hash） */
export const TRANSFER_FIELDS = ['transferId', 'scout_id', 'ymis', 'name', 'dob', 'parentContact', 'badgeSummary', 'transferTo', 'transferDate'];
export function canonicalBundle(b = {}) {
  const o = {};
  TRANSFER_FIELDS.forEach(k => { o[k] = b[k] === undefined || b[k] === null ? '' : b[k]; });
  return o;
}
/** 要嚟顯示嘅：真 hash／示範 hash（會標明邊種） */
export async function hashForBundle(obj, { raw = false } = {}) {
  const canon = raw ? String(obj) : JSON.stringify(canonicalBundle(obj));
  const real = await sha256Hex(canon);
  return real ? { hash: real, kind: 'sha256' } : { hash: demoHash64(canon), kind: 'demo' };
}

/* ============================================================
   formats.js — 體積治理：圖／上載（BUILD §10 體積治理）
   ------------------------------------------------------------
   BUILD 硬規矩（逐條對）：
     · 相片轉 `AVIF`／`WebP`，單檔 **<500KB**
     · 上載面：單檔 **≤5MB**、每筆 **最多 3 張**、每 unit **每日總量上限**
     · `dist < 5MB`、`bundle < 2MB`，CI 硬攔（我哋用 `npm run check` 做嗰條線）
   本檔只做**判斷同建議**（零依賴、唔會真上載）：上載面係支部系統嘅事。
   ============================================================ */

export const LIMITS = {
  uploadBytes: 5 * 1024 * 1024,      // 單檔 ≤5MB
  perRecord: 3,                       // 每筆最多 3 張
  dailyBytesPerUnit: 40 * 1024 * 1024,// 每 unit 每日 40MB（示範值；真值放 Vercel env）
  photoBytes: 500 * 1024,             // 相片單檔 <500KB（AVIF／WebP 後）
  distBytes: 5 * 1024 * 1024,         // dist <5MB
  bundleBytes: 2 * 1024 * 1024        // bundle <2MB
};

/** 支援嘅圖格式（AVIF／WebP 優先） */
export const IMAGE_FORMATS = ['image/avif', 'image/webp', 'image/jpeg', 'image/png', 'image/gif'];
export const PREFERRED = ['image/avif', 'image/webp'];

export const human = bytes => {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

/** 有冇 AVIF／WebP 支援（用 canvas 探；唔會 throw） */
export function canEncode(type) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    return c.toDataURL(String(type)) === `data:${type};base64,` + c.toDataURL(String(type)).split(',')[1];
  } catch { return false; }
}
/** 揀一個最細嘅可用格式（瀏覽器唔支援嘅唔會亂揀） */
export function bestFormat(supported = []) {
  return PREFERRED.find(f => supported.includes(f)) || 'image/jpeg';
}

/**
 * 上載前檢查（唔會真讀檔；caller 傳 file-like：{name,type,size}）
 * @returns {{ok:boolean, errors:string[], warns:string[], needConvert:boolean}}
 */
export function checkUpload(file, { countInRecord = 1, usedBytesToday = 0, unitLimit = LIMITS.dailyBytesPerUnit } = {}) {
  const errors = [], warns = [];
  const f = file || {};
  if (!IMAGE_FORMATS.includes(String(f.type))) errors.push(`格式唔支援：${f.type || '（冇）'}（要 AVIF／WebP／JPEG／PNG／GIF）`);
  if (Number(f.size) > LIMITS.uploadBytes) errors.push(`單檔 ${human(f.size)} 超過上限 ${human(LIMITS.uploadBytes)}`);
  if (countInRecord > LIMITS.perRecord) errors.push(`每筆最多 ${LIMITS.perRecord} 張（而家 ${countInRecord} 張）`);
  const total = Number(usedBytesToday) + Number(f.size || 0);
  if (total > unitLimit) errors.push(`今日總量 ${human(total)} 超過上限 ${human(unitLimit)}`);
  const needConvert = !PREFERRED.includes(String(f.type));
  if (needConvert) warns.push('建議轉 AVIF／WebP（再細 30~60%）先上載');
  if (String(f.type) && !needConvert && Number(f.size) > LIMITS.photoBytes) warns.push(`相片建議壓到 <${human(LIMITS.photoBytes)}`);
  return { ok: errors.length === 0, errors, warns, needConvert };
}
/** 體積報表（俾 `npm run check` 同「平台」頁用同一條線） */
export function checkSize({ distBytes = 0, bundleBytes = 0 } = {}) {
  const out = [];
  out.push({ what: 'dist', bytes: distBytes, limit: LIMITS.distBytes, ok: distBytes <= LIMITS.distBytes });
  out.push({ what: 'bundle', bytes: bundleBytes, limit: LIMITS.bundleBytes, ok: bundleBytes <= LIMITS.bundleBytes });
  return { ok: out.every(x => x.ok), rows: out };
}
/** 由 bytes 計「離 5MB 仲有幾遠」（Vercel 防爆） */
export const headroom = (bytes, limit = LIMITS.distBytes) => ({ used: human(bytes), limit: human(limit), pct: Math.min(100, Math.round((Number(bytes) || 0) / limit * 100)) });

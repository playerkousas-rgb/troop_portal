# 開旅 checklist（新旅／交接）

> 照住做，每項都要親眼見到結果先打勾。**牽涉密鑰嘅步驟唔好截圖、唔好貼落群組。**

## A. 前置

- [ ] 開一個新 Google Sheet（名：`旅_XX`）；唔好用住舊旅嘅 Sheet。
- [ ] Vercel 專案已部署本 repo；`vercel.json` 有 `regions:["hkg1"]`。

## B. 旅 SHEET（`apps-script/Code.gs`）

- [ ] Sheet → 擴充功能 → Apps Script → 貼上 `apps-script/Code.gs` → 儲存。
- [ ] 執行 `initializeSheets()` → 分頁齊（旅員／支部／模組開關／財務整合／物資整合／旅通告／旅行事曆／公開資料／分享／求救／邀請／申請／移交／教材／進度摘要／備份紀錄／設定值＋審計／操作／同步紀錄）。
- [ ] 執行 `seedFirstChief('旅長email')` → 記低 12 字 **setup token**。
- [ ] 部署 → 網頁應用程式 → 執行身分「我」、存取權「任何人」→ 攞 `/exec`。
- [ ] 選單「🔑 顯示 BACKEND／APIKEY」→ 交俾 ADMIN（**唔好入 git**）。

## C. Vercel env（ADMIN）

- [ ] `TROOP_<旅ID>_BACKEND`（`/exec`）、`TROOP_<旅ID>_APIKEY`。
- [ ] `SESSION_SECRET`（`openssl rand -hex 32`）、`SUPER_KEY`、`SHARE_SECRET`。
- [ ] （可選）`ADMIN_ISSUE_ENDPOINT`（唔設＝用預設 Scout Admin 收件匣）。
- [ ] Redeploy（env 要重新 build 先生效）。

## D. 網站首次登入

- [ ] `?step=unit` → 揀旅 → 旅長 → 「第一次設密碼」（email ＋ setup token ＋ 新密碼 ≥8）。
- [ ] 入到之後睇 🟢（冇未寫入）＋ 診斷 `dbInfo`：分頁齊、`chain.ok:true`、`properties.apiKey:true`。

## E. 接駁同日常

- [ ] 支部與接駁：逐個下游登記（`/exec` ＋ 下游 KEY）→「測試連線」綠燈。
- [ ] 帳號：邀請旅員／家長／支部人員（可揀順便為下游開戶）。
- [ ] 模組：系統 → 模組開關（閂咗＝隱藏唔刪）。
- [ ] 開戶申請模式：開放申請／純邀請制（用戶與身份 → 邀請）。
- [ ] 備份：系統 → 匯出全庫（帶 sha256）＋ Drive 備份（建立即 PRIVATE）。
- [ ] 審計鏈：診斷一撳 → `chain.ok`；被人改過會變 false。

## F. 交接

- [ ] 上級重設其密碼 → 撤 `branch_access`／override。
- [ ] Google／Vercel ownership 轉名（機構戶 ＋ 兩名管理人 ＋ 2FA）。
- [ ] 輪換受影響嘅 key（旅遊長換人 = 換 APIKEY）。

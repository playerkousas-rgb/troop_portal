# troop_portal — 旅系統（生態頂點）

> 香港童軍**旅系統**：整個生態嘅頂點（TROOP 層）。所有人由旅呢個窗口入，入到去先揀支部。
>
> **本輪狀態：UI 先行示範版（`v0.1.0-ui`）已經開得。** 後端（`/api/*`、旅 `Code.gs`）未實作。
>
> ★ **旅入口＝你支部嘅入口**：揀啱團、登入 → 直接係你支部嘅世界，只多咗「其他支部 share 咗、並經你哋接收」嘅嘢。
> ★ **分享收件方決定**：人哋 share 嚟嘅嘢，**你接收先會出現**；未接收只喺「分享中心 · 待接收」，退回會留紀錄。
> 施工前先讀 **[docs/旅系統建構計劃.md](docs/旅系統建構計劃.md)**（唯一施工規格）；
> 想睇「功能係咪齊備」就開 **[docs/UI-示範導覽.md](docs/UI-示範導覽.md)**（逐個模組對照表）。

## 即刻試（示範模式 · 零依賴 · 零 build）

```bash
npm run dev        # → http://localhost:8080/
npm run check      # lint（語法／匯入圖／註冊表／體積）+ jsdom smoke（全部角色 × 全部路由 × 全部分頁）
```

示範帳號密碼一律 `demo1234`，按旅閘嘅**身份分流**入：

| 身份 | 示範帳號 | 睇得到咩 |
|---|---|---|
| 旅長／教練員 | `chief@demo.troop`／`coach@demo.troop` | 旅長＝15 個模組；教練員＝除「系統」外，只睇獲授權支部 |
| 家長（監護人） | `parent@demo.troop` | 我的子女（跨 2 個支部）、通告、行事曆、繳費 |
| 支部人員（**先揀團**） | 幼童軍團 `cs-leader@demo.troop`（團長）／`cs-deputy@demo.troop`（副團長）；深資童軍團 `vs-exec@demo.troop`（執委·主席）／`vs-team@demo.troop`（團隊長·18+）；童軍團 `sc-cpl@demo.troop`（副隊長·未夠 18） | 我的支部、通告、行事曆、物資；團長／副團長多「支部」入口 |
| 平台超管（隱藏） | `super@platform.local`（入口 `index.html?step=super` 或旅閘撳 ⚜ 五下） | 平台：接入收件匣、units、金鑰輪換；唔會出現喺任何名單 |

示範 **分享**：用 `sc-cpl@demo.troop`（童軍團副隊長）登入 → 分享中心有 3 項待接收（深資童軍團 share 嚟）；
撳「接收」→ 去通告頁即刻見到「來自 深資童軍團」；撳「退回」要填理由（留紀錄）。
用 `sc-scout@demo.troop`（團員 · 18+）睇「唔夠權決定」：只可以加註解交團長／執委。

角色模型（2026-09-25 用戶定案）：旅層**只有旅長同教練員**（冇「旅層領袖」）；
其餘全部係**支部人員**（團長／副團長／管委／執委／隊長／副隊長／團隊長／團員），帳號落該團支部 SHEET，
但全部由旅呢個窗口入 —— **除旅長／教練員／家長外，入之前要先揀團**（旅要先對到該團下游，先讀到資料）。

免登入頁面：`public.html`、`notice.html?n=n-1`、`borrow.html`、`join.html?t=TROOP-COA-7F3A9C2E`（教練員邀請）／`?t=TROOP-MEM-5C7D1F2A`（支部人員邀請）。

示範模式死規矩：資料只住你部機（localStorage）、**唔會送去任何後端**、永遠唔會假裝寫入成功
（寫入要撳頂部「儲存到後端」，收據要有 `confirmed:true` 先算數）。

## 定位（一句話）

同一份 `Code.gs` 部署喺每一層（旅／團／進度）；旅係「一個 codebase 服務多個旅」嘅管理層站點 ——
旅只做管理層（開戶、接駁、權限、聚合、公開資料），**支部嘅數據永遠住支部自己張 Sheet**，旅要用就經 `sig` 讀返嚟。

```
平台 ADMIN（scout-admin 收件匣／units 登記）
   └─ 旅系統（本 repo）＝旅 SHEET ＋ /exec；上游
        ├─ sig ─▶ 團（支部系統：vs_portal／cubs_portal…）
        └─ sig ─▶ 進度 leaf（vsbadge／roverbadge…）
```

## 公理（跟 `readme` 真理倉，唔可以違反）

1. **一切身份 = SCOUT_ID + 所在 SHEET**（開戶錨點：成員＝該團支部、領袖＝所屬層、家長＝有旅就旅）
2. **一切接入 = 交俾邊個 + 登記邊個 registry**（旅層 registry 只落 GAS `ScriptProperties`：`DOWNSTREAM_<id>_*`）

## 三個唔可以混嘅接駁規矩

- 中央登入「回傳」＝ GAS 回打**自己 app 嘅固定端點** `/api/super`（一次性防重放）
- 旅系統 `sig` 鏈**單向**（旅 → 團 → 進度），下游同步回一個結果
- **旅系統冇 callback endpoint**；下游永不主動回打上游

## 快速連結

| 想知 | 睇邊 |
|---|---|
| **點試 UI、逐個模組對照（功能齊備度）** | **`docs/UI-示範導覽.md`** |
| 定位、部署形態、變數 ABCD | 計劃 §0–§2 |
| 登入窗口、家長頁、權限、開戶錨點 | 計劃 §3 |
| `sig`、action 白名單、入口掣、回傳三條 | 計劃 §4 |
| 旅層分頁（財務／物資整合）、公開資料、訂閱 | 計劃 §5 |
| 前端路由、`api/` 端點、Code.gs 節 | 計劃 §6 |
| 功能分期（P0–P3） | 計劃 §7 |
| 驗收測試、禁區、待定案 | 計劃 §10／§12／§13 |

## 工程規矩（同生態一致）

純靜態零依賴（HTML + CSS + 原生 JS ES Modules）＋ `/api/*` 零依賴 serverless；`Code.gs` 由 `scripts/build-gas.mjs` 生成（單一來源）；
`npm run check`（lint → build → test）要全綠；`.vercelignore` 係部署唯一一道閘；`dist < 5MB`、`bundle < 2MB`；版號只留 MD。

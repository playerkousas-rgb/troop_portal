# troop_portal — 旅系統（生態頂點）

> 香港童軍**旅系統**：整個生態嘅頂點（TROOP 層）。所有人由旅呢個窗口入，入到去先揀支部。
>
> **本輪狀態：只出規格，未落碼。** 施工前先讀 **[docs/旅系統建構計劃.md](docs/旅系統建構計劃.md)**（唯一施工規格）。

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

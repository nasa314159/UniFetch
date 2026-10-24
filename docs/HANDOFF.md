# UniFetch 交接文件（Instagram 穩定期）

> 語言：Traditional Chinese（繁體中文）
> 適用對象：接手 Instagram / Threads 維護、或準備開始 Facebook 的工程師
> 最後更新：2026-10-24（E1 Threads 本機擴充功能候選）
> 本文件是交接入口。英文的產品／隱私細節仍以 `README.md`、`docs/supported-content.md`、`docs/privacy-model.md` 為準。

---

## 0. 快速結論

- 穩定版 Instagram 範圍：**公開 Web/PWA 的 Post / Carousel / Reel**，加上**本機 Chromium 擴充功能的登入態 Post / Carousel / Reel**，以及**URL 已含明確 media id 的 Story 圖片／影片**。
- E1 在分支 `feat/threads-local-extension` 加入 **Chromium 擴充功能的公開 Threads 貼文下載**（圖片、圖片 carousel、原生 MP4、混合 carousel、已測 Giphy GIF、官方 `/share/` 連結）。**尚未合併 `main`、尚未發佈**；`extension-v0.2.0` 仍是正式回滾基準。
- Threads 擴充功能路徑是 **public-only**：所有 Threads metadata 請求使用 `credentials: 'omit'`，不帶使用者登入態；另用窄範圍 `declarativeNetRequestWithHostAccess` session rule 補上 Threads SSR 需要的 navigation headers，請求結束即移除。
- M9A 新增 **GitHub Releases 擴充功能 ZIP 發佈**與公開安裝頁 `/extension`。擴充功能仍未上架 Chrome Web Store，必須下載 ZIP、解壓並以開發者模式 Load unpacked；下載 ZIP 本身不會自動安裝。
- **使用者名稱限定 Story（`/stories/<username>/`）已停用，並且是 fail-closed**：不發出請求、不掃描 DOM、不猜 ID。
- M8B–M8D 的 Story 實驗完整保存在分支 `research/m8b-m8d-instagram-story`（snapshot commit `72c590e`）。
- 本輪沒有重做 Instagram 登入態實機驗證；只做程式、測試、建置與 Threads 匿名實機驗證。**請不要把自動測試通過當成 Instagram 線上功能保證。**
- 下一階段建議：先完成 E1 的 v0.3.0 發佈審查與真人工 optional permission 檢查，再做 Facebook 可行性分析。不要重寫 UniFetch 架構。

---

## 1. UniFetch 產品目標與使用體驗

UniFetch 是開源、隱私導向、由使用者主動觸發的社群媒體下載器。核心體驗：

1. 使用者明確貼上一個連結，或從手機分享選單把連結送進 UniFetch。
2. UniFetch 解析該連結的中繼資料，顯示可預覽的媒體與清楚的來源／隱私說明。
3. 使用者按下下載後，媒體位元組由使用者的瀏覽器／裝置直接向來源 CDN 取得，不經過 UniFetch 的媒體代理。
4. 不建立帳號、不要求 Instagram 密碼、不上傳 cookie、不保留解析歷史。

產品原則：

- **一次一個使用者提供的 URL**，不做爬蟲、批次枚舉、猜測 ID。
- **媒體不繞道**：沒有伺服器端 media proxy。
- **可解釋的失敗**：錯誤要能區分登入需求、存取限制、解析器過期、網路問題等。
- **能力要誠實揭露**：Web/PWA 與擴充功能能力不同，不得混為一談。

---

## 2. 目前支援的平台與功能

| 平台／內容                       | Web/PWA `unifetch.pages.dev`           | Chromium 擴充功能（GitHub Releases ZIP，unpacked） |
| -------------------------------- | -------------------------------------- | -------------------------------------------------- |
| Instagram Post（單圖）           | 公開中繼資料（Resolver，已測樣本）     | 登入態解析＋下載（曾實機驗證）                     |
| Instagram Carousel               | 公開中繼資料（Resolver，已測樣本）     | 登入態多媒體解析＋依序下載（曾實機驗證）           |
| Instagram Reel                   | 公開中繼資料（Resolver，已測樣本）     | 登入態解析＋下載（曾實機驗證）                     |
| Instagram Story（URL 有明確 id） | 不支援                                 | 單一圖片或影片（曾實機驗證）                       |
| Instagram Story（只有 username） | 不支援                                 | **不支援，fail-closed**                            |
| Instagram Highlights             | 不支援                                 | 不支援                                             |
| Facebook                         | 僅顯示「Coming soon」                  | 未實作                                             |
| Threads Post（公開）             | 公開中繼資料（Resolver，T1C 正式驗證） | 公開貼文本機解析＋下載（E1 v0.3.0 候選，未發佈）   |
| Threads `/share/<token>/`        | 單次展開後解析（T1D 正式驗證）         | 有（候選；單次 redirect 後驗證 canonical post）    |
| Threads GIF（已測 Giphy）        | 公開中繼資料＋embed fallback           | 有（候選；保留原始 animated GIF）                  |

狀態用語：

- **已實作**：程式存在且可建置。
- **自動測試已驗證**：`pnpm test` 有覆蓋。
- **曾物理驗證**：曾在真實瀏覽器／裝置上操作成功；**本穩定期未重驗**。
- **部分支援**：只在更窄的條件下成立。
- **延後**：刻意先不做。
- **不支援**：設計上直接拒絕。

### 2.1 行動裝置入口（既有驗證，本輪未重驗）

- **Android：** Instagram → 分享 → UniFetch PWA Share Target → 自動解析。
- **iOS / iPadOS：** Instagram → 分享 → UniFetch Apple Shortcut → `/share` → 自動解析。
- 已驗證 Shortcut 連結：`https://www.icloud.com/shortcuts/9ff25727f16a43cfa6eac1e3ccd49a82`
- 多媒體下載：Android 直接多下載可用；iOS 需要時使用 Save queue。歷史驗證曾成功保存 4/4，並保留 `_01`…`_04` 原始順序。
- PWA 安裝：Android 安裝與 Share Target 已確認；iOS「加入主畫面」已確認。

---

## 3. 架構與重要目錄

pnpm workspace：

```text
apps/
  web/                 Vue 3 + TypeScript + Vite + Pinia + Zod；PWA；部署到 Cloudflare Pages
  resolver-worker/     Cloudflare Worker；只做 Instagram 公開中繼資料 POST /api/resolve
  extension/           Chromium MV3；登入態本機解析與下載（unpacked）
packages/
  core/                領域型別、錯誤、URL 驗證、Resolver API schema
  meta-resolver/       Instagram content-ref、Polaris profile、parser、normalizer
  runtime-web/         Web 端 runtime（目前生產流程以 Resolver 為主）
  downloader/          瀏覽器原生下載、檔名、批次順序、圖片正規化
  share-target/        /share query 解析（URL → text → title）
  (future) runtime-extension / runtime-native 仍是保留的 slot
docs/                  架構、隱私、威脅模型、支援內容、部署、交接
fixtures/              合成 Instagram 範例（無真實帳號資料）
```

資料流：

```text
Web/PWA:
使用者 URL → Resolver Worker → 固定 Instagram bootstrap/metadata
          → 正規化中繼資料＋直接媒體 URL → 瀏覽器直接向 CDN 取得媒體

Extension:
popup → 手動 URL 或目前分頁 → background service worker
      → Instagram（credentials: include；不自行組 Cookie header）
      → 既有 Instagram parser/normalizer → 記憶體中的 MediaAsset
      → Threads（credentials: omit；只打官方 www.threads.com）
      → 既有 Threads parser／share validator／GIF fallback／normalizer
      → 瀏覽器原生下載（CDN → 裝置）
```

延伸閱讀：`docs/architecture.md`、`docs/privacy-model.md`、`docs/threat-model.md`。

---

## 4. Web/PWA 與 Extension 的能力差異

| 能力                                  | Web/PWA             | Extension                                          |
| ------------------------------------- | ------------------- | -------------------------------------------------- |
| 公開 Instagram Post / Carousel / Reel | 有（透過 Resolver） | 有                                                 |
| 需要登入的 Instagram 貼文             | 不支援              | 有（使用使用者現有瀏覽器 session）                 |
| Instagram Story                       | 不支援              | 僅明確 id                                          |
| 公開 Threads 貼文／carousel／影片     | 有（透過 Resolver） | 有（E1 候選；public-only、credentials omit）       |
| Threads `/share/`                     | 有（單次展開）      | 有（E1 候選；單次 redirect 後驗證）                |
| Threads GIF（Giphy）                  | 有                  | 有（E1 候選；保留動畫）                            |
| 讀取 Instagram cookie / session       | 不讀                | 不讀、不匯出；靠瀏覽器自動附帶                     |
| 讀取 Threads session                  | 不讀                | 不讀；請求使用 `credentials: 'omit'`               |
| 媒體是否經過 UniFetch 伺服器          | 否                  | 否                                                 |
| 部署位置                              | Cloudflare Pages    | GitHub Releases；使用者本機 Chrome                 |
| 「一鍵安裝」                          | PWA 安裝            | 下載 GitHub Releases ZIP；開發者模式 Load unpacked |

**重要：** 擴充功能的登入態能力不會自動出現在 `https://unifetch.pages.dev`。Web UI 只宣稱 Post / Carousel / Reel；`apps/web/src/views/capabilities.test.ts` 會防止 Web 頁面誤宣稱 Story 或 extension 能力。

---

## 5. Instagram 功能與驗證狀態

### 5.1 Web/PWA

- Post / Carousel / Reel：**已實作、自動測試已驗證、曾物理驗證**（M5–M5.5）。
- 媒體下載：直接向來源 CDN；圖片可在 CORS 允許時以 Blob 下載並正規化為 JPEG；影片不轉碼。
- 錯誤分類：`LOGIN_REQUIRED`、`GRAPHQL_EXECUTION_ERROR`、`PARSER_OUTDATED`、`NETWORK_ERROR`、`BROWSER_RESTRICTION`、`HTTP_ERROR` 等。
- Story：**不支援**（Web 沒有登入態，也不應有）。

### 5.2 Extension — Post / Carousel / Reel

- **已實作、自動測試已驗證、曾物理驗證。**
- 解析策略順序：background fetch → isolated content script → MAIN world，第一個成功者勝出。
- Carousel 依照原始索引順序下載，檔名保留 `_01`、`_02`…。
- 下載流程：`Download all` 可直接解析後下載；同一目標的解析結果只在 popup 記憶體快取。
- 隱私：不讀 `document.cookie`、不使用 `chrome.cookies`、不使用 storage。

### 5.3 Extension — Story（明確 id）

- 接受：`https://www.instagram.com/stories/<username>/<story-id>/`，或 username-level URL 的 query 已帶明確 id（例如 `story_media_id`）。
- 呼叫：`GET https://www.instagram.com/api/v1/media/<story-id>/info/`。
- **只取一筆**：回應若有多個 item，不列舉、不下載，回 `UNSUPPORTED_CONTENT`。
- 圖片與影片：**已實作、自動測試已驗證、曾物理驗證**（歷史回報）。
- **Owner 驗證**：API 回應的 `user.username` 必須與 route 的 username 相符；不符即 `mismatch`，不暴露 asset、不下載。
- 明確 id 被視為權威來源；若 API 未提供 owner，owner 為 `unknown`，不會因此拒絕明確 id（但仍不會接受 owner 明確不符的情況）。

### 5.4 Extension — Story（只有 username）

- `/stories/<username>/`：**不支援、fail-closed**。
- 行為：`story/route.ts` 在任何網路請求或頁面注入前就回傳 `UNSUPPORTED_CONTENT`；`identityResult = 'unproven'`。
- 不執行：DOM 掃描、React props、React Fiber、history state、inline JSON、visible-media 幾何判斷、current-id 推測。
- 原因見下一節。

---

## 6. 已知 Story 限制與技術根因

### 6.1 為什麼 username-only 很難

Instagram 第一個 Story 常以 `/stories/<username>/` 開啟，URL **沒有** media id。但已知可用的 API 是：

```text
GET /api/v1/media/<story-id>/info/
```

也就是說，沒有 id 就沒有可靠的官方單筆查詢路徑。

### 6.2 為什麼不能用頁面狀態猜

先前實驗嘗試從下列來源找「目前這則」Story 的 id：

- URL query
- `history.state`
- inline JSON / hydration state
- DOM 屬性
- React props
- React Fiber
- 頁面 store
- 幾何位置（visible media）

問題是：這些來源經常同時包含**目前 Story、鄰居 Story、整個 reel、owner id、collection id**。在沒有穩定 active marker 的情況下，任何「挑一個看起來像的 id」都可能指向錯誤的 Story。

歷史上曾發生**選到相鄰 Story 並下載錯誤內容**的重大 bug。這是本專案的最高優先級正確性問題：**寧可少下載，也不可下載錯的對象。**

### 6.3 影片／音樂／複合 Story

- 影片常以 MSE（Media Source Extensions）或 blob URL 播放，沒有可直接下載的 HTTP URL。
- 音樂／複合 Story 可能包含多層媒體與音訊，單一 media id 也不一定能完整表達。
- 這些案例即使找到 id，也可能只能拿到部分內容或錯誤的 asset。

### 6.4 本穩定期採用的策略

1. 保留**明確 id** 路徑（identity 相對可證明）。
2. 對 username-only **直接拒絕**，不新增任何 ID 猜測。
3. 不改弱 owner 驗證。
4. 不做 Story reel 枚舉。
5. 將所有實驗程式碼完整留在研究分支，而不是刪除。

---

## 7. M8B–M8D 實驗摘要

研究分支：`research/m8b-m8d-instagram-story`
Snapshot commit：`72c590e`（`chore(research): snapshot M8B-M8D Instagram Story experiments`）
基準：`62edb18`（M8A authenticated extension PoC）

| 階段 | 內容                                                                                                            | 狀態                                                       |
| ---- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| M8A  | 三種登入態取得策略（background / isolated / MAIN）、統一 sanitized 結果、隱私邊界                               | 已併入穩定版                                               |
| M8B  | Story feasibility、transport 分類、parser/normalizer、sanitized diagnostics                                     | 部分併入穩定版                                             |
| M8C  | 明確 id Story 下載、統一 popup resolve/download、Story 檔名與時間戳                                             | 已併入穩定版                                               |
| M8D  | current-id 頁面狀態抽取、visible-media fallback、identity sources、owner 驗證、runtime handshake、download flow | 實驗留在研究分支；僅 owner 驗證與 download flow 併入穩定版 |

研究分支中**沒有**併入穩定版的模組：

- `apps/extension/src/story/current-id.ts`（頁面狀態／React／Fiber 抽取）
- `apps/extension/src/story/visible-media.ts`（可見媒體幾何與 MSE 診斷）
- `apps/extension/src/story/identity-sources.ts`（fiber/link/navigation/store 結構診斷）
- `apps/extension/src/story/diagnostic.ts`（M8B feasibility 文字輸出）
- 對應的 `*.test.ts` 與 `m8a`/`story` 實驗測試段落

這些模組只存在於研究分支，**不在 release 分支、不會被 build 進擴充功能**。

---

## 8. 為什麼暫停 username-only Story 調查

1. **正確性優先**：無法穩定證明「目前 active Story」時，任何猜測都可能下載鄰居內容。
2. **成本／效益不佳**：DOM / React / Fiber 結構會隨 Instagram 前端改版；維護成本高且無法保證。
3. **產品風險**：下載錯誤對象比「明確拒絕」更傷信任。
4. **隱私邊界**：越深入頁面狀態，越容易不小心碰到 session／私有資料；現行做法不讀 cookie、不匯出 session。
5. **策略轉向**：下一階段優先做 Threads / Facebook 的 adapter，而不是繼續逆向 Instagram Story。

> 未來若重啟，必須先建立「可證明的 active item」判準與回歸測試，且不得降低 owner 驗證。

---

## 9. 安全、隱私與正確性不變量

**不可妥協：**

1. 不要求、不儲存、不匯出 Instagram 密碼、cookie、token 或 session。
2. 不新增伺服器端登入態下載器或媒體代理。
3. 一次只處理使用者明確提供的一個 URL。
4. 不做 bulk Story enumeration、不爬蟲、不猜測缺失 ID。
5. Story 身分未證明或 owner 不符時，**不得**回傳 asset、不得下載。
6. Web/PWA 不得宣稱 extension-only 能力。
7. 媒體位元組不經過 UniFetch Worker。
8. 不在 log／文件／fixture 保留真實 URL、帳號、media id、caption。
9. 不修改 `cernmeow.com` DNS、custom domain、billing；不碰其他 Cloudflare 專案。
10. `opencode.jsonc` 是本地設定，保持未追蹤、不提交、不刪除。

Extension 額外不變量：

- Required API permissions：`activeTab`、`scripting`、`clipboardRead`、`declarativeNetRequestWithHostAccess`；required host permission 只有 `https://www.instagram.com/*`。optional host permission 只有 `https://www.threads.com/*`，且只從 Threads 的 Resolve/Download 使用者手勢請求。不要求 `cookies`、`tabs`、`history`、`webRequest`、`storage`、`<all_urls>`。
- Instagram 不自行組 `Cookie` 或 `Authorization` header；靠 `credentials: 'include'` 讓瀏覽器附帶 session。
- Threads 所有 metadata 請求使用 `credentials: 'omit'`；不得改用登入態頁面、cookie 或 `chrome.cookies`。DNR session rule 只可修改 `threads.com` 的 navigation headers，不可加 cookie、不可封鎖請求，且每次 acquisition 後移除。
- popup 與 background 的 protocol marker 不一致時，所有動作維持 disabled。
- 不得把「下載 ZIP」描述成「自動安裝」；不得聲稱已上架 Chrome Web Store。
- Release ZIP 只包含 extension runtime，不得包含 source、`node_modules`、環境檔、credentials、`opencode.jsonc` 或研究診斷。

---

## 10. 安裝、建置、測試、部署

### 10.1 環境

- Node.js 22+（本機驗證使用 Node 26）
- pnpm 10.28.2（`packageManager` 已釘住）
- Chromium 118+（extension）
- Cloudflare 帳號（僅部署時需要）

### 10.2 安裝與開發

```sh
pnpm install
cp apps/web/.env.example apps/web/.env.local
# 終端 1
pnpm dev:resolver
# 終端 2
pnpm dev:web
```

`VITE_UNIFETCH_RESOLVER_URL=http://127.0.0.1:8787` 是公開設定，不是 secret。

### 10.3 品質閘門

```sh
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm format:check
git diff --check
```

`pnpm build` 會：

1. `vue-tsc` 型別檢查 Web
2. 建置 `apps/web/dist`
3. 建置 `apps/resolver-worker`（Wrangler dry run）
4. `tsc --noEmit` + esbuild 建置 `apps/extension/dist`

### 10.4 Extension 發佈與載入

本地開發用 `apps/extension/dist`：

```sh
pnpm --filter @unifetch/extension build
# chrome://extensions → Developer mode → Load unpacked → apps/extension/dist
```

每次重建後要按 Reload；popup 會檢查 protocol marker，避免舊 service worker 收到新請求。

正式使用者流程（GitHub Releases，非 Chrome Web Store）：

```sh
# 1. 工作樹必須乾淨；只容許未追蹤的 opencode.jsonc 與 ignored artifacts/
pnpm package:extension
# artifacts/unifetch-chromium-extension-vX.Y.Z.zip
# artifacts/unifetch-chromium-extension-vX.Y.Z.zip.sha256

# 2. 把 SHA-256、size、URL 寫入 apps/web/src/config/extension-release.ts 並 commit
# 3. 先 push 到 origin/main 或 origin/release/instagram-stable
node scripts/release-extension.mjs            # 只驗證，不建立 release
node scripts/release-extension.mjs --publish  # 建立 GitHub Release
```

- ZIP 只有一個頂層資料夾 `unifetch-chromium-extension-vX.Y.Z/`，裡面直接是 `manifest.json`、`background.js`、`popup.html`、`popup.js`；沒有巢狀 `dist/`。
- 打包腳本會拒絕 dirty tree、版本不一致、manifest 引用檔缺失、權限變更、source／環境檔／secret。
- Release 腳本會拒絕既有 tag／release，並要求新打包的 SHA-256 與網站設定一致。
- 安裝頁：`https://unifetch.pages.dev/extension`。沒有已驗證 release 時，頁面會顯示「Release not yet available」，不會給出假下載連結。
- 使用者需自行下載 ZIP、解壓到永久資料夾、開 `chrome://extensions`、啟用 Developer mode、Load unpacked，選到直接含 `manifest.json` 的資料夾。Chromium 會從該資料夾載入，不能刪除。

### 10.5 Web/PWA 部署（已驗證目標）

```sh
VITE_UNIFETCH_RESOLVER_URL=https://unifetch-resolver.cernmeow.workers.dev \
  pnpm --filter @unifetch/web build

WRANGLER_SEND_METRICS=false npx wrangler@4 pages deploy apps/web/dist \
  --project-name unifetch
```

- Pages 專案：`unifetch`
- 正式網域：`https://unifetch.pages.dev`
- 型態：Direct Upload（未接 Git provider）
- 2026-10-23 已以此流程部署，Production alias 已更新；`/`、`/share` 與 `/extension` 均回 `200`。
- 安裝頁只依賴 `apps/web/src/config/extension-release.ts` 的靜態 GitHub Releases URL，不在 runtime 呼叫 GitHub API。
- 先確認 GitHub Release asset 真的存在且 SHA-256 正確，再部署網站；不要讓 `/extension` 指向尚未發佈的檔案。
- **不要**省略 `--project-name`；同帳號還有 `linktree`、`114-514-org` 等其他專案。
- 不要改 DNS、custom domain、billing。

### 10.6 Resolver

目前 production Worker：`unifetch-resolver` → `https://unifetch-resolver.cernmeow.workers.dev`。
本輪**沒有**變更 Resolver 程式，因此不需要重新部署。若未來要部署：

```sh
cd apps/resolver-worker
WRANGLER_SEND_METRICS=false npx wrangler@4 deploy \
  --var ALLOWED_ORIGINS:https://unifetch.pages.dev
```

Resolver 必須保持 metadata-only；不要新增 media route 或 credentials。

### 10.7 部署後檢查

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://unifetch.pages.dev/
curl -sS -o /dev/null -w '%{http_code}\n' https://unifetch.pages.dev/share
curl -sS -o /dev/null -w '%{http_code}\n' https://unifetch.pages.dev/extension
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X OPTIONS \
  -H 'Origin: https://unifetch.pages.dev' \
  -H 'Access-Control-Request-Method: POST' \
  https://unifetch-resolver.cernmeow.workers.dev/api/resolve
```

預期：`200`、`200`、`200`、`204`。

---

## 11. Git 分支與 release 狀態

| 分支                               | 用途                   | 狀態                                       |
| ---------------------------------- | ---------------------- | ------------------------------------------ |
| `main`                             | 正式基線               | `d86080a`（T1D docs），已推送 origin       |
| `feat/threads-local-extension`     | E1 Threads 擴充功能    | 本次工作分支；未合併 main、未發佈          |
| `release/instagram-stable`         | 穩定 Instagram release | 既有 branch，**本輪未修改**                |
| `research/m8b-m8d-instagram-story` | M8B–M8D 實驗完整保存   | snapshot `72c590e`，已推送，不併入 main    |
| `m8a-auth-extension-poc`           | M8A PoC 歷史           | `62edb18`，已推送 origin                   |
| `m8b-story-feasibility`            | M8B 歷史指標           | `62edb18`，保留供對照                      |
| `m8c-extension-story-download`     | 舊工作分支             | `62edb18`；內容已由 research snapshot 保存 |

- 穩定版 baseline commit：`cd73025`（`feat(extension): ship stable Instagram baseline`）。
- M9A 只新增 distribution／installation UX，**未改動 Instagram resolver/download 行為**。
- **M9A 擴充功能發佈（2026-10-23）：**

  | 項目             | 值                                                                                    |
  | ---------------- | ------------------------------------------------------------------------------------- |
  | Version          | `0.2.0`                                                                               |
  | Git tag          | `extension-v0.2.0` → `bfb9c0e`                                                        |
  | GitHub Release   | https://github.com/nasa314159/UniFetch/releases/tag/extension-v0.2.0                  |
  | ZIP              | `unifetch-chromium-extension-v0.2.0.zip`（252,431 bytes）＋ `.sha256` asset           |
  | SHA-256          | `6dcfd8fda34e80c3030762cf2ae576f2f0b29f8d3ee2da9af05351031f2463f3`                    |
  | 安裝頁           | https://unifetch.pages.dev/extension                                                  |
  | Pages Production | deployment `efbf4799-5b8d-4090-8d54-19f6454769ac`，source `7f27c62`；三條路由皆 `200` |

- 已從 GitHub 重新下載 release asset，SHA-256 與上表一致；ZIP 只有 4 個 runtime 檔，根目錄直接含 `manifest.json`。
- 生產環境 `/extension` 已用瀏覽器檢查下載連結、checksum、`chrome://extensions` 複製按鈕與 desktop/mobile 顯示切換；Lighthouse accessibility `0.96`、best-practices `1.00`，剩餘 contrast／accessible-name 問題來自全站既有 header/footer。
- 尚未在真實 Chrome 中重新執行「Load unpacked → 登入 Instagram → 下載」的實機流程；自動測試與 ZIP 驗證不等於瀏覽器安裝成功。

禁止：force push、`git reset --hard`、`git clean -fd`、未確認就刪除未提交工作。

---

## 12. 已知缺陷、風險與延後工作

### 已知限制

- Instagram Story username-only：**不支援**（設計決策）。
- Story Highlights：不支援。
- Story 影片若只有 MSE/blob：不支援。
- 多 item 的 Story 回應：拒絕，不枚舉。
- Extension 尚未上架 Chrome Web Store；只能從 GitHub Releases 下載 ZIP，並以 Developer mode + Load unpacked 手動安裝。
- Extension 不會自動更新；使用者必須手動下載新 ZIP、重新載入。
- 尚未有 extension 的自動 E2E（需要真實 Chrome + Instagram 登入）。
- E1 Threads 的 optional permission 原生 prompt 尚未真人點擊；production build 的「未授權即拒絕」與 helper 測試已通過。
- E1 Threads 只在全新、無登入 cookie 的 profile 對公開樣本驗證成功；需要登入的 Threads 貼文會 typed fail closed，屬預期。
- Instagram 登入態 Post/Carousel/Reel/explicit-id Story 本輪未重跑實機。
- Web/PWA 公開解析仍受 Instagram 反爬／登入牆影響；失敗是預期行為。
- 影片下載仍受 CORS／CDN 政策限制。
- 檔名時間戳依賴回應欄位；不可靠時只放日期，不發明時間。

### 風險

- Instagram 私有 API 隨前端改版；`PARSER_OUTDATED` 可能增加。
- 擴充功能的 MAIN world 注入可能受 CSP 或 Instagram 改版影響。
- 使用者若在錯誤的分頁執行，會得到明確錯誤，而不是猜測內容。
- 部署凭證過期會讓 release 無法更新；屆時需重新 `wrangler login`。

### 延後

- Facebook。
- Threads 擴充功能的正式 v0.3.0 發佈（E1 已完成候選，尚未 publish）。
- Story username-only 的替代方案。
- Chrome Web Store 上架、簽章、自動更新。
- Native runtime。
- 批量下載 UI／ZIP（目前刻意不做）。

---

## 13. 接手 Instagram 的檢查清單

- [ ] 讀 `README.md`、`docs/supported-content.md`、`docs/architecture.md`、`docs/privacy-model.md`、`docs/threat-model.md`。
- [ ] `git status` 確認工作樹乾淨；確認 `opencode.jsonc` 仍是未追蹤且未被刪除。
- [ ] `pnpm install`、`pnpm test`、`pnpm lint`、`pnpm build`、`pnpm format:check` 全綠。
- [ ] 確認目前 branch 是 `main` 或 `release/instagram-stable`，不是 research 分支。
- [ ] 用 `apps/extension/dist` 載入 Chrome，實測 Post / Carousel / Reel。
- [ ] 用含明確 id 的 Story URL 實測圖片與影片各一。
- [ ] 用 `/stories/<username>/` 實測，確認顯示 `UNSUPPORTED_CONTENT` 且沒有下載。
- [ ] 用錯誤 owner 的 mock／fixture 確認 identity 被拒。
- [ ] 確認 Web/PWA 畫面沒有出現 Story 或 extension 宣稱（`/extension` 安裝頁例外，且必須清楚標示 desktop-only 與手動安裝）。
- [ ] 檢查 `apps/web/src/config/extension-release.ts` 的 GitHub Release URL、tag、SHA-256 與 `artifacts/extension-release.json` 一致。
- [ ] 從 GitHub Releases 重新下載 ZIP，驗證 SHA-256，確認解壓後根目錄直接含 `manifest.json`。
- [ ] 部署前確認 `wrangler pages project list` 只操作 `unifetch`。

---

## 14. 未來若要安全恢復 Story 研究

**前提：不要直接改 main；先開研究分支。**

建議流程：

1. 從 `research/m8b-m8d-instagram-story` 開新分支，例如 `research/story-active-item-v2`。
2. 先寫下「可證明的 active item」定義，例如：
   - URL 或 navigation state 中有唯一 active media id，且
   - 該 id 與 API 回應 owner 一致，且
   - 有可重現的 fixture／實機證據。
3. 為「鄰居 Story 不得被選中」建立**負向測試**，再做任何功能。
4. 不得新增：
   - bulk reel 枚舉
   - 猜測／暴力搜尋 id
   - cookie / session 讀取
   - 降低 owner 驗證
5. 所有新 heuristic 必須預設 fail-closed；無法證明就回 `UNSUPPORTED_CONTENT`。
6. 只有在多個真實帳號、多個 Story 位置、圖片與影片都通過後，才考慮合回 release。
7. 若 Instagram 前端結構再次變動，優先移除 heuristic，而不是加更多 heuristic。

---

## 15. Threads / Facebook 下一階段架構提案

**本輪不實作。** 目標是延續現有模組，而不是重寫。

### 15.1 共用 URL 偵測與平台路由

- 在 `packages/core` 擴充 `parseSupportedUrl` 的 host 清單：
  - Threads：`threads.net`、`www.threads.net`、`threads.com`、`www.threads.com`
  - Facebook：`facebook.com`、`www.facebook.com`、`m.facebook.com`（先做公開貼文）
- 保持「只接受單一明確內容 URL」，拒絕 profile、feed、search、share 短連結（或先明確標示未支援）。
- 新增平台無關的 `PlatformAdapter` 介面：
  ```ts
  interface PlatformAdapter {
    readonly platform: 'instagram' | 'threads' | 'facebook';
    parseContentRef(url: string): ContentRef;
    buildMetadataRequest(ref: ContentRef): StrategyRequest;
    parseResponse(raw: unknown, ref: ContentRef): ResolvedPost;
  }
  ```
- Instagram 現有 `meta-resolver/src/instagram` 保持不動，只在外層加 registry；不要為了統一而重寫 Instagram parser。

### 15.2 Resolver adapters

- 每個平台一個 adapter 目錄：`packages/meta-resolver/src/threads`、`.../facebook`。
- Worker 的 `/api/resolve` 增加平台分派，但維持：
  - 4096-byte body limit
  - 單一 URL
  - 固定 upstream 目的地
  - 不轉發 cookie / Authorization
  - `Cache-Control: no-store`
- 若 Threads 公開頁面本身已含足夠 metadata（例如 SSR JSON / Open Graph），優先採**公開、無登入**路徑；不要把登入態需求帶進 Worker。

### 15.3 媒體正規化

- 重用 `MediaAsset`、`ResolvedPost`、`ResolveResult`。
- 圖片／影片 selector 保持「取最高品質、保留 carousel 順序」。
- 影片先只支援直接 HTTP MP4；MSE/HLS 不列入第一版。
- 檔名沿用 `packages/downloader` 的 human-readable policy，不把平台內部 id 放進檔名。

### 15.4 重用既有 downloader

- Web：沿用 `downloadLocalAsset` / `runAssetDownloads` / Save queue。
- Extension：沿用 `download-flow.ts` 與 single-flight guard。
- 不要為 Threads/Facebook 新增第二套下載器。

### 15.5 Web/PWA 與 Extension 的邊界

- Web/PWA：只做**公開**內容；若平台需要登入，顯示明確 `LOGIN_REQUIRED`，不引導使用者輸入帳密。
- Extension：若 Threads/Facebook 的登入態在瀏覽器内可行，才加對應 adapter；仍然不讀 cookie、不匯出 session。
- 不要把 Threads/Facebook 的登入態能力放進 Worker。

### 15.6 隱私與存取控制

- 只處理使用者明確提供的 URL。
- 不枚舉使用者 feed、不抓「所有貼文」、不追蹤帳號。
- 不新增 remote authenticated proxy。
- 所有新平台 adapter 都必須有「拒絕私密／不可存取內容」的 typed error。
- 文件必須清楚標示各平台是公開、登入態或尚未支援。

### 15.7 建議實作順序與驗收標準

**里程碑 T1（建議先做，範圍最小）：Threads 公開單一貼文**

1. URL 偵測 + content-ref parser（含負向測試）。
2. 公開 metadata 取得（優先 SSR/OG；必要時才用固定 profile）。
3. parser/normalizer + fixture。
4. Web 顯示與直接下載（圖片優先）。
5. 錯誤分類與 CORS/no-store。

驗收：

- 至少 3 個公開 Threads 貼文（圖片、影片、多媒體）在實機可解析。
- 不支援的 URL 全部 fail-closed。
- 無 cookie / session 讀取。
- Unit tests 覆蓋 parser、錯誤、URL 邊界。
- Web UI 不宣稱 Threads 已完成，直到上述通過。

**里程碑 T2：Threads 擴充功能（選擇性）**

- 只有在 T1 公開路徑不足時，才評估登入態 adapter。
- 先做 read-only 解析，再做下載。

**里程碑 F1：Facebook 可行性分析（不寫產品程式）**

- 盤點公開貼文／Reel 的 URL 形狀與 SSR metadata。
- 確認是否需要登入、是否有穩定 media URL。
- 評估 CORS、rate limit、法律／ToS 風險。
- 產出 go / no-go 報告，再決定是否開 F2。

**不要做的事：**

- 不要為三個平台做一個大統一 scraper。
- 不要重寫 resolver / downloader。
- 不要為了覆盖率而加入猜測或枚舉。

---

## 16. T1C Threads 公開貼文正式發布現況（2026-10-24）

T1B 實作已由 `feat/threads-public-media` 以 fast-forward 方式合併到 `main`：`6bc2ed9` → `c92d832`。功能分支保留，沒有 rewrite 或 force push。Worker 與 Pages 都已部署到既有正式專案。

### 16.1 正式發布座標

| 項目                   | 值                                                          |
| ---------------------- | ----------------------------------------------------------- |
| T1C release commit     | `c92d832`                                                   |
| 事故修復 commit        | `4df40a1`                                                   |
| Resolver Worker        | `unifetch-resolver`                                         |
| Worker deployment      | `98074334-7a82-4a62-bc50-613b71aaffab`                      |
| Worker version         | `32501ed7-03c9-4dc2-970a-1c9199c5bb18`                      |
| Worker URL             | `https://unifetch-resolver.cernmeow.workers.dev`            |
| 正式 CORS              | 僅 `https://unifetch.pages.dev`                             |
| Pages deployment       | `70db1fd8-de68-48f1-9377-2cc9485c946e`                      |
| Pages deployment alias | `https://70db1fd8.unifetch.pages.dev`（會轉址到 canonical） |
| Pages production URL   | `https://unifetch.pages.dev`                                |
| Extension              | 未變更，`v0.2.0` release asset 重新下載核對 SHA-256 一致    |

事故前 Worker deployment 為 `dcabbaeb-a904-4e9e-ab94-f8b6a80d7270`（version `be1a078c-f101-4d3f-8e5b-270e153f1631`）。T1C 當時的 Pages deployment `75dcedd7-c190-45af-b394-0e3b997b8cb4` 在下一次部署後已不再提供 alias，不可當成穩定的回滾或測試 URL。

T1D 追加座標（Threads 分享連結）：

- T1D code commit：`8b9ac70`
- Worker deployment：`70e2ea05-8271-4f56-a18e-341abd47b9d0`
- Worker version：`14fc412d-9971-491a-a226-76f53d0d556d`
- Pages deployment：`4d5dbc66-05ea-4437-8e3c-59fc54bd58d7`
- Pages alias：`https://4d5dbc66.unifetch.pages.dev`
- 正式 CORS 仍僅 `https://unifetch.pages.dev`

### 16.2 已實作

- `packages/meta-resolver/src/threads/`：content-ref、SSR/Relay parser、GIF embed fallback parser、normalizer、resolver contract、sanitized fixtures。
- `apps/resolver-worker/src/threads-acquisition.ts`：只抓取由已驗證 reference 建構的 canonical Threads URL；`redirect: 'manual'`、`credentials: 'omit'`、10 秒 timeout、4 MiB HTML bound；不抓媒體 bytes。
- Worker 依 `parseSupportedUrl` 分派 Instagram / Threads；Instagram 分支程式碼未改。
- `resolverApiResponseSchema` 允許 `platform: 'threads'`。
- Web client 將 canonical Threads URL 送至 Resolver；Result UI 顯示實際平台、Video/GIF/Carousel，隱私文案不再硬寫 Instagram。
- Downloader 對 `image/gif` 保留原始 bytes 與動畫，不再轉成 JPEG；Instagram 圖片正規化行為不變。
- `HomeView` 將 Threads 標為 public capability；Facebook 仍為 planned；T1C 當時 extension 未加入 Threads host permission（E1 之後在 feature branch 加入 optional permission，尚未發佈）。

### 16.3 正式環境已驗證

- Threads single image：正式 Worker 回傳 JPEG metadata；正式瀏覽器下載得到 JPEG。
- Native video：正式 Worker 回傳 direct MP4；正式瀏覽器可播放（720×1280），另一下載樣本得到可讀 MP4（H.264）。
- Mixed carousel：正式 Worker 回傳 3 個 asset，順序為 video/video/image；正式瀏覽器 Download all 得到 3 個依序命名的檔案（兩個 MP4＋一個 JPEG）。
- Giphy GIF：正式 Worker 回傳 `image/gif`；正式瀏覽器下載得到 136,696-byte、17-frame、259×200 的 animated GIF，未被轉成靜態 JPEG。
- Owner mismatch、`/t/`、profile、search、share URL 都在 Worker 端 typed fail-closed；不可用貼文回 `CONTENT_UNAVAILABLE`。
- CORS preflight 只允許 `https://unifetch.pages.dev`，沒有 wildcard、沒有 `Access-Control-Allow-Credentials`；Worker 未出現在媒體請求路徑。
- `/share?url=…` 會先清除 query、canonicalize Threads URL，再進行解析，最終網址為 `/`。
- `/extension` 可存取並連到既有 `extension-v0.2.0` GitHub Release asset；實測 ZIP SHA-256 與大小仍為 `6dcfd8fda34e80c3030762cf2ae576f2f0b29f8d3ee2da9af05351031f2463f3` / 252,431 bytes。
- `pnpm test` 807 passed（46 files）、`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm format:check`、`git diff --check` 均通過。

### 16.4 生產 Resolve 事故與修復

- 症狀：使用者回報 Instagram 與 Threads 都在 Resolve 階段失敗，尚未出現預覽或下載。
- 重現：`https://75dcedd7.unifetch.pages.dev`（T1C 報告曾列出的 deployment alias）開啟後，兩個平台都顯示 `NETWORK_ERROR`。原因是該 alias origin 不在 Worker `ALLOWED_ORIGINS`，瀏覽器擋掉回應；canonical `https://unifetch.pages.dev` 當時可正常解析。
- 另一個共用風險：舊 service worker 會繼續提供 precached 舊版 shell；T1C 使用 `registerType: 'prompt'`，但 UI 沒有實作更新提示，因此使用者可能長期停留在舊 build。
- 修復：
  - Web 啟動時把 `<8-hex>.unifetch.pages.dev` deployment alias 轉址到 `https://unifetch.pages.dev`，保留 path/query/hash；`/share?url=…` 也因此在 canonical 上完成查詢字串清除。
  - PWA 改為 `registerType: 'autoUpdate'`，新的 service worker 使用 `skipWaiting`/`clientsClaim`；舊 client 可能仍需一次重新載入才會載入新 shell。
  - Worker CORS 維持只有 `https://unifetch.pages.dev`，沒有加入 alias 或 wildcard。
- 修復後正式瀏覽器驗證：canonical 上 Threads 貼文解析成功；Instagram 公開 carousel 解析成功（8 個 metadata assets）。alias `/extension` 與 `/share?...` 都正確轉址到 canonical。

### 16.5 尚未驗證／已知風險

- Instagram 正式 live metadata 在 T1C 初次檢查時曾回 `LOGIN_REQUIRED`，事故修復後重新檢查同類公開 carousel 已成功；上游可用性仍會變動，遇到 `LOGIN_REQUIRED` 屬於來源限制，不是 CORS/schema 錯誤。
- 未在真實 Chrome 重新執行 extension「Load unpacked → Instagram 登入 → 下載」流程；extension 本次未變更。
- GIF 僅支援已測 Giphy attachment；embed 可能只提供 200px 高度變體，且未驗證 animated WebP 或其他 GIF provider。
- 未支援 `/t/` 短連結、非 post 的 `/share/` 路徑、profiles、search、replies、quoted/reposted substitution、private/login、audio-only、HLS/DASH-only video。官方 `/share/<token>/` 已在 T1D 支援。
- Threads SSR/Relay 與 GIF embed 都是平台內部格式；未來變動時應 fail closed，不要加猜測 fallback。
- 大型 native video（>5 MiB）在此瀏覽器自動化環境下載擷取失敗，但同一來源的 1.37 MiB MP4 下載成功；較大影片的實體下載仍應由真人裝置補測。

### 16.6 安全邊界

- 只處理使用者明確提供的一個 canonical public post URL。
- Worker 不轉發 Cookie/Authorization，不抓媒體，不代理媒體。
- Parser 同時要求 shortcode 與 publisher username；不遍歷 related/quoted/replies。
- GIF fallback 只接受 exact-post embed 內、HTTPS、`*.giphy.com/*.gif` 的 direct URL；placeholder/OG 不得當成 GIF。
- 無 persistent history、cache、KV/R2/D1 或 analytics；正式頁面實測 `document.cookie`、localStorage、sessionStorage 均為空。

### 16.7 T1D Threads 分享連結與 Instagram 上游限制

- Threads 官方 `/share/<token>/`：只有在帶瀏覽器導覽標頭（`Sec-Fetch-Mode`/`Sec-Fetch-Site` 等）時，上游才回 `302` 到 canonical post；沒有這些標頭時回 `200` 一般 HTML。Worker 以既有 `CloudflareThreadsAcquisitionAdapter` 發出一次受限 GET，`redirect: 'manual'`、10 秒 timeout、不帶 credentials，只接受同源 HTTPS 且路徑精確為 `/@<username>/post/<shortcode>/` 的 `Location`；`xmt` query 會丟棄，之後沿用既有 exact-post parser、publisher 檢查、GIF embed fallback 與 normalizer。
- 惡意／畸形 token 在發出任何請求前就以 `INVALID_URL`/`UNSUPPORTED_CONTENT` 拒絕；登入導向回 `LOGIN_REQUIRED`；跨網域、非 post、額外路徑一律 fail closed。canonical Threads permalink 行為不變。
- 正式驗證：兩個不同的公開 share URL 都成功展開並解析；同一個 canonical permalink 仍成功；畸形 token 回 `INVALID_URL`；指向無可下載媒體貼文的 share 連結回 `UNSUPPORTED_CONTENT`。正式瀏覽器（`https://unifetch.pages.dev`）可解析 share URL 並顯示預覽尺寸，canonical 與 typed error 也正常。
- Instagram：以 production edge 診斷確認 bootstrap 仍為 `200` 且取得 CSRF，但固定公開 metadata query 回 HTTP `401` JSON，分類為 `LOGIN_REQUIRED`；同一請求從住宅網路可成功。這是 Cloudflare egress 的匿名上游限制，不是 parser/CORS/service worker/部署缺陷。**Web/PWA Instagram 公開 Post/Carousel/Reel 尚未恢復**；不得為此放寬身分驗證或加入需要使用者 session 的 Web 抓取。Chromium extension 的登入態 Post/Carousel/Reel 與 explicit-id Story 不受影響。

---

## 17. E1 Threads 本機擴充功能（2026-10-24，候選未發佈）

### 17.1 狀態與範圍

- 分支：`feat/threads-local-extension`，從 `main` `d86080a` 開出。**未合併 `main`、未修改 `release/instagram-stable`、未建立 `extension-v0.3.0` tag/release。**
- 擴充功能原始碼版本：`0.3.0` 候選；`apps/web/src/config/extension-release.ts` 仍指向已驗證的 `v0.2.0` asset。
- `extension-v0.2.0` ZIP、SHA-256、GitHub Release 與 `/extension` 安裝連結**完全未變**，可作為回滾基準。
- 支援：公開 Threads 單圖、圖片 carousel、原生 MP4、混合 image/video carousel、已測 Giphy GIF、官方 `/share/<token>/`。Canonical 與 share 都沿用既有 `packages/meta-resolver/src/threads/` parser、publisher/shortcode 驗證、share-location 驗證、GIF embed fallback 與 normalizer，沒有在 extension 內重寫一套 Threads parser。
- 不支援：private/login-required、profile/search/`/t/`、非 post share、audio-only、quoted/reposted substitution、任意枚舉、HLS/DASH 或轉碼。

### 17.2 擴充功能架構

```text
popup（Instagram / Threads 平台路由）
  → background service worker
  → Instagram：既有 background → isolated → MAIN 策略，credentials: include
  → Threads：threads/acquisition.ts
       - 只建構 https://www.threads.com/@user/post/code/、/embed、/share/token/
       - credentials: 'omit'、redirect: follow、cache: no-store、10 秒 timeout
       - 4 MiB HTML 上限、官方 origin／path 驗證
       - share 只接受瀏覽器跟隨後的最終 canonical post
  → 既有 Threads parser/share validator/GIF fallback/normalizer
  → 共用 downloader（直接 CDN → 使用者裝置）
```

Threads 的 SSR metadata 只對「navigation-like」請求提供；一般 browser fetch 會收到精簡 shell。E1 使用 `threads/header-rule.ts` 安裝一個 **session-scoped** `declarativeNetRequestWithHostAccess` 規則，只對 extension 發往 `threads.com` 的請求設定 `Sec-Fetch-Dest/Mode/Site/User` 與 `Upgrade-Insecure-Requests`。規則不新增 cookie、不封鎖請求，acquisition 結束後移除。實際 request 仍是 `credentials: 'omit'`；已用「預先放入 Threads cookie」的測試確認 request 沒有 `Cookie` header，cookie 也沒有被修改。

### 17.3 權限模型

| 類型          | 值                                                                               | 說明                                                |
| ------------- | -------------------------------------------------------------------------------- | --------------------------------------------------- |
| Required API  | `activeTab`, `scripting`, `clipboardRead`, `declarativeNetRequestWithHostAccess` | 與 v0.2.0 相比新增 DNR；只做上述 navigation headers |
| Required host | `https://www.instagram.com/*`                                                    | 與 v0.2.0 相同                                      |
| Optional host | `https://www.threads.com/*`                                                      | 只在 Threads Resolve/Download 的使用者手勢中請求    |
| 未要求        | `cookies`, `tabs`, `history`, `webRequest`, `storage`, `<all_urls>`              | 不得新增                                            |

普通 Instagram 操作不會觸發 Threads optional permission。若使用者拒絕，popup/background 回 `PERMISSION_REQUIRED`，不會擴大權限或退回其他 host。

### 17.4 已做的主動驗證

- 使用 **Chrome for Testing + 全新 profile**（`Network.getAllCookies` 確認 threads/instagram cookies 為空）載入本機 extension build。為了在 headless 環境避開原生 optional-permission prompt，測試 build 將 `threads.com` 暫時列為 required host；程式碼路徑與 production 相同。
- 匿名公開樣本（不留 ID 於文件）實際檔案落地：
  - Threads 單圖 → JPEG，1080×1350。
  - 混合 carousel → 3 個 ordered 檔案：MP4、JPEG、JPEG。
  - 原生影片 → MP4，634,607 bytes。
  - 官方 share link → 圖片 JPEG 與另一支 MP4（25,692,320 bytes）。
  - Giphy GIF → GIF89a，360×200，47 frames，1,336,302 bytes，未被轉成 JPEG。
- 下載後 `chrome.declarativeNetRequest.getSessionRules()` 為空，確認 header rule 已移除。
- 有 cookie 的測試：acquisition request 無 `Cookie` header，cookie 保持原值。
- 另以 **production optional-permission build** 確認未授權時 background 回 `{ error: 'PERMISSION_REQUIRED', platform: 'threads' }`。
- 自動化：`pnpm test`、`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm format:check`、`git diff --check` 全部通過（實際數字見本次 commit 的 CI/終端輸出）。

### 17.5 尚未物理驗證

- **Optional permission 原生 prompt 未真人點擊**：headless 無法處理 native prompt；grant/deny 邏輯由單元測試覆蓋，production build 的「未授權即拒絕」已實測。發佈前仍需真人在 Chrome 點一次 Allow，再重跑一個 Threads 下載。
- **Instagram 登入態 Post/Carousel/Reel/explicit-id Story 未重跑**：本環境沒有登入態 Instagram session。自動測試與既有 regression tests 通過，且 local extension 對 Instagram demo URL 仍走原路徑並回 typed error；不可宣稱 live Instagram 成功。
- 未測未登入/登入 Threads 的「同一 public post 但上遊只給登入使用者」差異；E1 一律 `credentials: 'omit'`，因此這種貼文會 typed fail closed，這是預期行為。

### 17.6 v0.3.0 發佈步驟（尚未執行）

1. 在 `feat/threads-local-extension` 完成 review；必要時修正後重跑全部 gates。
2. 合併到 `main`（或依政策先合併到 `release/instagram-stable`），**不要覆寫既有 tag/release**。
3. 在乾淨的 `main` 或 `release/instagram-stable` 執行 `pnpm package:extension`，取得 `artifacts/unifetch-chromium-extension-v0.3.0.zip` 與 `.sha256`。
4. 將 version、tag、fileName、downloadUrl、sha256、sizeBytes 更新到 `apps/web/src/config/extension-release.ts` 並 commit。
5. 先 push，再執行 `node scripts/release-extension.mjs` 驗證；確認無誤後才 `--publish`。
6. 從 GitHub 重新下載 asset，核對 SHA-256 與 size；再重新 build/deploy Pages，讓 `/extension` 指向 v0.3.0。
7. 真人工 Chrome 檢查：optional permission Allow/Deny、Threads 圖片／carousel／影片／GIF／share、Instagram Post/Reel/explicit-id Story，以及 `/stories/<username>/` fail closed。

回滾：保持 `extension-v0.2.0` release 不動；若 v0.3.0 有問題，將 `extension-release.ts` 指回 v0.2.0 asset 並重新部署 Pages，使用者重新下載 v0.2.0 ZIP 或保留舊 unpacked 資料夾。

---

## 18. 相關文件

- `README.md` — 產品與快速開始
- `docs/supported-content.md` — 各平台／runtime 能力矩陣
- `docs/architecture.md` — 模組邊界與資料流
- `docs/privacy-model.md` — 隱私與信任邊界
- `docs/threat-model.md` — 威脅與緩解
- `docs/deployment.md` — Pages / Worker / extension 部署
- `docs/batch-downloads.md` — 批次下載與 iOS Save queue
- `docs/ios-shortcut.md` — iOS 分享捷徑

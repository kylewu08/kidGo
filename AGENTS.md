<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# KidGo — 專案憲法

> 唯一的需求源頭是 [`docs/設計架構書-v1.0.md`](docs/設計架構書-v1.0.md)，本檔案只是它的可執行摘要。
> **兩者衝突時以設計架構書為準，並開一個 commit 修正本檔案。**
>
> **例外**：個別決定可被 ADR 明文推翻，此時以 ADR 為準。見 [`docs/adr/README.md`](docs/adr/README.md)。
>
> ⚠️ **本專案在 2026-08-25 從設計架構書 v0.2 換到 v1.0**（[ADR-0008](docs/adr/0008-adopt-spec-v1.md)）。
> 程式碼裡仍有依 v0.2 實作、尚未遷移的部分——**動手前先讀 ADR-0008 的對照表**，
> 那裡列明了哪些可沿用、哪些直接衝突。ADR 0001–0007 引用的節號屬於 v0.2，
> 原文在 [`docs/archive/`](docs/archive/)。

## 這是什麼

「這個週末帶小孩去哪」的決策引擎。輸入當下條件，輸出一到三個具體答案。

**不是**景點資料庫。收錄數量永遠不是成功指標，判斷的準確度才是。

**主要介面是週末早晨的一則推播，不是一個等待被開啟的 App。**
週六早晨的真實替代方案是「憑習慣決定」——摩擦力為零。
任何需要主動開啟的工具都在與零摩擦競爭。App 的角色是設定介面與回饋介面。

## 九條原則

| # | 原則 | 實務意涵 |
|---|------|----------|
| P1 | **零建檔啟動** | 使用者不手動建立地點。初始輸入僅住家地址與小孩生日 |
| P2 | **不打開也有用** | 任何「必須開啟 App 才能獲得的價值」都是設計失誤 |
| P3 | 答案優先，非清單 | 輸出是決定，不是選項集合 |
| P4 | 窄而深 | 匯入全臺資料，推薦只看住家直線半徑內的地點（[ADR-0009](docs/adr/0009-import-radius-not-counties.md)、[ADR-0017](docs/adr/0017-radius-as-query-filter.md)） |
| P5 | 紀錄是長期資產 | 永不刪除，但它是慢變數 |
| P6 | AI 只提議，不決定 | 見下節 |
| P7 | 決策邏輯可讀可測可改 | 評分規則是本產品最有價值的資產 |
| P8 | 誠實不可交易 | 推薦排序永不接受付費影響 |
| P9 | 離線可用 | 核心資料本地優先 |

## AI 的使用判準（最重要的架構約束）

判準不是「在哪一層」，而是**輸出的性質**：

> **AI 的輸出必須是「對設定的提議」或「對輸入的轉譯」，永遠不能是「對排序的決定」。**

| 性質 | 例子 | |
|------|------|---|
| 對輸入的轉譯 | 「今天外婆一起去」→ 放寬家長負擔上限 | ✅ 引擎仍為純函式，只是參數不同 |
| 對設定的提議 | 「建議調降家長負擔上限」→ 待人核可 | ✅ 人為最終決定者，可追溯可撤回 |
| 對排序的決定 | 「把這 8 個候選重排」 | ❌ 不可重現、無法除錯、紀錄無法回饋 |

具體規則：

- **`lib/ai/` 與 `lib/recommend/` 必須互不 import。** 由 `eslint.config.mjs` 的
  `no-restricted-imports` 強制，違反會 lint 失敗。這不是慣例，是編譯期約束。
- **AI 輸出須經型別與範圍驗證後才可進入推薦條件**，禁止直接傳入。
  超出允許範圍的值一律丟棄。
- 一次性情境輸入（§8）是 AI 唯一進入即時路徑的位置，但它處理的是**輸入**：
  僅能覆寫既有條件（家長負擔上限、可用時間窗、車程上限、避開人多、放電強度上限），
  **不得新增評分因子、不得直接影響排序**，且僅對本次有效。
  無法解析時照常執行，不得中斷流程。
- 推播文案與推薦理由**共用同一組規則模板，不使用 AI 生成**。

## 十條不可違反的約束（§13.2）

1. 推薦引擎為純函式：不讀資料庫、不呼叫網路、不依賴 UI 狀態
2. AI 相關模組不得被推薦引擎引用（lint 強制）
3. AI 輸出須經驗證後才可進入推薦條件
4. **適齡判斷在硬過濾階段**，不得移至評分扣分
5. **小孩約束邏輯獨立於當日推薦引擎**，供未來過夜模式共用
6. **除兩項回饋外，造訪紀錄所有欄位皆為選填**
7. **基準車程不得由使用者手動輸入**
8. **第二則推播須在通知內完成回饋**，不得實作為導流通知
9. 推播文案使用規則模板，不使用 AI 生成
10. 門檻值、權重、係數集中管理

> 第 1 條的理由有二：調權重是長期工作，沒有測試會越調越亂；
> 且**推播需在伺服器端於無使用者互動下執行**，任何對 UI 狀態的依賴都會讓這個形態不成立。

## 推薦流程

三段式：硬性過濾 → 加權評分 → 多樣性調整。

- Stage 1 門檻集中於 `lib/recommend/thresholds.ts`
- Stage 2 權重集中於 `lib/recommend/weights.ts`
- **不要把門檻或權重寫死在 `filters.ts` / `scoring.ts` 裡**
- 多小孩：對每個小孩獨立算分，取**最低分**而非平均（刻意的保守設計）
- 歷史成效固定 5%，紀錄筆數少的階段不得調高
- **車程去程與回程必須分開計算**，不可假設相同——「能否在午睡前返家」依賴回程
- 即時路況僅對硬過濾後存活的前 8 名查詢；失敗時降級為係數估算並**明示信心度**，
  不得靜默使用低信心估值

**防同溫層機制不得移除**（§7.4）：偏好學習會持續壓低不偏好的類別，
使得雨天——正是最需要室內選項的時刻——系統手上只剩從未驗證的牌。
探索槽是保險費不是缺陷；長期未被採納可降低頻率，但不得完全關閉。

## v1 明確不做

註冊/多租戶/權限、社群/評論/分享、業者後台、任何形式的廣告、
**以 LLM 直接產生推薦排序**、業者付費上架。

## 開發時的行為要求

1. **先討論再改資料模型。** 領域概念的定義是本產品的核心差異化。
   認為某個設計有問題就提出討論，不要自己改。
2. **偏離設計架構書時要說出來。** 先講、讓人決定，再寫 code，並補一份 ADR。
3. **推薦引擎的每一條規則都要有對應測試。** 見 `CONTRIBUTING.md`。
4. **不要一次生成全部 Phase 1。**

commit 訊息與 ADR 的規則見 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 目前狀態（2026-08-26）

從 v0.2 遷移到 v1.0，**決策層已完成**。對照表在 [ADR-0008](docs/adr/0008-adopt-spec-v1.md)。

| 區域 | 狀態 |
|------|------|
| `lib/db/`、`lib/domain/` | ✅ v1.0。11 張表、§11 的領域參數 |
| `lib/recommend/` | ✅ v1.0。三階段、七因子、防同溫層、理由分流 |
| `lib/weather/`、`lib/routes/`、`lib/schedule/` | ✅ 未受影響 |
| `app/settings/` | ✅ 出發點與小孩設定沿用 |
| **匯入器** | 🔜 **下一項**。Phase 1 的起點（§13.1） |
| 家庭偏好 UI（初始三題） | 🔜 schema 已就位，缺畫面 |
| 推播、落地頁 | 🔜 尚未開始 |
| 部署 | 📋 方案已定（[ADR-0015](docs/adr/0015-reuse-ghcr-watchtower-pipeline.md)），延後至匯入器完成後 |

`npm test` 221 個全過、`npm run lint` 無警告、`npx tsc --noEmit` 無錯、`npm run build` 成功。
資料庫目前有出發點與一位小孩，**沒有地點**（等匯入器）。

### 下一步：開放資料匯入器（§10.1）

1. 下載五類開放資料（遊戲場清冊、親子館、公園設施、觀光景點、圖書館）
2. 正規化並套用 `lib/domain/category-priors.ts` 的先驗值，全部標 `category_prior`
3. 全臺照收，**半徑不在匯入階段篩**——匯入器與住家位置無關，
   半徑是查詢時的條件（[ADR-0017](docs/adr/0017-radius-as-query-filter.md)）
4. **重複匯入必須冪等**，且不得覆蓋 `fieldSources` 非 `category_prior` 的欄位
   （規則見 [`docs/資料模型草案.md`](docs/資料模型草案.md) §7）
5. 匯入階段**不呼叫 Google**（[ADR-0013](docs/adr/0013-geometric-baseline-drive-estimate.md)）

之後：家庭偏好三題 → 推播 → 落地頁。

### 兩個已知的規格缺口（[ADR-0016](docs/adr/0016-spec-gaps-found-in-implementation.md)）

實作 Stage 1 時發現，都需要改資料模型所以尚未動手。

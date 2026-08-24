<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# KidGo — 專案憲法

> 本檔案是給 AI 協作工具與新加入開發者的第一份文件。
> 唯一的需求源頭是 [`docs/設計架構書.md`](docs/設計架構書.md) v0.2，本檔案只是它的可執行摘要。
> **兩者衝突時，以設計架構書為準，並且要開一個 commit 修正本檔案。**
>
> **例外**：設計架構書的個別決定可以被 ADR 明文推翻，此時以 ADR 為準。
> 目前已被推翻的部分見 [`docs/adr/README.md`](docs/adr/README.md) —— §9（車程改接即時路況）、
> §5.4（HomeBase 增加縣市欄位）、§2 與 §6.2 的午睡矛盾。
> 設計架構書本身尚未同步更新。

## 這是什麼

「這個週末帶小孩去哪」的決策引擎。給定「天氣 × 小孩作息階段 × 車程上限 × 現在幾點」，
直接回答一到三個具體答案，而不是列出五十個選項讓使用者自己篩。

**不是**一個追求收錄完整的景點資料庫。收錄數量永遠不是 KPI。

## 七條設計原則（所有實作決策以此為準）

| # | 原則 | 實務意涵 |
|---|------|----------|
| P1 | 個人優先，非平台 | 不做 UGC、社群、評論、帳號系統 |
| P2 | 答案優先，非清單 | 首頁是「今天建議去 X」，不是搜尋框 |
| P3 | 窄而深，非廣而淺 | v1 只收 40–60 個開發者實際會去的地點 |
| P4 | 紀錄是長期資產 | `Visit` append-only，永不刪除 |
| P5 | 誠實不可交易 | 推薦排序永不接受付費影響 |
| P6 | 離線可用 | 核心資料本地優先 |
| P7 | 決策邏輯可讀可測 | 評分規則以程式碼存在，不得外包給黑箱模型 |

## AI 的使用邊界（最重要的架構約束）

```
資料層  ✅ 使用 AI    建檔、抽取結構化欄位
決策層  ❌ 禁用 AI    確定性評分函式，可測試、可調參、可除錯
呈現層  ✅ 使用 AI    將分數翻譯成人話（不得改變語意、不得新增理由）
```

具體規則：

- **`lib/ai/` 與 `lib/recommend/` 必須互不 import。** 已由 `eslint.config.mjs` 的
  `no-restricted-imports` 強制，違反會 lint 失敗。這不是慣例，是編譯期約束。
- 推薦排序**永遠**由 `lib/recommend/` 的純函式產生。
- `Recommendation.reasons` 由 `lib/recommend/reasons.ts` 的規則模板產生。
  呈現層的 LLM 可以潤飾句子，**不得改變語意，不得新增規則未產生的理由**。
- AI 建檔的產出永遠是**草稿**，必須經人工逐欄位確認才入庫。
  `driveMinutes` / `personalRating` / `sweetSpotAge` 三個欄位 **LLM 不得填寫**。
- AI 對不確定的欄位必須留 `null`，**不得猜測**。寧可空著讓使用者填。

> **量測 vs 猜測的區別**（ADR-0005）：上面那條禁令針對的是 LLM。
> Google Routes API 可以填 `driveMinutes`，因為它拿到 HomeBase 的實際座標，
> 回傳的是量測值不是猜測。`fieldSources` 用 `routes_api` 與 `ai_suggested` 區分，
> UI 不該把這兩種來源標成一樣的可信度。

理由見 [ADR-0002](docs/adr/0002-no-llm-in-decision-layer.md)。

## 推薦引擎的形狀

```ts
export function recommend(
  places: Place[],
  visits: Visit[],
  context: RecommendContext,
): Recommendation[]
```

**無副作用、不讀資料庫、不呼叫網路。** 這是為了讓演算法能單獨寫單元測試——
調權重是長期持續的工作，沒有測試會越調越亂。

- Stage 1 門檻值集中於 `lib/recommend/thresholds.ts`
- Stage 2 權重集中於 `lib/recommend/weights.ts`
- **不要把門檻值或權重寫死在 `filters.ts` / `scoring.ts` 裡。**
- 多小孩情境：對每個小孩獨立算分，取**最低分**而非平均（刻意的保守設計）
- 歷史成效權重固定 5%，**紀錄筆數少於 20 筆前不得調高**
- 即時路況透過 `context.liveDriveMinutes` 傳入，**缺席即退回 `Place.driveMinutes`**。
  這不是錯誤處理，是 P6 的保證：離線時功能不中斷，只是精度下降（ADR-0005）。

## v1 明確不做

註冊/多租戶/權限、社群/評論/分享、業者後台、全台景點爬蟲、
行程規劃（多點串接）、任何形式的廣告、**以 LLM 直接產生推薦排序**。

> 反模式警告：一旦開始追求「收錄全台景點」，這個專案就死了。
> AI 輔助建檔是用來降低 50 筆的成本，不是用來擴張到 5000 筆。

## 開發時的行為要求

1. **先討論再改資料模型。** `Place` 的欄位定義是本產品的核心差異化，不是隨意的技術選擇。
   若你認為某個欄位設計有問題，**提出討論，不要自己改**。
2. **偏離設計架構書時要說出來。** 碰到文件沒寫到的取捨，先講、讓人決定，再寫 code。
3. **推薦引擎的每一條規則都要有對應測試。** 見 `CONTRIBUTING.md`。
4. **一次做一個 Phase。** 目前在 Phase 1，順序：schema → 天氣 → 推薦引擎（含測試）→ UI → seed。

commit 訊息與 ADR 的規則見 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

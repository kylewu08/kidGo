# `lib/ai/` — 資料層的 AI 使用

這個資料夾裡的程式碼負責 **AI 輔助建檔**（設計架構書 §7）：
輸入地點名稱，抽取 `Place` 的結構化欄位草稿。

Phase 2 才實作。目前是空的。

## 這個資料夾的三條硬性規則

1. **不得被 `lib/recommend/` import，也不得 import `lib/recommend/`。**
   由 `eslint.config.mjs` 強制，違反會 lint 失敗。理由見
   [ADR-0002](../../docs/adr/0002-no-llm-in-decision-layer.md)。

2. **產出永遠是草稿，不得直接入庫。** 必須經 UI 逐欄位人工確認，
   確認後 `fieldSources` 才從 `ai_suggested` 改為 `ai_confirmed` 或 `manual`。

3. **以下欄位 AI 不得填寫：**
   - `driveMinutes` — AI 不知道你家在哪，也不含找車位的時間
   - `personalRating` — 這是主觀評價
   - `sweetSpotAge` — 這是關於你小孩的判斷，不是關於地點的事實

## 還有一條態度上的規則

**不確定的欄位必須留 `null`，不得猜測。**
寧可空著讓使用者填，也不要填一個看起來合理的錯值——
錯值會混進資料庫而且無法追查，空值不會。

`energyBurn` 與 `typicalDurationMin` 若無明確依據，一律 `null`。

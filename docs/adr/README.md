# 架構決策紀錄（ADR）

每份文件記錄一個「有替代方案被否決」的決定，以及當時的理由。

**寫作判準與流程見 [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) §2。**

ADR 一旦寫下就不修改內容。決定變了就寫新的一份，把舊的狀態改為
`已被 ADR-XXXX 取代`——想法的演變過程本身就是資訊。

| # | 決定 | 狀態 | 日期 |
|---|------|------|------|
| [0001](0001-sqlite-over-cloud-db.md) | 資料庫用本地 SQLite，不用 Supabase / Postgres | 已採納 | 2026-08-23 |
| [0002](0002-no-llm-in-decision-layer.md) | 決策層禁用 LLM，推薦排序由確定性純函式產生 | 已採納 | 2026-08-23 |
| [0003](0003-pwa-over-native-app.md) | 做 PWA，不做原生 App | 已採納 | 2026-08-23 |
| [0004](0004-nap-conflict-scores-not-filters.md) | 午睡衝突是扣分（15 分）不是剔除，解決 §2 與 §6.2 的矛盾 | 已採納 | 2026-08-24 |
| [0005](0005-live-traffic-over-manual-drive-times.md) | 接 Google Routes API 取即時路況，**推翻設計架構書 §9** | 已採納 | 2026-08-24 |
| [0006](0006-homebase-stores-county.md) | HomeBase 增加 cwaCountyName 欄位 | 已採納 | 2026-08-24 |
| [0007](0007-unused-place-fields-in-scoring.md) | energyBurn / personalRating / crowdLevel 等核心欄位未進入評分 | **提議中** | 2026-08-24 |

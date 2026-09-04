# 架構決策紀錄（ADR）

每份文件記錄一個「有替代方案被否決」的決定，以及當時的理由。

**寫作判準與流程見 [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) §2。**

ADR 一旦寫下就不修改內容。決定變了就寫新的一份，把舊的狀態改為
`已被 ADR-XXXX 取代`——想法的演變過程本身就是資訊。

> **⚠️ 0001–0007 引用的是設計架構書 v0.2 的節號**，該版本已被 v1.0 取代
> （[ADR-0008](0008-adopt-spec-v1.md)）。對不上的節號請到
> [`../archive/`](../archive/) 查閱 v0.2 原文。

| # | 決定 | 狀態 | 日期 |
|---|------|------|------|
| [0001](0001-sqlite-over-cloud-db.md) | 資料庫用本地 SQLite，不用 Supabase / Postgres | 已採納 | 2026-08-23 |
| [0002](0002-no-llm-in-decision-layer.md) | 決策層禁用 LLM，推薦排序由確定性純函式產生 | 已採納 | 2026-08-23 |
| [0003](0003-pwa-over-native-app.md) | 做 PWA，不做原生 App | 已採納 | 2026-08-23 |
| [0004](0004-nap-conflict-scores-not-filters.md) | 午睡衝突是扣分（15 分）不是剔除，解決 §2 與 §6.2 的矛盾 | 已採納 | 2026-08-24 |
| [0005](0005-live-traffic-over-manual-drive-times.md) | 接 Google Routes API 取即時路況，**推翻設計架構書 §9** | 已採納 | 2026-08-24 |
| [0006](0006-homebase-stores-county.md) | HomeBase 增加 cwaCountyName 欄位 | 已採納 | 2026-08-24 |
| [0007](0007-unused-place-fields-in-scoring.md) | energyBurn / personalRating / crowdLevel 等核心欄位未進入評分 | 已被 ADR-0008 結案 | 2026-08-24 |
| [0008](0008-adopt-spec-v1.md) | **改採設計架構書 v1.0，以演進而非重寫遷移**（含 v0.2 → v1.0 對照表） | 已採納 | 2026-08-25 |
| [0009](0009-import-radius-not-counties.md) | 匯入全臺資料，只對住家直線半徑內的地點算基準車程 | 已採納（計算方式被 0013、分層方式被 0017 取代） | 2026-08-25 |
| [0010](0010-deploy-on-synology-nas.md) | 部署在自有 Synology NAS，SQLite 保留 | 已採納（DDNS/憑證/CGNAT 三項待辦被 0015 作廢） | 2026-08-25 |
| [0011](0011-push-spec-revisions.md) | 推播規格四項修訂：理由分流、「沒去」拆分、第二則雙用途、帶連結 | 已採納 | 2026-08-25 |
| [0012](0012-home-location-by-township-dropdown.md) | 住家用縣市／鄉鎮下拉，不接 Geocoding API | 已採納（第一階段） | 2026-08-25 |
| [0013](0013-geometric-baseline-drive-estimate.md) | 基準車程改為自算幾何估計，匯入階段不呼叫 Google | 已採納（「刻意低估」的指引被 0014 修正） | 2026-08-25 |
| [0014](0014-data-model-decisions.md) | 資料模型的五項取捨定案 | 已採納 | 2026-08-25 |
| [0015](0015-reuse-ghcr-watchtower-pipeline.md) | 沿用既有 GHCR + Watchtower 管線；**SQLite 必須掛持久卷** | 已採納（實作延後） | 2026-08-26 |
| [0016](0016-spec-gaps-found-in-implementation.md) | 實作 Stage 1 時發現的兩個規格缺口（需預約、避開人多） | **提議中** | 2026-08-26 |
| [0017](0017-radius-as-query-filter.md) | 半徑改為查詢時的篩選條件，匯入器不依賴住家位置 | 已採納 | 2026-08-26 |
| [0018](0018-quick-marking-not-preference-swiping.md) | 做「快速標記」掛在推播回饋之後，不做獨立的偏好滑卡 | 已採納 | 2026-08-28 |
| [0019](0019-per-row-admission-test-northern-taiwan.md) | 匯入改為逐筆入場測試，範圍限北部四縣市 | 已採納 | 2026-08-28 |
| [0020](0020-library-admitted-on-category.md) | 圖書館加入類別豁免清單，並改寫該清單的判準 | 已採納 | 2026-08-29 |
| [0021](0021-reference-note-for-transient-rejections.md) | 輸出增加「參考欄」，只收當日條件造成的剔除 | 已採納 | 2026-08-29 |
| [0022](0022-docker-hub-over-ghcr.md) | 映像改推 Docker Hub，因為 DSM 憑證對 compose 無效 | **已被 0023 取代**（尚未實際部署過） | 2026-08-31 |
| [0023](0023-public-image-without-source.md) | **映像公開但不含原始碼，回到 GHCR**（多階段建置） | 已採納 | 2026-09-01 |
| [0024](0024-manual-places-allowed.md) | 允許手動新增地點，但覆蓋率診斷只計算匯入資料 | 已採納 | 2026-09-01 |
| [0025](0025-attention-span-caps-stay.md) | 停留時長由小孩的專注度封頂 | 已採納 | 2026-09-02 |
| [0026](0026-day-intent.md) | 加入「今天想去哪一類」，用選項不用 AI | 已採納（ADR 內文寫「尚未實作」，實作於 `af443b4`） | 2026-09-02 |
| [0027](0027-museums-admitted.md) | 觀光景點只收博物館，museum 加入豁免清單 | 已採納 | 2026-09-02 |
| [0028](0028-proximity-supply-diagnosis.md) | 加入住家半徑內的供給診斷，停止條件補上「每個類別至少 2 個候選」 | 已採納 | 2026-09-04 |
| [0029](0029-service-worker-for-push-only.md) | Service Worker 只負責推播，不做離線快取 | 已採納 | 2026-09-04 |

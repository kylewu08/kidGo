# ADR-0023：映像公開但不含原始碼，回到 GHCR

- **狀態**：已採納
- **日期**：2026-09-01
- **相關**：[ADR-0015](0015-reuse-ghcr-watchtower-pipeline.md)、[ADR-0022](0022-docker-hub-over-ghcr.md)
- **取代**：[ADR-0022](0022-docker-hub-over-ghcr.md)（Docker Hub 那個決定尚未實際部署過就被取代）

## 背景

ADR-0022 記錄了死結：**DSM 的登錄檔憑證不會傳給 `docker compose`**，
所以 NAS 拉不到私有映像；而唯一乾淨的解（在 NAS 上跑一次 `docker login`）
需要 SSH，也就需要與 NAS 同網段——使用者的 Mac 在 `192.168.0.x`、
NAS 在 `192.168.1.x`，當下走不通。

ADR-0022 選了「改推 Docker Hub」，並誠實寫明那是賭 Synology 的程式路徑不同，
不是確定可行。

## 使用者提出的關鍵問題

> 為什麼 07 可以成功，這個會失敗？我當時也不是在同一個網段。

查證後發現根因比 ADR-0022 寫的更前面一層：

```
opportunity  repo 公開 → 映像公開 → 匿名就拉得到 → 從來不需要憑證
kidGo        repo 私有 → 映像私有 → 必須有憑證   → DSM 給不出來
```

`kylewu08/opportunity` 是 **public repo**（匿名查 API 回 200），
`kidGo` 是私有（404）。**網段從頭到尾就不是 07 成功的原因**——
它只是繞過了問題，不是解決了問題。

這也解釋了 ADR-0015 的判斷失誤：把「07 能動」當成「這條路可行」的證據，
但那條路的憑證部分從來沒被執行過。**把「沒出問題」當成「有效」。**

## 被考慮的選項

### 選項 A：repo 轉公開
部署問題直接消失。但 P7 說「評分規則是本產品最有價值的資產」，
而 `docs/` 底下的設計架構書與 22 份 ADR（含每個被否決的替代方案與理由）
會一併公開。這是取捨不是風險，使用者選擇不採用。

### 選項 B：維持私有映像
就是 ADR-0022 那條路，等於繼續賭，或等到能 SSH。

### 選項 C：映像公開，但映像裡不含原始碼（採用）

**GHCR 的 package 可見性與 repo 是分開的。** 先前做不到只是因為
`Dockerfile` 是單階段、`COPY . .` 把整份原始碼（連 `docs/`）都烤進映像。

改成多階段之後，最終映像只有 `.next` 的建置輸出、production 相依、
migration 的 SQL 與一支 `.mjs`。`lib/`、`app/`、`docs/`、
`drizzle.config.ts` 全部留在 builder 階段。

## 實作時發現的陷阱

**`.next` 裡的 source map 含完整原始碼。**

實測：`grep "本產品最有價值的資產" .next/` 命中
`.next/server/chunks/ssr/*.js.map`，一次建置產生 **64 個 `.map` 檔**，
連中文註解都在裡面。

若直接把 `.next` 複製進公開映像，**這個 ADR 的整個前提就不成立**——
表面上「不含原始碼」，實際上原始碼在 source map 裡完整可讀。

所以 builder 階段最後會 `find .next -name "*.map" -delete`，
並刪掉 `.next/cache`（建置中間產物，本機實測 78 MB）。

**這一條若被誤刪，症狀是靜默的**：映像照樣能跑，只是原始碼被公開了。

## 連帶的簡化

映像公開之後拉取完全不需要憑證，於是：

- 回到 **GHCR**，與 01、07 一致（ADR-0022 的 Docker Hub 決定作廢）
- `scripts/make_ghcr_config.sh` / `make_registry_config.sh` **刪除**
- compose 不再掛 `docker-config.json`

留著一個沒有作用的憑證步驟，正是 07 那份文件害我們繞遠路的原因。

## 順帶修掉的兩件事

1. **runtime 不再帶 devDependencies。** 原本為了跑 `drizzle-kit migrate`
   （devDependency）而在執行期保留整套開發相依。改用
   `drizzle-orm/better-sqlite3/migrator`（**執行期**相依）寫成
   `scripts/migrate.mjs`，它只需要 `drizzle/` 底下已產生的 SQL 與 meta，
   不需要 schema 原始碼——這正是能把 `lib/` 留在 builder 的原因。
2. **runtime 不再帶編譯工具鏈。** production 相依在獨立的 `proddeps`
   階段安裝，再複製 `node_modules`。linux → linux、同一個基底映像，
   所以安全（ADR-0015 警告的是 macOS → linux 的跨平台問題）。

## 後果

- **公開的是映像，不是 repo。** 設計架構書與 ADR 仍然私有
- 編譯後的 server chunk 仍是應用邏輯，有心人花力氣讀得出來；
  但 P7 說的那份資產（**為什麼**這樣設計）不在裡面
- 部署不再需要任何憑證，DSM 的限制繞不到我們
- 映像顯著變小（少了 devDependencies、工具鏈、`.next/cache`）

## 什麼情況下該重新考慮

若哪天需要把映像轉回私有（例如加入了不該公開的內容），
就會重新面對 ADR-0022 的死結，屆時的解法仍是在 NAS 上執行一次
`docker login`——那需要與 NAS 同網段。

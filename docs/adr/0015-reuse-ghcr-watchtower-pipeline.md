# ADR-0015：沿用既有的 GHCR + Watchtower 部署管線，並為 SQLite 掛持久卷

- **狀態**：已採納，但 **registry 部分已被 [ADR-0022](0022-docker-hub-over-ghcr.md) 取代**
  （2026-08-31：GHCR 改為 Docker Hub。其餘決定全部仍然有效）
- **日期**：2026-08-26
- **相關**：[ADR-0001](0001-sqlite-over-cloud-db.md)、[ADR-0010](0010-deploy-on-synology-nas.md)、設計架構書 v1.0 §9
- **修正**：ADR-0010 中關於 DDNS、憑證與 CGNAT 的三項待辦

## 背景

ADR-0010 決定部署在 Synology NAS，並列了三件要建立的事：固定網址（DDNS）、
HTTPS 憑證（Let's Encrypt）、排程。還標了一個風險：若電信商為 CGNAT，
DDNS 會穿不出去。

使用者於 2026-08-26 指出他先前的專案已經做過 NAS 部署與 Cloudflare Tunnel。
查閱 `07_Opportunity_Inbox/DEPLOY.md` 後發現：**那三件事有兩件已經不存在，
而且有一套比 ADR-0010 設想的更好的管線。**

## 既有的管線（來自 07_Opportunity_Inbox）

```
git push → GitHub Actions 建 image → 推到 GHCR
                                        ↓
                    NAS 上的 Watchtower 每 5 分鐘檢查
                                        ↓
                        有新版就自動拉下來重啟容器
```

三個值得沿用的細節：

1. **image 在 GitHub 上建，不在 NAS 上建。** NAS 的 CPU 建置很慢，
   而且靠 layer 快取，之後只改程式碼時 NAS 通常只需下載幾十 KB
2. **`scripts/make_ghcr_config.sh`** 在本機產生 GHCR 拉取憑證，
   用 File Station 上傳——避開「NAS 在遠端不方便 SSH」的問題
3. **Watchtower 的 `--scope`**：沒有它，Watchtower 會去更新 NAS 上
   **所有**容器，包含其他不相干的服務

## ADR-0010 的三項待辦：兩項作廢

| ADR-0010 的待辦 | 現況 |
|----------------|------|
| 固定網址（DDNS） | **不需要。** Cloudflare Tunnel 已在運行 |
| HTTPS 憑證 | **不需要。** Cloudflare 端處理 |
| 排程 | 仍需要，但在容器內完成（07 用 APScheduler，KidGo 用同樣模式） |

**CGNAT 的風險也一併消失。** Cloudflare Tunnel 是由 NAS **主動向外連線**，
不需要對外 IP、不需要開埠、不需要 DDNS。ADR-0010 說「動工部署前應先確認
是否為 CGNAT」——**這件事不必查了，架構上已經繞過**。

DEPLOY.md 明講隧道可共用：「用你既有的那條隧道即可，不必新建」。
KidGo 只需在 Cloudflare Zero Trust 加一個 Public Hostname。

埠：01 用 8006、07 用 8007，**KidGo 用 8008**。

---

## ⚠️ KidGo 與既有專案的關鍵差異

### 一、沒有持久卷的話，自動更新會刪光資料庫

01 與 07 用的是外部資料庫（Supabase、Google API），容器內沒有要保存的東西。
**KidGo 的 SQLite 是一個檔案，而它在容器裡。**

Watchtower 每 5 分鐘檢查，有新版就**重建容器**：

```
git push  →  5 分鐘後容器重建  →  出遊紀錄全部消失
```

而 §6.4 說造訪紀錄**永不刪除**，那是本產品最有價值的資產（P5）。

> **讓 07 那套變方便的自動更新機制，在 KidGo 上會是一個定時資料銷毀器。**

因此 compose **必須**掛載持久卷：

```yaml
volumes:
  - /volume1/docker/kidgo/data:/app/data
```

這不是優化，是 ADR-0001 選擇本地 SQLite 的前提。**這一條若遺漏，
症狀是「用了兩週之後紀錄莫名其妙變少」，而且很難聯想到部署設定。**

### 二、`better-sqlite3` 是原生模組

它必須編譯成目標平台的二進位檔。在 macOS 上安裝的 `node_modules`
複製進 linux/amd64 容器會在執行期失敗，錯誤訊息（`invalid ELF header` 之類）
與真正的原因相距很遠。

**Dockerfile 必須在容器內執行 `npm ci` 讓它自行編譯**，不得 `COPY node_modules`。
07 是 Python 專案，沒有這個問題，所以它的 Dockerfile 沒有處理這件事。

### 三、容器啟動時要跑 migration

持久卷是空的時候（第一次部署、或換新 NAS），資料庫檔案不存在。
啟動流程需要先跑 `drizzle-kit migrate` 再啟動應用。

---

## 決定

沿用 07 的三件套（GitHub Actions workflow、docker-compose、
make_ghcr_config.sh），並加入上述三項 KidGo 專屬的處理。

**實作時機：延後至推薦引擎與匯入器完成之後**（使用者於 2026-08-26 決定）。
現在部署上去也還沒有東西可看。

> 反對意見（已被否決，但記錄下來）：早點建立可部署骨架，
> 每次 push 都會自動驗證「它在 linux/amd64 上真的跑得起來」，
> 不會拖到最後才發現原生模組編不過。
> 使用者選擇先完成功能，因此**第一次部署時要預期在原生模組上卡一輪**。

## 後果

- ADR-0010 的 DDNS 與憑證兩項待辦作廢；CGNAT 風險消失
- 部署所需的新檔案：`Dockerfile`、`docker-compose.yml`、
  `.github/workflows/build-image.yml`、`scripts/make_ghcr_config.sh`
- Cloudflare 端只需新增一個 Public Hostname，不新建隧道
- GitHub repo 已建立：`git@github.com:kylewu08/kidGo.git`（private）

### 仍然有效的風險

DEPLOY.md 最後那條「**NAS 必須保持開機**」對 KidGo 比對 07 更嚴重：
排程推播是本產品的**主要形態**（§1.3），NAS 休眠等於產品當天不存在。
07 的推播漏掉可以事後補，KidGo 的「週六早晨建議」過了就沒有意義了。

### 什麼情況下該重新考慮

1. 若 NAS 的可用性造成連續兩個週末漏掉推播（ADR-0010 已列），
   改用 Fly.io 時本管線的 GitHub Actions 部分仍可沿用，只需換部署目標
2. 若 image 大小或建置時間成為問題，再考慮 Next.js 的 standalone 輸出以外的優化

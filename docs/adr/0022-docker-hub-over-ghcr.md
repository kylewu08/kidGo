# ADR-0022：映像改推 Docker Hub，因為 DSM 的登錄檔憑證對 compose 無效

- **狀態**：已採納
- **日期**：2026-08-31
- **相關**：[ADR-0015](0015-reuse-ghcr-watchtower-pipeline.md)
- **偏離**：ADR-0015「沿用 07 的 GHCR + Watchtower 管線」的 registry 部分

## 背景

ADR-0015 決定沿用 `07_Opportunity_Inbox` 的部署管線，包含把映像推到 GHCR。
2026-08-31 第一次實機部署，Container Manager 拉映像一律失敗：

```
Error response from daemon: denied
```

## 查到的事實

**一、07 從來沒有驗證過私有 registry 這條路。** 實測匿名拉取：

| 映像 | HTTP |
|---|---|
| `kylewu08/opportunity` | **200**（公開） |
| `kylewu08/kidgo` | **403**（私有） |

07 的映像是公開的，所以它根本不需要憑證。ADR-0015 把「07 能動」當成
「這條路可行」的證據，但**那條路的憑證部分從來沒被走過**。

**二、`docker-config.json` 本來就救不了第一次拉取。** 它掛載的位置是
Watchtower 容器（`./docker-config.json:/config.json:ro`），只在 Watchtower
之後檢查更新時用得到。第一次拉映像是 Container Manager 用 Docker daemon
的憑證做的，看不到專案目錄裡那個檔案。

**三、DSM「登錄檔」介面的憑證不會傳給 `docker compose`。** 依序試過：

| 嘗試 | 結果 |
|---|---|
| 未加登錄檔 | denied |
| 加了 ghcr.io、非使用中、舊 token | denied |
| 加了 ghcr.io、非使用中、新 token | denied |
| 加了 ghcr.io、**設為使用中**、新 token | denied |

而 token 本身是好的——在本機以同一個 token 交換並取 manifest 回 **HTTP 200**。
所以問題明確落在 Synology 這一側。

**四、GHCR 沒有搜尋 API**，所以 DSM 的「倉庫」分頁切到 ghcr.io 會跳
「無法連線至倉庫伺服器」：

```
ghcr.io/v1/search                 → 303
registry.hub.docker.com/v1/search → 200
```

這只是列不出清單，與拉取無關，但會誤導人以為是網路問題。

## 被考慮的選項

### 選項 A：SSH 進 NAS 執行 `docker login`（正解，但當下走不通）

`docker compose pull` 讀的是 root 的 `~/.docker/config.json`，而只有
`docker login` 會寫它。這是最乾淨、且能維持與 01/07 一致的做法。

**當下的障礙是網路不是意願**：使用者的 Mac 在 `192.168.0.x`，NAS 在
`192.168.1.x`，ping 不通、22 埠也不通；QuickConnect 只轉發 DSM 網頁，
不轉發 SSH。

**這個選項沒有被否決，只是被延後**——哪天 Mac 接得到那個網段，
執行一次 `docker login` 就能改回 GHCR。

### 選項 B：把映像改成公開

一定能動（01、07 都是這樣），但 **Dockerfile 有 `COPY . .`，映像層包含
整份原始碼**。這個 repo 是私有的，公開映像等於公開原始碼。否決。

### 選項 C：改推 Docker Hub 私有 repo（採用）

Synology 的登錄檔介面本來就是繞著 Docker Hub 設計的（預設那筆就是它），
程式路徑與第三方 registry 不同，**有機會避開事實三**。

**已知風險：若 DSM 的限制是全域的，這條路會撞到同一堵牆。**
採用它是因為代價低（改二十行）且是 DSM 支援最完整的路徑，
不是因為確定可行。

## 決定

選 **C**，由使用者於 2026-08-31 決定。

- workflow 改用 `docker/login-action` 對 Docker Hub，需要兩個 secret：
  `DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN`
- `docker-compose.yml` 的 image 改為 `kylewu08/kidgo:latest`
- `scripts/make_ghcr_config.sh` → `make_registry_config.sh`，
  auth 的 key 從 `ghcr.io` 改為 `https://index.docker.io/v1/`

**ADR-0015 的其餘部分完全不受影響**：持久卷、原生模組在容器內編譯、
啟動先跑 migration、Watchtower 的 `--scope`、Cloudflare Tunnel 共用。
換的只是映像放在哪裡。

## 後果

- 這個專案的 registry 與 01、07 分岔，多一組憑證要記
- Docker Hub 免費方案對私有 repo 有數量限制，目前只需要一個
- 若 C 也失敗，剩下的選項是：等到能 SSH（選項 A）、
  或用 Container Manager 的「從檔案匯入映像」搭配 CI 產生的 tar
  （可行但每次部署都要人工，等於放棄自動更新）

## 什麼情況下該重新考慮

**一旦有辦法在 NAS 上執行一次 `docker login`，就該改回 GHCR。**
理由是 ADR-0015 原本的：與 01、07 用同一套管線，少一組憑證、少一種要記的東西。

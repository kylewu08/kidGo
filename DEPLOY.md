# 部署到 Synology NAS

決定與理由見 [ADR-0015](docs/adr/0015-reuse-ghcr-watchtower-pipeline.md)。
這裡只寫怎麼做。

```
git push → GitHub Actions 建映像 → 推到 GHCR（公開）
                                      ↓
                  NAS 上的 Watchtower 每 5 分鐘檢查
                                      ↓
                      有新版就自動拉下來重啟容器
```

映像在 GitHub 上建、不在 NAS 建。改程式碼只要 `git push`，五分鐘內 NAS 會自己更新。

- Repo：`git@github.com:kylewu08/kidGo.git`（private）
- 映像：`ghcr.io/kylewu08/kidgo:latest`（**公開**，全小寫）
- 埠：**8008**（01 用 8006、07 用 8007）

> **公開的是映像，不是 repo。** 多階段建置讓最終映像不含原始碼——
> `lib/`、`app/`、`docs/` 全部留在 builder 階段，設計架構書與 ADR 仍然私有。
> 為什麼要這樣做見 [ADR-0023](docs/adr/0023-public-image-without-source.md)：
> DSM 的登錄檔憑證不會傳給 `docker compose`，所以私有映像在這台 NAS 上
> 拉不動，而唯一乾淨的解需要 SSH（需與 NAS 同網段）。

---

## 〇、這個環境的前提：Mac 與 NAS 不同網段

**整份文件之所以全程用網頁介面，是因為 shell 這條路根本走不通。**
先講清楚，否則每次談部署都會重新踩一次。

| | 位址 |
|---|---|
| 開發機（Mac） | `192.168.0.119` |
| NAS（DS720+） | `192.168.1.116` |

**不同網段**，所以 ping、SSH（22）、DSM（5000／5001）**全部不通**。
這與人在家或在外面無關，換位置也沒用。

唯一的進入點是 **QuickConnect 網頁**，而**QuickConnect 不轉發 SSH**。
於是任何需要 `docker login` 或 shell 的方案在這台機器上都做不到——
這正是 [ADR-0022](docs/adr/0022-docker-hub-over-ghcr.md) 繞了一大圈、
最後由 [ADR-0023](docs/adr/0023-public-image-without-source.md) 改用
公開映像收尾的根本原因。§四的「拉映像回 `denied`」只寫了結論，
這裡是它的前一層。

> 哪天 Mac 與 NAS 進到同一個網段，`sudo docker login` 就會變成可行選項，
> 屆時映像可以改回私有。**在那之前不要再評估任何需要 SSH 的做法。**

專案在 NAS 上的位置是 `/volume1/Kyle Grace/kidgo`，**不是** `/volume1/docker/`
（使用者的容器專案都放在 `Kyle Grace` 共用資料夾底下）。compose 已改用
相對路徑 `./data`，所以實際上不再依賴這個路徑——但看 File Station 時要知道往哪找。

---

## 一、只需要做一次的設定

> NAS 全程用 DSM 網頁介面（File Station + Container Manager）完成。
> **1-3 若失敗就會需要 SSH**——理由見那一節，以及上面的〇。

### 1-1 把 GHCR 的 package 設為公開

**這是唯一需要在 GitHub 上做的設定，而且只做一次。**

第一次 `git push` 讓 Actions 建置成功之後，package 才會存在：

GitHub → 你的頭像 → **Packages** → `kidgo` → Package settings →
**Change visibility** → Public。

> 公開的是**映像**，不是 repo。映像裡沒有 `lib/`、`app/`、`docs/`，
> 也沒有 source map（builder 階段會刪掉，否則原始碼會躺在 `.map` 檔裡）。
>
> **不需要任何憑證檔。** 先前版本要產生 `docker-config.json` 並上傳，
> 那一步已經完全移除——它掛給 Watchtower、救不了第一次拉取，
> 而留著一個沒有作用的步驟正是先前繞遠路的原因。

### 1-2 準備 NAS 上的目錄

用 File Station 建立，**不需要把程式碼放上去**（程式碼在映像裡）：

```
<你的專案資料夾>/          ← 放哪個共用資料夾底下都可以
├── docker-compose.yml     ← 從 repo 複製
├── .env                   ← 手動建立，見下
└── data/                  ← 必須跟 compose 檔同一層
    └── kidgo.db           ← 見「二、第一次部署之後」
```

> compose 用的是**相對路徑** `./data`，以 compose 檔所在目錄為基準。
> 所以專案資料夾放哪裡都行，但 **`data/` 必須跟 `docker-compose.yml` 同一層**。

**`data/` 這個資料夾一定要先建。** compose 把它掛成持久卷，容器裡的
`/app/data/kidgo.db` 就是它。少了它，Watchtower 每次更新都會把資料庫
連同容器一起丟掉——見 §三的警告。

好消息是**漏掉會硬失敗不會靜默**：Docker 對不存在的 bind mount 來源直接
拒絕啟動（`Bind mount failed: ... does not exist`），不會偷偷幫你建一個。

`.env` 內容：

```
CWA_API_KEY=...
GOOGLE_ROUTES_API_KEY=...
```

兩個都從本機的 `.env.local` 複製。`DATABASE_URL` **不要**放進去——
Dockerfile 已經把它設成 `/app/data/kidgo.db`，寫在 `.env` 裡只會有機會蓋錯。

**不需要 `CLOUDFLARE_TUNNEL_TOKEN`。** 這個專案不跑自己的 cloudflared，
對外由既有那條隧道轉發到區網 IP，理由見 1-5。

### 1-3 （不需要）設定 registry 憑證

映像是公開的，拉取不需要任何憑證。DSM 的「登錄檔」保持預設即可。

> 這一節刻意留著而不是刪掉，因為**先前在這裡卡了很久**：
> DSM 登錄檔的憑證不會傳給 `docker compose`，無論怎麼設、是不是「使用中」、
> token 新舊，一律 `Error response from daemon: denied`。
> 完整經過見 [ADR-0022](docs/adr/0022-docker-hub-over-ghcr.md) 與
> [ADR-0023](docs/adr/0023-public-image-without-source.md)。
>
> 若哪天映像轉回私有，就會再次面對這個問題，屆時唯一乾淨的解是在 NAS 上
> 執行一次 `sudo docker login`——需要 SSH，也就需要與 NAS 同網段。

### 1-4 建立 Container Manager 專案

DSM → **Container Manager** → 專案 → 新增，名稱 `kidgo`，
路徑選 **1-2 建立的那個資料夾**（實際上是 `/volume1/Kyle Grace/kidgo`，
不是 `/volume1/docker/`——見 §〇 結尾）。

> ⚠️ **之後每次改 `.env`，都要回到這一頁做「停止 → 建置」**，
> 不是「重新啟動」。理由見 §四最後一則。

### 1-5 Cloudflare Tunnel 加一個 Public Hostname

Cloudflare Zero Trust → Networks → Tunnels → 選既有的隧道 → Public Hostname：

| 欄位 | 值 |
|---|---|
| Subdomain / Domain | 自訂，例如 `kidgo.kylewu.org` |
| Service | `http://192.168.1.116:8008` |

**沿用既有的那條隧道，只加一條 Public Hostname，不要新建隧道。**

> ⚠️ **不要讓 KidGo 跑自己的 `cloudflared`。**
>
> 曾經這樣做過（Service 填 `http://kidgo:3000`，靠容器名解析）。用同一個
> tunnel token 起第二個 cloudflared，等於同一條隧道有兩個連線點，
> 而它們看得到的東西不一樣——07 的解析得到 `opportunity_inbox` 卻解析不到
> `kidgo`，KidGo 的反過來。Cloudflare 會把流量分給任一個健康的連線點，
> 分錯就 502。
>
> 2026-09-01 實測：KidGo 的 cloudflared 起來之後，`brain.kylewu.org`
> 連打 12 次出現 1 次 502。**症狀是時好時壞，最難查的那種**，
> 而且壞的是原本好好的另一個專案。
>
> 01 本來就是用區網 IP 掛在共用隧道上，照它做即可。

---

## 二、第一次部署之後：資料庫是空的

**這件事 ADR-0015 沒寫，但一定會遇到。**

持久卷第一次是空的，容器啟動時跑完 migration 只會得到一個**空資料庫**——
沒有地點、沒有出發點、沒有小孩。本機那 1400 多筆地點不會自己跟過去。

兩條路：

**A. 在 NAS 上重跑匯入器**（乾淨，但要能在容器裡執行指令）

**B. 把本機的資料庫檔複製過去**（快）

複製前**必須先做 WAL checkpoint**，否則會漏掉還在 `-wal` 裡、尚未寫回主檔的資料：

```bash
sqlite3 data/kidgo.db "PRAGMA wal_checkpoint(TRUNCATE);"
```

然後用 File Station 把 `data/kidgo.db` 上傳到**專案資料夾底下的 `data/`**
（這台機器上是 `/volume1/Kyle Grace/kidgo/data/`）。
容器重啟後 migration 會看到既有的 schema，不會重複套用。

---

## 三、幾個不能拿掉的東西

**持久卷**

```yaml
volumes:
  - ./data:/app/data
```

KidGo 的 SQLite 是一個檔案，而它在容器裡。Watchtower 有新版就重建容器——
**讓 07 那套變方便的自動更新機制，在 KidGo 上會是一個定時資料銷毀器。**
而 §6.4 說造訪紀錄永不刪除，那是本產品最有價值的資產。

遺漏的症狀是「用了兩週之後紀錄莫名其妙變少」，而且很難聯想到部署設定。

**Watchtower 的 `--scope kidgo`**

沒有它，Watchtower 會去更新 NAS 上**所有**容器，包含 01 與 07。

**NAS 必須保持開機**

排程推播是本產品的主要形態（§1.3）。NAS 休眠等於產品當天不存在——
而且「週六早晨的建議」過了就沒有意義，不像 07 的推播可以事後補。

---

## 四、已經踩過的坑

**容器跑在 UTC，時間整整差 8 小時**（2026-09-01，部署後第一次實際使用）。

畫面顯示「14:59 出發」而台北時間是 22:59。Dockerfile 沒設 `TZ`，Node 就用
UTC——而這個產品的每一個判斷都建立在本地時間上：可用時間窗、午睡區間、
天氣時段對應、平日／假日、跨日改算明天。

**症狀最麻煩的地方是畫面看起來完全正常**，只是把晚上的建議當成下午給出去。

07 沒踩到是因為它的 `.env` 有 `TIMEZONE=Asia/Taipei`，那是 Python 應用
自己讀的變數；Node 用的是作業系統的 `TZ`，機制不同。

已修：Dockerfile 設 `ENV TZ=Asia/Taipei` 並明確安裝 `tzdata`
（slim 映像不保證帶 `/usr/share/zoneinfo`，少了它 `TZ` 會靜默退回 UTC）。


**Container Manager 拉映像回 `denied`**（2026-08-31，第一次實機部署）。

DSM 的「登錄檔」憑證**不會傳給 `docker compose`**。四種組合全部失敗
（沒加登錄檔／加了但非使用中／新舊 token／設為使用中），而同一個 token
在本機取 manifest 回 HTTP 200——問題明確在 Synology 這一側。

07 一直沒事，是因為 `kylewu08/opportunity` 這個映像是**公開**的
（匿名拉取回 200），私有這條路從來沒被驗證過。

**根因比表面更前面一層**：`kylewu08/opportunity` 是 public repo，
所以映像是公開的、從來不需要憑證。ADR-0015 把「07 能動」當成「這條路可行」
的證據，但那條路的憑證部分從未被執行過——**把「沒出問題」當成「有效」**。

最後的解法是把映像設為公開、同時用多階段建置讓映像不含原始碼。
完整查證見 [ADR-0022](docs/adr/0022-docker-hub-over-ghcr.md) 與
[ADR-0023](docs/adr/0023-public-image-without-source.md)。

**source map 會洩漏原始碼**（2026-09-01）。`grep "本產品最有價值的資產" .next/`
命中 `.next/server/chunks/ssr/*.js.map`——一次建置產生 64 個 `.map` 檔，
連中文註解都在。Dockerfile 的 builder 階段會把它們刪掉；**這一行若被誤刪，
症狀是靜默的**：映像照樣能跑，只是原始碼被公開了。


**`npm ci` 在容器裡失敗，20 秒 exit 1**（2026-08-31，第一次 CI）。

`better-sqlite3` 的安裝腳本是 `prebuild-install || node-gyp rebuild --release`
——先試著下載預編譯檔，拿不到就當場從原始碼編。而 `node:20-bookworm-slim`
沒有 `python3` / `make` / `g++`，於是兩條路都斷。

**訊息只說 `npm ci` 失敗，完全不會提到缺編譯器**，而且失敗得很快，
看起來不像編譯問題——這正是 ADR-0015 說「第一次部署要預期在原生模組上
卡一輪」的那一關。

已修：Dockerfile 在 `npm ci` 之前裝工具鏈。裝了之後，就算哪天上游不再
發布對應 Node ABI 的預編譯檔，也只是變慢而不會建不起來。

> 順帶一提，本機 `node_modules/better-sqlite3/build/Release/` 底下有 `.deps/`，
> 那是 make 的產物——代表在 macOS 上它走的也是「從原始碼編譯」那條路，
> 靠的是 Xcode command line tools。所以「本機能裝」從來就不保證「容器裡能裝」。

**`npm run build` 在容器裡失敗**（2026-08-31，第二次 CI）。

```
TypeError: Cannot open database because the directory does not exist
    at lib/db/index.ts:14
    at app/page.tsx
```

`next build` 的「Collecting page data」會 import 每一個頁面模組，而
`lib/db/index.ts` **在模組載入時就開資料庫連線**。容器裡沒有 `data/`
——它被 `.dockerignore` 排除，因為資料庫屬於持久卷而不是映像的內容。

本機建得起來只是因為 `data/` 就在那裡。用
`DATABASE_URL=/tmp/不存在的目錄/x.db npm run build` 可以在本機完整重現。

已修：Dockerfile 用一個丟棄用的資料庫建置（先 migrate 再 build，建完刪掉），
路徑刻意避開 `/app/data`，因為那是持久卷的掛載點。

> 這兩個坑有同一個形狀：**本機環境裡「剛好存在」的東西，容器裡不存在。**
> 一個是編譯器，一個是資料庫目錄。

NAS 若是 ARM 機種（Realtek / Marvell），要把 workflow 裡的
`platforms: linux/amd64` 改成 `linux/arm64`。在 NAS 上跑 `uname -m`
可確認：`x86_64` → amd64。


**改了 `.env`，容器卻還在用舊值**（2026-09-03，Routes 金鑰換新之後）。

症狀是路況一直失敗，而錯誤訊息看起來像 Google 那邊的問題：

```
HTTP 400  "API key expired. Please renew the API key."
reason: "API_KEY_INVALID"
```

**但金鑰是新的、剛產生的。** 真正在送出去的是那把已經被作廢的舊金鑰——
容器啟動時就把環境變數固定下來了，之後改 `.env` 它不會知道。

**重啟 Watchtower 沒有用**，這是最容易誤判的一步：

    Watchtower 的流程：
      檢查既有容器 → 拉新映像 → 用「既有容器的 env」建新容器
                                        ↑
                                舊值就是從這裡被帶過去的

Watchtower **不讀 `docker-compose.yml`、也不讀 `.env`**——它是複製既有容器
的設定去重建。所以連「推一個新 commit 讓它重建」都救不了，那條路同樣會把
舊環境變數原封不動帶進新容器。

正解是走 compose 那條路，讓它重新解析 `env_file`：

| 動作 | 有沒有用 |
|---|---|
| Container Manager → **專案** → 停止 → **建置** | ✅ 走 `docker compose up`，重讀 `.env` |
| 容器 → 重新啟動 | ❌ 同一個容器再跑一次，env 在建立時就固定了 |
| 重啟 Watchtower | ❌ 完全無關 |

查證方式：Container Manager → 容器 → `kidgo` → 詳細資料 → **環境**，
直接看得到容器目前持有的值是新是舊。

> 這一則與前兩則同型，但方向相反：前兩則是「本機有、容器沒有」，
> 這一則是**「檔案改了、容器沒跟上」**。共同點是
> **症狀都指向錯的地方**——這次它指向 Google，而問題在 NAS 上。


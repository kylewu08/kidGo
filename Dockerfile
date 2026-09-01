# KidGo 的容器映像（ADR-0015、ADR-0023）
#
# **多階段建置，最終映像不含原始碼。**
#
# 這是 ADR-0023 的核心：映像設為公開才能繞開「NAS 拉不到私有映像」的死結
# （DSM 的登錄檔憑證不會傳給 docker compose，見 ADR-0022），
# 但公開映像不能等於公開原始碼——`docs/` 底下的設計架構書與 22 份 ADR
# 才是 P7 說的「本產品最有價值的資產」。
#
# 所以 lib/、app/、docs/、scripts/ 全部留在 builder 階段。最終映像只有
# .next 的建置輸出、production 相依、migration 的 SQL，以及一支 .mjs。

# ---------------------------------------------------------------------------
# 共用基底
# ---------------------------------------------------------------------------
#
# 用 bookworm 而不是 alpine：better-sqlite3 的預編譯二進位檔是給 glibc 的，
# alpine 是 musl 會退回從原始碼編譯。映像小一點不值得換那個風險。
FROM node:20-bookworm-slim AS base
WORKDIR /app

# ⚠️ **時區必須明講。**
#
# 沒設 TZ 的話 Node 走 UTC，而這個產品的每一個判斷都建立在本地時間上：
# 可用時間窗、午睡區間、天氣時段對應、平日／假日、跨日改算明天。
# 2026-09-01 實測，容器裡顯示「14:59 出發」而台北時間是 22:59——
# **整整偏移 8 小時，而畫面上看起來完全正常**，只是把晚上的建議
# 當成下午給出去。
#
# tzdata 明確裝上：slim 映像不保證帶 /usr/share/zoneinfo，
# 少了它 TZ=Asia/Taipei 會靜默退回 UTC。
ENV TZ=Asia/Taipei
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

# better-sqlite3 的安裝腳本是 `prebuild-install || node-gyp rebuild`：
# 拿不到預編譯檔就當場編。bookworm-slim 沒有編譯器，兩條路都斷——
# **第一次 CI 就是死在這裡，20 秒 exit 1**，而訊息只說 `npm ci` 失敗。
FROM base AS toolchain
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# production 相依（給最終映像用）
# ---------------------------------------------------------------------------
FROM toolchain AS proddeps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------------------------------------------------------------------------
# 建置（需要 devDependencies 與全部原始碼）
# ---------------------------------------------------------------------------
FROM toolchain AS builder
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# `next build` 的「Collecting page data」會 import 每個頁面模組，而
# lib/db/index.ts **在模組載入時就開資料庫連線**（刻意的：讓 client
# component 誤 import 時建置期就失敗）。容器裡沒有 data/——它被
# .dockerignore 排除，因為資料庫屬於持久卷不屬於映像。於是建置會死在
# 「Cannot open database because the directory does not exist」。
#
# 給建置一個丟棄用的資料庫，建完就刪。路徑刻意避開 /app/data，
# 那是持久卷的掛載點。
RUN mkdir -p /tmp/kidgo-build \
    && DATABASE_URL=/tmp/kidgo-build/build.db node scripts/migrate.mjs \
    && DATABASE_URL=/tmp/kidgo-build/build.db npm run build \
    && rm -rf /tmp/kidgo-build

# ⚠️ **source map 內含完整原始碼**，包含註解。
#
# 2026-09-01 實測：`grep "本產品最有價值的資產" .next/` 會命中
# `.next/server/chunks/ssr/*.js.map`——一次建置產生 64 個 .map 檔。
# 把 .next 原封不動複製進公開映像，等於把原始碼連同設計註解一起發佈，
# ADR-0023 的整個前提就沒了。
#
# cache/ 是建置中間產物（本機實測 78 MB），執行期完全用不到。
RUN find .next -name "*.map" -type f -delete \
    && rm -rf .next/cache

# ---------------------------------------------------------------------------
# 最終映像
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production
# 指向 compose 掛進來的持久卷。**這個路徑若指錯，資料會寫進容器層，
# 然後在下一次 Watchtower 更新時連同容器一起消失。**
ENV DATABASE_URL=/app/data/kidgo.db

# linux → linux、同一個基底映像，所以複製 node_modules 是安全的。
# （ADR-0015 警告的是 macOS 編出來的原生模組進 linux 容器會壞，
#   那是跨平台的問題，不是這裡。）這樣 runtime 就不必帶編譯工具鏈。
COPY --from=proddeps /app/node_modules ./node_modules

COPY package.json ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
# migration 只需要已產生的 SQL 與 meta，不需要 schema 原始碼——
# 那正是改用 drizzle-orm 的 migrator（執行期相依）而不是 drizzle-kit
# （開發相依）換來的。
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts/migrate.mjs ./scripts/migrate.mjs

# next.config.ts 刻意不複製：它是空設定，而 runtime 沒有 TypeScript。
# 少一個要在執行期解析 TS 的地方。

EXPOSE 3000

# migration 先跑完再起應用。失敗就整個停下來——
# 半套的 schema 配上會寫入的應用，比起不了服務危險得多。
#
# -H 0.0.0.0 是明講的保險：綁到 127.0.0.1 的話容器外連不進來，
# 而症狀是「容器在跑、埠也對映了，但就是連不到」。
CMD ["sh", "-c", "node scripts/migrate.mjs && npm start -- -H 0.0.0.0 -p 3000"]

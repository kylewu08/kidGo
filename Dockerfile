# KidGo 的容器映像（ADR-0015）
#
# 三件 KidGo 專屬的處理，都寫在 ADR-0015 裡，遺漏任何一件的症狀都很難聯想到部署：
#
# 1. **原生模組必須在容器內編譯。** better-sqlite3 是 C++ 原生模組，
#    macOS 上裝好的 node_modules 複製進 linux 容器會在執行期壞掉，
#    而錯誤訊息（`invalid ELF header` 之類）跟真正的原因相距很遠。
#    所以這裡跑 `npm ci`，**絕不 COPY node_modules**（.dockerignore 也擋著）。
#
# 2. **用 bookworm 而不是 alpine。** better-sqlite3 的預編譯二進位檔是給
#    glibc 的；alpine 是 musl，會退回從原始碼編譯，需要整套 build toolchain。
#    映像小一點不值得換來那個風險。
#
# 3. **啟動時先跑 migration。** 持久卷第一次是空的（第一次部署、或換新 NAS），
#    資料庫檔案根本不存在。
#
# 保留 devDependencies 是刻意的：drizzle-kit 在啟動時要用。ADR-0015 明說
#「若映像大小成為問題，再考慮優化」——現在不是問題。

FROM node:20-bookworm-slim

WORKDIR /app

# better-sqlite3 的安裝腳本是 `prebuild-install || node-gyp rebuild --release`：
# 先試著下載預編譯檔，拿不到就當場從原始碼編。而 bookworm-slim 沒有編譯器，
# 於是兩條路都斷——**第一次 CI 就是死在這裡，20 秒 exit 1**，
# 因為它根本沒開始編就放棄了（訊息只說 `npm ci` 失敗，不會提到缺編譯器）。
#
# 裝了工具鏈之後，即使某天上游不再發布對應 Node ABI 的預編譯檔，
# 也只是變慢而不會建不起來。
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 先只複製 manifest，讓 npm ci 這層在原始碼變動時仍能命中快取
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# `next build` 的「Collecting page data」會 import 每一個頁面模組，而
# lib/db/index.ts **在模組載入時就開資料庫連線**（那是刻意的：讓 client
# component 誤 import 時建置期就失敗，而不是 runtime 才出現難懂的錯誤）。
#
# 容器裡沒有 data/——它被 .dockerignore 排除，因為資料庫屬於持久卷而不是
# 映像的內容。於是建置會死在：
#
#     TypeError: Cannot open database because the directory does not exist
#         at lib/db/index.ts:14
#
# 所以給建置一個**丟棄用的**資料庫，建完就刪。先跑 migration 讓 schema
# 存在，這樣建置期的資料庫與 runtime 結構一致，不會有「建得起來但跑不
# 起來」或反過來的落差。
#
# ⚠️ 這個路徑刻意不是 /app/data：那裡是持久卷的掛載點，
# 在映像裡先放一個檔案只會製造「這個檔案到底哪來的」的疑惑。
RUN mkdir -p /tmp/kidgo-build \
    && DATABASE_URL=/tmp/kidgo-build/build.db npm run db:migrate \
    && DATABASE_URL=/tmp/kidgo-build/build.db npm run build \
    && rm -rf /tmp/kidgo-build

ENV NODE_ENV=production
# 指向 compose 掛進來的持久卷。**這個路徑若指錯，資料會寫進容器層，
# 然後在下一次 Watchtower 更新時連同容器一起消失。**
ENV DATABASE_URL=/app/data/kidgo.db

EXPOSE 3000

# migration 先跑完再起應用。失敗就整個停下來——
# 半套的 schema 配上會寫入的應用，比起不了服務危險得多。
#
# -H 0.0.0.0 是明講的保險：綁到 127.0.0.1 的話容器外連不進來，
# 而症狀是「容器在跑、埠也對映了，但就是連不到」，很難聯想到監聽位址。
CMD ["sh", "-c", "npm run db:migrate && npm start -- -H 0.0.0.0 -p 3000"]

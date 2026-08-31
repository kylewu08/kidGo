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

# 先只複製 manifest，讓 npm ci 這層在原始碼變動時仍能命中快取
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build

ENV NODE_ENV=production
# 指向 compose 掛進來的持久卷。**這個路徑若指錯，資料會寫進容器層，
# 然後在下一次 Watchtower 更新時連同容器一起消失。**
ENV DATABASE_URL=/app/data/kidgo.db

EXPOSE 3000

# migration 先跑完再起應用。失敗就整個停下來——
# 半套的 schema 配上會寫入的應用，比起不了服務危險得多。
CMD ["sh", "-c", "npm run db:migrate && npm start"]

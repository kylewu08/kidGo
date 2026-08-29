# 座標補完（TGOS 批次門牌地址比對服務）

有些開放資料只有地址沒有座標——全國親子館名冊就是（201 筆全部如此）。
座標是硬需求：沒有它算不出車程，Stage 1 無從過濾。

**這是一個離線流程，不是 API 整合。** 即時 API（全國門牌地址定位服務）
的申請資格限政府機關、法人、學術與業界；批次服務才開放個人。
所以憑證留在使用者手上，程式完全不碰。

## 流程

```bash
npx vite-node --config vitest.config.mts --root . scripts/export-geocode-requests.ts parenting-centers
```

產生 `parenting-centers.request.csv`，然後：

1. 到 https://www.tgos.tw/tgos/Addr/Compare 上傳
2. **坐標系統選 EPSG:4326 (WGS84)**——選錯會拿到 TWD97 平面座標，
   數值看起來仍像座標但單位是公尺
3. 比對方式選「進行完全比對」（這些是完整門牌，不需要模糊比對）
4. 收到通知信後下載結果，存成 `<來源代號>.result.csv`
5. 重跑 `scripts/import-places.ts`

額度每日 1 萬筆，作業時間 1–2 天。

## 檔案命名

- `<來源代號>.request.csv` — 送出去的
- `<來源代號>.result.csv` — TGOS 回來的，**會被匯入器讀取**

匯入器會讀 `*.result.csv` 全部並合併，後面的檔案覆蓋前面的同名地址。
所以補跑漏網地址時，新增一個檔案即可，不必改舊的。

## 為什麼結果檔留在 repo 裡

它是開放資料衍生物，沒有個人資訊，而且重新產生要等 1–2 天。
把它當成建置產物丟掉，等於每次重建環境都要重跑一次人工流程。

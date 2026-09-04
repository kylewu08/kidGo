/**
 * 產生一組 VAPID 金鑰（設計架構書 §9.4）
 *
 *     node scripts/generate-vapid-keys.mjs
 *
 * 把輸出的兩行貼進 `.env.local`（本機）或 NAS 上的 `.env`（正式）。
 *
 * ## 為什麼留一支腳本而不是叫人跑 `npx web-push generate-vapid-keys`
 *
 * 同 `scripts/generate-icons.mjs` 的理由：**可追溯**。半年後要換金鑰時，
 * 「當初是怎麼產的」不會有人記得，而 web-push 的 CLI 需要另外全域安裝
 * 一次（`npm i -g web-push`）——它已經是這個專案的相依了，沒有理由再裝一次。
 *
 * ⚠️ **換金鑰會讓所有既有訂閱失效。** 訂閱是綁著公鑰建立的，換了之後
 * 推播服務會回 403，而 `push_subscriptions` 裡的舊資料看起來完全正常。
 * 真的要換的話，換完把那張表清空，讓每台裝置重新訂閱。
 */

import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);

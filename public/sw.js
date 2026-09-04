/**
 * KidGo Service Worker（設計架構書 §9.4）
 *
 * **這支檔案存在的唯一理由是 Web Push。** `push` 事件只在 Service Worker
 * 裡收得到——沒有 SW 就沒有推播，而推播是這個產品的主要形態（§1.3）。
 *
 * ## 三件刻意沒做的事
 *
 * 1. **不做離線快取。** P9「離線可用」指的是核心資料本地優先，那件事
 *    由伺服器端的 SQLite 完成，已經成立。快取 `/today` 反而會在離線時
 *    顯示過期的建議——「今天大雨，建議在家」放到隔天就是假的，
 *    而 P8 說誠實不可交易。要做離線得先決定過期建議怎麼標示，那是另一個決定。
 * 2. **不用 next-pwa / Serwist。** 它們的價值在於自動產生 precache 清單，
 *    而我們刻意不 precache。剩下的部分是這五十行。
 * 3. **不快取這支檔案自己。** 註冊時給了 `updateViaCache: "none"`
 *    （見 `app/enable-push.tsx`），瀏覽器每次檢查更新都會重新抓。
 *    刻意不改 `next.config.ts` 的 headers——**執行期的映像裡沒有那個檔案**
 *    （Dockerfile 明講不複製 next.config.ts），在那裡設的標頭在正式環境
 *    不會生效，而症狀是「本機好好的，NAS 上拿到舊版 SW」。
 *
 * ⚠️ 這是純 JS、不經過建置，所以 **TypeScript 檢查不到它**。
 * 欄位名稱與 `lib/push/payload.ts` 是靠約定對齊的，改一邊要改兩邊。
 */

/* global self, clients */

// 裝好就接手，不等所有分頁關閉。單人使用的工具，沒有「舊分頁還在用舊版」
// 需要照顧的情境，而卡在 waiting 的 SW 收不到推播。
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * 收到推播。
 *
 * `userVisibleOnly: true` 是訂閱時的硬性條件：收到 push 就**必須**顯示通知，
 * 不顯示的話瀏覽器會替我們顯示一則「這個網站在背景執行」，
 * 連續幾次之後直接撤銷訂閱權限。所以這裡沒有「安靜地處理」這條路徑。
 */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // 解不開就用預設文案，而不是整個吞掉——使用者至少知道有東西進來了。
  }

  const title = payload.title || "KidGo";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag || "kidgo",
    data: { url: payload.url || "/today" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * 點通知。
 *
 * 已經開著的分頁優先聚焦，而不是每次都開新視窗——回饋通知（§9.2）
 * 一天會來第二則，開兩個分頁只會讓人搞不清楚哪個是新的。
 *
 * ⚠️ §13.2 第 8 條：**第二則推播須在通知內完成回饋，不得導流**。
 * 那需要 `showNotification` 帶 `actions`，並在這裡用 `event.action` 分流、
 * 直接 `fetch()` 回伺服器而**不開任何視窗**。排程與文案模板都還沒做，
 * 所以那條路徑目前不存在——但這個 handler 已經是它會長出來的地方。
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = (event.notification.data && event.notification.data.url) || "/today";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return clients.openWindow(target);
    }),
  );
});

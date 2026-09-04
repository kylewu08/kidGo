import "server-only";

import webpush, { WebPushError } from "web-push";

import type { PushPayload } from "./payload";
import type { BrowserPushSubscription } from "./subscription";
import { readVapidConfig, type VapidConfig } from "./vapid";

/**
 * 送出一則 Web Push（設計架構書 §9）
 *
 * ## 為什麼這裡引了依賴
 *
 * 本專案的先例是不引依賴：CSV 解析器（`c4eb02b`）、ZIP 讀取器
 * （`lib/import/zip.ts`）、PNG 編碼器（`scripts/generate-icons.mjs`）
 * 都是自己寫的，理由是「為六十行函式引依賴，對一個要離線跑在 NAS 上的
 * 專案不划算」。
 *
 * **Web Push 不是六十行。** 送一則推播要做 ECDH 金鑰協商、HKDF 導出
 * 金鑰、AES-128-GCM 加密內容，再用 ES256 簽一個 VAPID JWT。這是密碼學，
 * 而且是**寫錯了也照樣「看起來能跑」**的那種——瀏覽器只會靜默地丟掉
 * 解不開的訊息。自己寫的代價不是六十行，是把整個產品的主要形態
 * 押在一份沒有人審過的加密實作上。
 *
 * 所以這裡用 `web-push`（web-push-libs 的官方實作，零 runtime 依賴問題）。
 */

export type PushOutcome =
  /** 推播服務收下了。不代表使用者看到了——那件事伺服器永遠不會知道 */
  | { status: "sent" }
  /** 訂閱已失效（裝置移除了 App、或使用者關掉權限）。呼叫端應刪掉這一列 */
  | { status: "expired" }
  /** 其他失敗。訊息寫給開發者看 */
  | { status: "failed"; message: string };

let configured: VapidConfig | null = null;

/**
 * `setVapidDetails` 是全域設定，重複呼叫沒有壞處但也沒有必要。
 * 用讀到的設定本身當快取鍵，換金鑰重啟後不會沿用舊的。
 */
function ensureConfigured(config: VapidConfig): void {
  if (configured?.publicKey === config.publicKey) return;
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  configured = config;
}

export async function sendPush(
  subscription: BrowserPushSubscription,
  payload: PushPayload,
): Promise<PushOutcome> {
  const config = readVapidConfig(process.env);
  if (!config) {
    return { status: "failed", message: "伺服器尚未設定 VAPID 金鑰" };
  }
  ensureConfigured(config);

  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { status: "sent" };
  } catch (error) {
    /*
     * 404 / 410 是推播服務在說「這個訂閱不存在了」，那是**正常的生命週期**
     * 不是錯誤：使用者刪掉主畫面圖示、或瀏覽器清了站台資料就會這樣。
     * 分開回報，好讓呼叫端刪掉那一列——否則殭屍訂閱會一直累積，
     * 而每一則週末推播都要為它們各打一次沒有用的網路請求。
     */
    if (error instanceof WebPushError) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        return { status: "expired" };
      }
      return {
        status: "failed",
        message: `推播服務回 ${error.statusCode}：${error.body || error.message}`,
      };
    }
    return {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 訂閱的驗證與正規化（設計架構書 §9.4）
 *
 * 瀏覽器的 `PushSubscription.toJSON()` 經過 Server Action 傳過來時，
 * 型別已經在網路上遺失——收到的是 `unknown`。這裡把它擋回可信的形狀，
 * 而不是相信呼叫端。
 */

import { createHash } from "node:crypto";

/** `PushSubscription.toJSON()` 的形狀。DOM 的 PushSubscription 型別不能直接用。 */
export interface BrowserPushSubscription {
  endpoint: string;
  keys: {
    /** 訂閱端的公鑰（P-256，base64url） */
    p256dh: string;
    /** 加密用的驗證秘密（base64url） */
    auth: string;
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * 驗證 Server Action 收到的訂閱物件，形狀不對就回 `null`。
 *
 * `endpoint` 必須是 https：它是推播服務的位址，會被伺服器直接打。
 * 不驗這一項的話，一個被竄改的請求就能讓伺服器對任意 URL 發出 POST。
 */
export function parseSubscription(value: unknown): BrowserPushSubscription | null {
  if (typeof value !== "object" || value === null) return null;

  const { endpoint, keys } = value as { endpoint?: unknown; keys?: unknown };
  if (!isNonEmptyString(endpoint)) return null;
  if (!endpoint.startsWith("https://")) return null;

  if (typeof keys !== "object" || keys === null) return null;
  const { p256dh, auth } = keys as { p256dh?: unknown; auth?: unknown };
  if (!isNonEmptyString(p256dh) || !isNonEmptyString(auth)) return null;

  return { endpoint, keys: { p256dh, auth } };
}

/**
 * 主鍵取自 endpoint 的雜湊。
 *
 * endpoint 本身就是「哪一台裝置的哪一個瀏覽器」的唯一識別，拿它當鍵，
 * **同一台裝置重新訂閱時會覆蓋同一列而不是長出第二列**。
 *
 * 用雜湊而不是 endpoint 原文：那是一串一兩百字的 URL，當主鍵在每一次
 * 查詢與錯誤訊息裡都難讀，而我們從來不需要從主鍵反推 endpoint——
 * 要 endpoint 的時候欄位就在同一列上。
 */
export function subscriptionId(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 32);
}

"use server";

import {
  deletePushSubscription,
  listPushSubscriptions,
  markPushSubscriptionUsed,
  savePushSubscription,
} from "@/lib/db/queries";
import { TEST_NOTIFICATION } from "@/lib/push/payload";
import { sendPush } from "@/lib/push/send";
import { parseSubscription } from "@/lib/push/subscription";

/**
 * 推播訂閱的 Server Action（設計架構書 §9.4）
 *
 * 訂閱這件事只有瀏覽器做得到（`pushManager.subscribe`），但**訂閱的內容
 * 必須存在伺服器**——週末早晨那則推播是伺服器在無人互動下送出的
 * （§13.2 第 1 條的第二個理由），它得知道要送去哪裡。
 */

export type PushActionResult = { ok: true; message: string } | { ok: false; error: string };

/** 瀏覽器訂閱成功後把 `subscription.toJSON()` 傳過來存起來。 */
export async function subscribeToPushAction(raw: unknown): Promise<PushActionResult> {
  const subscription = parseSubscription(raw);
  if (!subscription) {
    // 這是程式錯誤不是使用者錯誤，所以留一筆伺服器日誌。
    console.error("收到形狀不正確的推播訂閱", raw);
    return { ok: false, error: "訂閱資料格式不正確" };
  }

  await savePushSubscription(subscription, new Date());
  return { ok: true, message: "這台裝置已訂閱" };
}

/** 取消訂閱。瀏覽器端也要 `subscription.unsubscribe()`，兩邊都要做。 */
export async function unsubscribeFromPushAction(endpoint: string): Promise<PushActionResult> {
  if (!endpoint) return { ok: false, error: "缺少 endpoint" };

  await deletePushSubscription(endpoint);
  return { ok: true, message: "已取消訂閱" };
}

/**
 * 送一則測試通知給**所有**已訂閱的裝置。
 *
 * 為什麼是所有裝置而不是當下這一台：§9.4 那個未驗事項
 * （iOS 加入主畫面之後到底收不收得到）要用 iPhone 驗，而按下按鈕的
 * 通常是手邊的電腦。只送給當下這台，等於驗不到真正要驗的那台。
 */
export async function sendTestPushAction(): Promise<PushActionResult> {
  const subscriptions = await listPushSubscriptions();
  if (subscriptions.length === 0) {
    return { ok: false, error: "還沒有任何裝置訂閱" };
  }

  const now = new Date();
  let sent = 0;
  let expired = 0;
  const failures: string[] = [];

  for (const row of subscriptions) {
    const outcome = await sendPush(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      TEST_NOTIFICATION,
    );

    if (outcome.status === "sent") {
      sent += 1;
      await markPushSubscriptionUsed(row.endpoint, now);
    } else if (outcome.status === "expired") {
      // 失效的訂閱在這裡淘汰。留著只會讓每一則推播都多打一次無用的請求。
      expired += 1;
      await deletePushSubscription(row.endpoint);
    } else {
      failures.push(outcome.message);
    }
  }

  if (sent === 0) {
    /*
     * 全部失敗時把原因原樣透出去。這是單人使用的工具，
     * 沒有需要對使用者隱藏內部細節的理由——同 app/api/weather/route.ts 的判斷，
     * 看得到「VAPID 金鑰沒設」或「推播服務回 403」才修得動。
     */
    return {
      ok: false,
      error: failures[0] ?? `${expired} 個訂閱都已失效，已清掉，請重新訂閱`,
    };
  }

  const notes = [
    expired > 0 ? `清掉 ${expired} 個失效訂閱` : null,
    failures.length > 0 ? `${failures.length} 個失敗：${failures[0]}` : null,
  ].filter(Boolean);

  return {
    ok: true,
    message: `已送出到 ${sent} 台裝置${notes.length > 0 ? `（${notes.join("；")}）` : ""}`,
  };
}

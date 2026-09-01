/**
 * 實際停留多久（ADR-0025）
 *
 * 原本停留時長只看地點：遊戲場先驗 90 分、圖書館 60 分。但使用者描述的
 * 真實行為不是那樣——
 *
 * > 好玩或有時間就多待，沒時間就早點走。我從來沒想過這個地點適合待多久。
 *
 * 而他 20 個月大的小孩不論去和平島還是去親子館，**都是大約一小時**。
 * 那是小孩的專注度上限，不是地點的性質。
 *
 * 所以停留時長取兩者的**較小值**：地點的先驗（有些地方待太短沒意義，
 * 例如導覽制的農場）與小孩撐得住的長度。
 *
 * ## 多小孩取最短的那一個
 *
 * 與 §7.2「取最低分而非平均」同一個保守原則：**你是在最小的那個崩潰時
 * 離開的**，不是在平均值離開。
 *
 * ## 為什麼這件事重要
 *
 * 停留時長同時進入兩個地方：硬過濾的「時間夠不夠來回」，
 * 以及時間軸的「幾點到家」——而後者正是午睡衝突判斷的依據。
 * 高估停留時間會讓遠一點但實際可行的地方被 not_enough_time 剔除，
 * 而使用者真正的約束是「12:00 前到家」，不是「車程幾分鐘」。
 */

import type { Child, Place } from "@/lib/db/schema";

export function effectiveStayMinutes(
  place: Pick<Place, "typicalDurationMinutes">,
  children: readonly Pick<Child, "attentionSpanMinutes">[],
): number {
  const spans = children
    .map((c) => c.attentionSpanMinutes)
    .filter((m): m is number => typeof m === "number" && m > 0);

  // 都沒填就沿用地點的先驗——這個欄位是選填的，不填不該改變任何行為。
  if (spans.length === 0) return place.typicalDurationMinutes;

  return Math.min(place.typicalDurationMinutes, ...spans);
}

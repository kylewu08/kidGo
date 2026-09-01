/**
 * 這份建議是給哪一天的（§9.1「時間點必須早於決策發生」）
 *
 * 晚上十點打開 App 時，「今天還剩下的時間不夠來回，建議在家」技術上正確，
 * 實際上沒用——**那個時間點沒有人在問今天**。§9.1 對推播的要求是
 * 「太晚送出，使用者已經自行決定了」，落地頁其實是同一個問題：
 * 太晚打開，它還在回答一個已經過去的問題。
 *
 * 所以可用時間窗過了就改算明天。
 *
 * **跨過午夜會自己回到「今天」**，不需要額外處理：00:30 時 `now` 早於
 * 當天的窗口結束，條件不成立，於是算的就是這一天——而那正是半小時前
 * 被稱為「明天」的同一天。日期換了，答案的內容是連續的。
 */

/** 明天的預設出發時間。今天用「現在」，明天不能用（那是半夜）。 */
export const TOMORROW_WINDOW_START = "08:30";

export interface DayTarget {
  kind: "today" | "tomorrow";
  /** 傳給推薦引擎的「現在」。明天的話是明天的窗口起點。 */
  timestamp: Date;
  window: { start: string; end: string };
}

function atClock(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
}

const clock = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

export function resolveTarget(
  now: Date,
  availableUntil: string,
  tomorrowStart: string = TOMORROW_WINDOW_START,
): DayTarget {
  const endToday = atClock(now, availableUntil);

  // 還在窗口內（含剛好等於起點的清晨）：算今天，從現在起算。
  if (now < endToday) {
    return {
      kind: "today",
      timestamp: now,
      window: { start: clock(now), end: availableUntil },
    };
  }

  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return {
    kind: "tomorrow",
    timestamp: atClock(tomorrow, tomorrowStart),
    window: { start: tomorrowStart, end: availableUntil },
  };
}

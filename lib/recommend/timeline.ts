/**
 * 時間與預報的純函式工具，Stage 1 與 Stage 2 共用。
 *
 * ⚠️ 這個檔案不在設計架構書 §8.2 列出的結構裡。加它的理由是行程時間軸的推算
 * （幾點出發、幾點到、幾點離開、幾點到家）同時是 Stage 1 的過濾依據和
 * Stage 2 作息契合度的計算依據，複製一份到兩處遲早會不一致。
 */

import type { Place, TimeWindow } from "@/lib/db/schema";
import { TIME_SLOT_RANGES } from "./thresholds";
import type { RecommendContext, TripTimeline, WeatherForecast } from "./types";
import type { TimeSlot } from "@/lib/db/schema";

const MS_PER_MINUTE = 60_000;

/** "HH:MM" → 從當日 00:00 起算的分鐘數 */
export function parseClock(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** 把 "HH:MM" 套用到某個日期上，得到當地時間的 Date */
export function atClock(day: Date, hhmm: string): Date {
  const d = new Date(day);
  const [h, m] = hhmm.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

/** 一個時間區間的長度（分鐘） */
export function windowMinutes(window: TimeWindow): number {
  return parseClock(window.end) - parseClock(window.start);
}

/** Date → "HH:MM" */
export function formatClock(at: Date): string {
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** 從當日 00:00 起算的小時數（含小數），用於比對 TIME_SLOT_RANGES */
export function hourOfDay(at: Date): number {
  return at.getHours() + at.getMinutes() / 60;
}

/**
 * 某個時刻與一個時段的接近程度，0–1。
 *
 * 區間內為 1；離開區間後在 `softEdgeMinutes` 內線性遞減到 0；再遠則為 0。
 *
 * 用柔化邊界而非硬性判斷的理由：morning 若定義為 09:00–11:30，
 * 硬邊界會讓 11:29 出發拿滿分、11:31 出發拿零分。差兩分鐘差 15 分，
 * 那個懸崖不對應任何真實的育兒經驗——小孩不會在 11:30 整點變得不適合出門。
 */
export function slotProximity(
  at: Date,
  slot: TimeSlot,
  softEdgeMinutes: number,
): number {
  const range = TIME_SLOT_RANGES[slot];
  const hour = hourOfDay(at);
  if (hour >= range.startHour && hour < range.endHour) return 1;

  const softEdgeHours = softEdgeMinutes / 60;
  if (softEdgeHours <= 0) return 0;

  const distance =
    hour < range.startHour ? range.startHour - hour : hour - range.endHour;
  return Math.max(0, 1 - distance / softEdgeHours);
}

/** 某個時刻落在哪個 TimeSlot。清晨與夜間不屬於任何時段，回傳 null。 */
export function timeSlotOf(at: Date): TimeSlot | null {
  const hour = hourOfDay(at);
  for (const [slot, range] of Object.entries(TIME_SLOT_RANGES)) {
    if (hour >= range.startHour && hour < range.endHour) {
      return slot as TimeSlot;
    }
  }
  return null;
}

/**
 * 這次評分該用哪個車程（ADR-0005）。
 *
 * 有即時路況就用即時的，沒有就退回建檔時填的基準值。
 * **缺席是正常狀況不是錯誤**——離線、API 失敗、超出免費額度都會走到這裡，
 * 而 P6 要求那些情況下功能仍然可用。
 */
export function effectiveDriveMinutes(
  place: Place,
  context: Pick<RecommendContext, "liveDriveMinutes">,
): { minutes: number; source: "live" | "baseline" } {
  const live = context.liveDriveMinutes?.get(place.id);
  return live === undefined
    ? { minutes: place.driveMinutes, source: "baseline" }
    : { minutes: live, source: "live" };
}

/**
 * 推算一趟出遊的時間軸。
 *
 * 出發時間取「現在」與「可用區間起點」的較晚者：使用者可能在 08:00 就打開 App
 * 但可用時間是 09:00 開始，此時該用 09:00 算，否則會高估能玩多久。
 */
export function buildTimeline(
  place: Place,
  now: Date,
  availableWindow: TimeWindow,
  /** 覆寫車程。不給則用建檔時的基準值。見 effectiveDriveMinutes。 */
  driveMinutes: number = place.driveMinutes,
): TripTimeline {
  const windowStart = atClock(now, availableWindow.start);
  const departAt = new Date(Math.max(now.getTime(), windowStart.getTime()));
  const arriveAt = new Date(departAt.getTime() + driveMinutes * MS_PER_MINUTE);
  const leaveAt = new Date(
    arriveAt.getTime() + place.typicalDurationMin * MS_PER_MINUTE,
  );
  const homeAt = new Date(leaveAt.getTime() + driveMinutes * MS_PER_MINUTE);
  return { departAt, arriveAt, leaveAt, homeAt };
}

/** 從現在到可用區間結束，還剩多少分鐘 */
export function remainingMinutes(now: Date, availableWindow: TimeWindow): number {
  const end = atClock(now, availableWindow.end);
  const start = atClock(now, availableWindow.start);
  const from = Math.max(now.getTime(), start.getTime());
  return Math.max(0, (end.getTime() - from) / MS_PER_MINUTE);
}

/**
 * 取某個時間區間內的預報極值。
 *
 * 取**最大**降雨機率與最大體感溫度，不是平均：出遊期間只要有一段時間會下大雨，
 * 整趟就毀了。平均會把一個 90% 的時段和兩個 10% 的時段稀釋成 37%，
 * 那正好是最不該發生的稀釋。
 *
 * 區間內沒有任何預報資料時回傳 null，呼叫端必須自行決定如何處理——
 * 不預設「沒資料就是好天氣」。
 */
export function forecastPeak(
  forecast: WeatherForecast,
  from: Date,
  to: Date,
): { rainProbability: number; apparentTempC: number } | null {
  // 三小時區間只要與 [from, to] 有交集就算數，包含 from 之前開始、
  // 但仍涵蓋 from 的那一段。
  const relevant = forecast.slots.filter((slot) => {
    const slotEnd = new Date(slot.startsAt.getTime() + 3 * 60 * MS_PER_MINUTE);
    return slot.startsAt < to && slotEnd > from;
  });
  if (relevant.length === 0) return null;

  return {
    rainProbability: Math.max(...relevant.map((s) => s.rainProbability)),
    apparentTempC: Math.max(...relevant.map((s) => s.apparentTempC)),
  };
}

/** 兩個時間區間是否重疊 */
export function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

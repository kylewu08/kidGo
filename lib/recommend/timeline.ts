/**
 * 時間、車程與預報的純函式工具，Stage 1 與 Stage 2 共用。
 *
 * 行程時間軸同時是 Stage 1 的過濾依據與 Stage 2 作息分數的計算依據，
 * 複製一份到兩處遲早會不一致。
 */

import type { Place, TimeSlot, TimeWindow } from "@/lib/db/schema";
import { baselineDriveMinutes, coarseDriveMinutes } from "@/lib/domain/drive-estimate";
import { TIME_SLOT_RANGES } from "./thresholds";
import type {
  DriveEstimate,
  RecommendContext,
  TripTimeline,
  WeatherForecast,
} from "./types";

const MS_PER_MINUTE = 60_000;

export function parseClock(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function atClock(day: Date, hhmm: string): Date {
  const d = new Date(day);
  const [h, m] = hhmm.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

export function formatClock(at: Date): string {
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

export function hourOfDay(at: Date): number {
  return at.getHours() + at.getMinutes() / 60;
}

/**
 * 某個時刻與一個時段的接近程度 0–1。
 * 區間內為 1，離開後於 softEdgeMinutes 內線性遞減到 0。
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

/**
 * 這次要用哪個車程。
 *
 * 有精算就用精算（去回程各自的值），沒有就退回幾何估計。
 * **缺席是正常狀況不是錯誤**——離線、API 失敗、超出額度都會走到這裡，
 * 而 P9 要求那些情況下功能仍然可用（§10.3.5）。
 *
 * 幾何估計無法區分方向（同一條路的幾何長度一樣），所以降級時去回程相同。
 * 這正是為什麼精算存在：§7.1 說「回程必須獨立計算」，而只有即時路況做得到。
 */
export function driveFor(
  place: Place,
  context: Pick<RecommendContext, "home" | "dayType" | "preciseDrive">,
): DriveEstimate {
  const baselineMinutes = baselineDriveMinutes(context.home, place);
  const precise = context.preciseDrive?.get(place.id);

  if (precise) {
    return { ...precise, source: "precise", baselineMinutes };
  }

  const coarse = coarseDriveMinutes(context.home, place, context.dayType);
  return {
    outboundMinutes: coarse,
    returnMinutes: coarse,
    source: "coarse",
    baselineMinutes,
  };
}

/**
 * 推算一趟出遊的時間軸。
 *
 * 出發時間取「現在」與「可用區間起點」的較晚者：使用者可能在 08:00 就看到推播，
 * 但可用時間從 09:00 開始，此時該用 09:00 算，否則會高估能玩多久。
 *
 * **回到家的時間用回程車程**，這是 §7.1 的重點——
 * 「能否在午睡前返家」依賴的是回程，不是去程。
 */
export function buildTimeline(
  place: Place,
  now: Date,
  availableWindow: TimeWindow,
  drive: DriveEstimate,
  /**
   * 實際停留多久。不給就用地點的先驗。
   * 由 effectiveStayMinutes 算出（ADR-0025）——小孩的專注度可能比
   * 地點的先驗短，而**幾點到家**正是午睡衝突判斷的依據。
   */
  stayMinutes: number = place.typicalDurationMinutes,
): TripTimeline {
  const windowStart = atClock(now, availableWindow.start);
  const departAt = new Date(Math.max(now.getTime(), windowStart.getTime()));
  const arriveAt = new Date(departAt.getTime() + drive.outboundMinutes * MS_PER_MINUTE);
  const leaveAt = new Date(arriveAt.getTime() + stayMinutes * MS_PER_MINUTE);
  const homeAt = new Date(leaveAt.getTime() + drive.returnMinutes * MS_PER_MINUTE);
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
 * 取**最大**降雨機率與體感溫度，不是平均：出遊期間只要有一段會下大雨，
 * 整趟就毀了。平均會把一個 90% 與兩個 10% 稀釋成 37%，
 * 那正好是最不該發生的稀釋。
 *
 * 區間內沒有資料時回傳 null——**不預設「沒資料就是好天氣」。**
 */
export function forecastPeak(
  forecast: WeatherForecast,
  from: Date,
  to: Date,
): { rainProbability: number; apparentTempC: number } | null {
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

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

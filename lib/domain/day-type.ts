/**
 * 車程日型係數（設計架構書 v1.0 §11.2）
 *
 * 用於粗篩，以及即時路況取得失敗時的降級估算。
 *
 * ⚠️ 領域判斷，不得自行推導或更改（§11）。
 */

import type { DayType } from "@/lib/db/schema";

/** 日型 × 是否走國道 → 車程倍數 */
export const DAY_TYPE_COEFFICIENTS: Record<
  DayType,
  { freeway: number; local: number }
> = {
  weekday: { freeway: 1.0, local: 1.0 },
  weekend: { freeway: 1.3, local: 1.1 },
  /**
   * 連假的國道係數是 2.0——這正是接即時路況的理由（ADR-0005）：
   * 路況變異 20–40 分鐘，遠大於找車位的 5–10 分鐘。
   */
  long_weekend: { freeway: 2.0, local: 1.2 },
  public_holiday: { freeway: 1.7, local: 1.2 },
};

/**
 * **不走國道的地點幾乎不受連假影響**（§11.2），這是成本優化的關鍵：
 * 真正需要精算的通常只有少數幾個（§10.3.2）。
 */
export function driveCoefficient(dayType: DayType, usesFreeway: boolean): number {
  const c = DAY_TYPE_COEFFICIENTS[dayType];
  return usesFreeway ? c.freeway : c.local;
}

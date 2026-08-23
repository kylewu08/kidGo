/**
 * 月齡與作息階段（設計架構書 附錄）
 *
 * 這裡的對照表**僅為推薦引擎的預設起點**，實際以 Child 的手動設定為準。
 * 設計架構書把這件事講得很明白：napStage 允許手動覆寫，因為實際作息永遠比對照表準。
 *
 * 純函式，無副作用。
 */

import type { NapStage, TimeWindow } from "@/lib/db/schema";

/**
 * 計算某個日期時的月齡。
 *
 * 用「年月差再依日數調整」而非除以平均月長：小孩的月齡是照曆法算的，
 * 「滿 18 個月」指的是出生日期加 18 個月，不是 547.5 天。
 */
export function ageInMonths(birthDate: string, at: Date): number {
  const [y, m, d] = birthDate.split("-").map(Number);
  let months = (at.getFullYear() - y) * 12 + (at.getMonth() + 1 - m);
  if (at.getDate() < d) months -= 1;
  return Math.max(0, months);
}

/** 依月齡推算的預設作息階段（附錄對照表）。使用者可覆寫。 */
export function defaultNapStage(months: number): NapStage {
  if (months < 14) return "two_naps";
  if (months < 24) return "one_nap";
  if (months < 36) return "transitioning";
  return "no_nap";
}

/** 依作息階段推算的預設午睡窗（附錄對照表）。使用者可覆寫。 */
export function defaultNapWindows(stage: NapStage): TimeWindow[] {
  switch (stage) {
    case "two_naps":
      return [
        { start: "09:30", end: "10:30" },
        { start: "13:00", end: "14:30" },
      ];
    case "one_nap":
      return [{ start: "12:30", end: "14:30" }];
    case "transitioning":
      // 過渡期的午睡時間飄移大，窗口刻意放寬——寧可保守，
      // 誤判「不會睡」而排了長行程，代價比誤判「會睡」大。
      return [{ start: "12:30", end: "15:00" }];
    case "no_nap":
      return [];
  }
}

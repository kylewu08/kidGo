/**
 * Stage 1 — 硬性過濾（設計架構書 §6.2）
 *
 * 這一層編碼的是 L1 判斷力：開發者腦中既有的育兒常識。
 * **它在零紀錄狀態下就能完成，這是產品第一天可用的原因**（設計架構書 §2）。
 *
 * 過完這一層，50 個地點通常只剩 5–10 個。
 *
 * 所有門檻值來自 thresholds.ts，這裡不出現任何魔術數字。
 */

import type { Child, Place } from "@/lib/db/schema";
import { ageInMonths } from "@/lib/schedule/napStage";
import { THRESHOLDS } from "./thresholds";
import { buildTimeline, forecastPeak, remainingMinutes } from "./timeline";
import type { FilterResult, RecommendContext, RejectionReason } from "./types";

/** 一個地點被剔除時，回傳理由；通過則回傳 null。 */
function rejectionFor(
  place: Place,
  context: RecommendContext,
  warnings: string[],
): RejectionReason | null {
  const { timestamp, children, maxDriveMinutes, availableWindow } = context;

  // 1. 車程超過上限
  if (place.driveMinutes > maxDriveMinutes) {
    return "drive_too_long";
  }

  // 2. 可用時間不足以來回加上像樣的停留
  //    minimumStayRatio 的意思是「至少待得到六成的典型時長才值得去」。
  const requiredMinutes =
    place.driveMinutes * 2 +
    place.typicalDurationMin * THRESHOLDS.minimumStayRatio;
  if (remainingMinutes(timestamp, availableWindow) < requiredMinutes) {
    return "not_enough_time";
  }

  // 3 & 4. 天氣。只針對 indoor === "outdoor"，這是設計架構書 §6.2 的字面規定——
  //        covered_outdoor 與 mixed 有退路，不在硬性剔除的範圍。
  if (place.indoor === "outdoor") {
    const timeline = buildTimeline(place, timestamp, availableWindow);
    const peak = forecastPeak(context.weather, timeline.departAt, timeline.homeAt);

    if (peak === null) {
      // 刻意不預設「沒資料就是好天氣」。地點留在清單裡，但要說出來。
      warnings.push("這段時間沒有天氣預報資料，戶外地點請自行確認");
    } else {
      if (peak.rainProbability > THRESHOLDS.rainProbabilityExcludeOutdoor) {
        return "rain";
      }
      if (
        peak.apparentTempC > THRESHOLDS.apparentTempExcludeOutdoor &&
        place.shadeLevel <= THRESHOLDS.heatExemptShadeLevelAbove
      ) {
        return "heat";
      }
    }
  }

  // 5 & 6. 小孩相關。**任何一個小孩不適合就整個剔除**，不是多數決。
  //        理由與 Stage 2 取最低分相同：只要有一個不適合，整趟就毀了（§6.3）。
  for (const child of children) {
    const months = ageInMonths(child.birthDate, timestamp);
    if (months < place.ageRange.minMonths || months > place.ageRange.maxMonths) {
      return "age_out_of_range";
    }
    if (child.mobility === "stroller" && !place.strollerFriendly) {
      return "stroller_unfriendly";
    }
  }

  return null;
}

/** 不影響通過與否，但要提醒使用者的事項（設計架構書 §6.2 最後一條） */
function collectWarnings(place: Place, children: Child[]): string[] {
  const warnings: string[] = [];

  // 需預約且是當日決策 → 標記警示，不剔除。
  // 「今天去哪」的使用情境天生就是當日決策，所以這個警示總是會出現。
  if (place.needsReservation) {
    warnings.push("需要預約，出發前先確認今天還有位子");
  }

  // 這不在設計架構書的清單裡，但屬於同一類「不剔除但要說」的資訊：
  // 有小孩還在需要換尿布的月齡，而地點沒有尿布台。
  const hasDiaperAge = children.some(
    (c) => c.mobility === "carried" || c.mobility === "stroller",
  );
  if (hasDiaperAge && !place.hasChangingTable) {
    warnings.push("沒有尿布台");
  }

  return warnings;
}

/**
 * 對所有地點執行 Stage 1。
 *
 * **被剔除的地點也保留在結果裡**，附上 `passed: false` 與剔除原因。
 * 理由：調門檻是長期工作，看得到「什麼被剔除、為什麼」才調得動。
 * 只回傳通過的地點會讓 thresholds.ts 變成一個沒有回饋的黑箱。
 */
export function applyStage1(
  places: Place[],
  context: RecommendContext,
): FilterResult[] {
  return places.map((place) => {
    const warnings = collectWarnings(place, context.children);
    const rejectedBy = rejectionFor(place, context, warnings);
    return rejectedBy === null
      ? { place, passed: true, warnings }
      : { place, passed: false, rejectedBy, warnings };
  });
}

/**
 * Stage 1 — 硬性過濾（設計架構書 v1.0 §7.1）
 *
 * 這一層用掉 **L1 判斷力**：育兒常識，第一天就具備，不需要任何歷史紀錄。
 * 通常能將數百筆縮減至個位數——**這是產品第一天就能用的原因**（§3）。
 *
 * 所有門檻來自 thresholds.ts，這裡不出現任何魔術數字。
 */

import type { Child, Place } from "@/lib/db/schema";
import { facilityCoversAge } from "@/lib/domain/age-bands";
import { ageInMonths } from "@/lib/schedule/napStage";
import { THRESHOLDS } from "./thresholds";
import { buildTimeline, driveFor, forecastPeak, remainingMinutes } from "./timeline";
import type {
  DriveEstimate,
  FilterResult,
  RecommendContext,
  RejectionReason,
} from "./types";

/**
 * 套用一次性情境覆寫（§8）。
 *
 * **僅覆寫既有條件，不新增評分因子。** 呼叫端必須already驗證過範圍，
 * 這裡只負責取值。
 */
export function effectiveLimits(context: RecommendContext) {
  const o = context.contextOverride;
  return {
    maxDriveMinutes: o?.maxDriveMinutes ?? context.maxDriveMinutes,
    availableWindow: o?.availableWindow ?? context.availableWindow,
    maxParentEffort: o?.maxParentEffort ?? context.familyPreference.maxParentEffort,
    maxEnergyBurn: o?.maxEnergyBurn ?? null,
  };
}

/** 這個小孩是否處於「幼兒階段」（§7.1「需抱／續航短」） */
function isToddlerStage(child: Child): boolean {
  return (THRESHOLDS.toddlerMobilities as readonly string[]).includes(child.mobility);
}

function rejectionFor(
  place: Place,
  context: RecommendContext,
  drive: DriveEstimate,
  warnings: string[],
): RejectionReason | null {
  const { timestamp, children } = context;
  const limits = effectiveLimits(context);

  // --- 1. 車程 -------------------------------------------------------------
  // 粗估時把門檻放寬（§7.1「避免粗估誤差誤殺」），精算時用實際上限。
  // 這是整條管線唯一的誤差緩衝（ADR-0014）。
  const driveLimit =
    drive.source === "coarse"
      ? limits.maxDriveMinutes * THRESHOLDS.coarseDriveSlack
      : limits.maxDriveMinutes;
  if (drive.outboundMinutes > driveLimit) return "drive_too_long";

  // --- 2. 時間：去程 + 停留 + 回程 ------------------------------------------
  // §7.1 明列三段，回程用它自己的值——早上出發與下午返程是不同的路況。
  const requiredMinutes =
    drive.outboundMinutes + place.typicalDurationMinutes + drive.returnMinutes;
  if (remainingMinutes(timestamp, limits.availableWindow) < requiredMinutes) {
    return "not_enough_time";
  }

  // --- 3 & 4. 天氣（僅針對純戶外，§7.1 的字面規定）-------------------------
  if (place.indoorType === "outdoor") {
    const timeline = buildTimeline(place, timestamp, limits.availableWindow, drive);
    const peak = forecastPeak(context.weather, timeline.departAt, timeline.homeAt);

    if (peak === null) {
      // 刻意不預設「沒資料就是好天氣」。地點留著，但要說出來。
      warnings.push("這段時間沒有天氣預報資料，戶外地點請自行確認");
    } else {
      if (peak.rainProbability > THRESHOLDS.rainProbabilityExcludeOutdoor) return "rain";
      if (
        peak.apparentTempC > THRESHOLDS.apparentTempExcludeOutdoor &&
        place.shadeLevel <= THRESHOLDS.heatExemptShadeLevelAbove
      ) {
        return "heat";
      }
    }
  }

  // --- 5. 家長負擔（§7.1 新增）---------------------------------------------
  // §6.2：決定要不要去的是家長。「小孩玩得開心但家長累垮」與「兩者皆可」
  // 是不同的結果，而任何懶人包都不會記錄這件事。
  if (place.parentEffort > limits.maxParentEffort) return "parent_effort_too_high";

  // --- 6. 一次性情境的放電強度上限（§8）------------------------------------
  if (limits.maxEnergyBurn !== null && place.energyBurn > limits.maxEnergyBurn) {
    return "parent_effort_too_high";
  }

  // --- 7–10. 小孩相關 -------------------------------------------------------
  // **任何一個小孩不適合就整個剔除**，不是多數決。理由與 Stage 2 取最低分相同：
  // 只要有一個不適合，整趟就毀了（§7.2）。
  for (const child of children) {
    const months = ageInMonths(child.birthDate, timestamp);

    if (
      months < place.suitableAgeMonths.minMonths ||
      months > place.suitableAgeMonths.maxMonths
    ) {
      return "age_out_of_range";
    }

    if (child.mobility === "stroller" && !place.strollerFriendly) {
      return "stroller_unfriendly";
    }

    // 適齡：有遊具但不含小孩年齡層，**且無可奔跑空間可替代**（§7.1）。
    //
    // §7.1 特別強調「適齡必須是硬過濾，不是扣分項」——家長不會「去了才發現
    // 不適合」，而是看到現場只有大型遊具就事前排除。
    //
    // 可跑空間是替代品：§6.2 的美術館沒有遊具，但可跑、家長不累、有冷氣、
    // 跑不掉，對 20 個月幼兒是好選擇。
    const hasFacility = place.facilityAgeBands !== null;
    const facilityFits = facilityCoversAge(place.facilityAgeBands, months);
    const canRunInstead = place.runnableSpace >= THRESHOLDS.runnableSpaceCompensatesAge;
    if (hasFacility && !facilityFits && !canRunInstead) {
      return "facility_age_mismatch";
    }

    // 安全：幼兒階段且安全封閉性過低（§7.1）。
    // 0＝鄰接車道或開放水域——對還在被抱著的小孩那不是「要多留意」，是不能去。
    if (
      isToddlerStage(child) &&
      place.safetyEnclosure < THRESHOLDS.minSafetyEnclosureForToddlers
    ) {
      return "unsafe_for_toddler";
    }
  }

  return null;
}

/** 不影響通過與否，但要提醒使用者的事項 */
function collectWarnings(
  place: Place,
  drive: DriveEstimate,
  context: RecommendContext,
): string[] {
  const warnings: string[] = [];

  // §10.3.5：降級為係數估算時**必須明示**，不得靜默使用低信心估值。
  if (drive.source === "coarse") {
    warnings.push("路況資料暫時無法取得，車程為估算值");
  }

  // 匯入資料被使用者標記為可疑（ADR-0011「看了覺得不適合」）
  if (place.dataSuspect) {
    warnings.push(
      place.dataSuspectReason
        ? `你先前標記過這裡的資料可能有問題：${place.dataSuspectReason}`
        : "你先前標記過這裡的資料可能有問題",
    );
  }

  const anyToddler = context.children.some(isToddlerStage);
  if (anyToddler && place.safetyEnclosure < 2) {
    warnings.push("空間較開放，需要全程留意");
  }

  return warnings;
}

/**
 * 對所有地點執行 Stage 1。
 *
 * **被剔除的地點也保留在結果裡**，附上原因。
 * 理由：調門檻是長期工作，看得到「什麼被剔除、為什麼」才調得動。
 * 只回傳通過的地點會讓 thresholds.ts 變成一個沒有回饋的黑箱。
 */
export function applyStage1(
  places: Place[],
  context: RecommendContext,
): FilterResult[] {
  return places.map((place) => {
    const drive = driveFor(place, context);
    const warnings = collectWarnings(place, drive, context);
    const rejectedBy = rejectionFor(place, context, drive, warnings);
    return rejectedBy === null
      ? { place, passed: true, warnings, drive }
      : { place, passed: false, rejectedBy, warnings, drive };
  });
}

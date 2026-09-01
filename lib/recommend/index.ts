/**
 * 推薦引擎的進入點（設計架構書 v1.0 §7、§7.6）
 *
 * **純函式：無副作用、不讀資料庫、不呼叫網路、不依賴 UI 狀態。**
 *
 * §7.6 的兩個理由：其一，調整權重是長期持續的工作，沒有單元測試會越調越亂；
 * 其二，**推播需在伺服器端於無使用者互動的情況下執行**，
 * 任何對 UI 狀態的依賴都會使此形態無法成立。
 *
 * 外部資料（天氣、路況、紀錄、日型、家庭偏好）由呼叫端取得後傳入。
 */

import type { Place, Visit } from "@/lib/db/schema";
import { ageInMonths } from "@/lib/schedule/napStage";
import { applyStage3 } from "./diversity";
import { applyStage1, effectiveLimits } from "./filters";
import { explain } from "./reasons";
import { effectiveStayMinutes } from "./stay";
import { breakdownForChild, shouldSuppressPreference, totalScore } from "./scoring";
import { buildTimeline, forecastPeak, formatClock } from "./timeline";
import type {
  FilterResult,
  RecommendContext,
  Recommendation,
  RecommendResult,
} from "./types";

export function recommend(
  places: Place[],
  visits: Visit[],
  context: RecommendContext,
): RecommendResult {
  if (context.children.length === 0) {
    // 沒有小孩就沒有推薦可言。安靜地回傳空陣列會讓呼叫端難以除錯，
    // 所以讓它壞在最接近原因的地方。
    throw new Error("recommend() 需要至少一個 Child，那是推薦邏輯的支點");
  }

  const stage1 = applyStage1(places, context);
  const survivors = stage1.filter((r) => r.passed);
  const rejected = stage1.filter((r) => !r.passed);

  if (survivors.length === 0) {
    return {
      slots: [],
      scored: [],
      rejected,
      noOutingReason: describeNoOuting(rejected, context),
      preferenceSuppressed: false,
    };
  }

  // §7.4 防線一：受限情境下偏好權重歸零，所有存活選項以原始分數競爭。
  // 判斷用的是「現在起算的一段時間」，而不是某個地點的行程——
  // 抑制與否是全域的決定，不該因地點而異。
  const windowEnd = new Date(context.timestamp.getTime() + 6 * 3600_000);
  const peak = forecastPeak(context.weather, context.timestamp, windowEnd);
  const preferenceSuppressed = shouldSuppressPreference(
    context,
    survivors.length,
    peak,
  );

  const scored = survivors
    .map((result) => scorePlace(result, visits, context, preferenceSuppressed))
    .sort((a, b) => b.score - a.score);

  return {
    slots: applyStage3(scored, context),
    scored,
    rejected,
    noOutingReason: null,
    preferenceSuppressed,
  };
}

/**
 * 對每個小孩獨立算分，**取最低分而非平均**（§7.2）。
 *
 * 刻意的保守設計：只要有一個不適合，整趟就毀了。
 * 平均會讓「老大玩得很開心、老二全程崩潰」看起來像一次還可以的出遊。
 */
function scorePlace(
  result: FilterResult,
  visits: Visit[],
  context: RecommendContext,
  preferenceSuppressed: boolean,
): Recommendation {
  const { place, warnings, drive } = result;
  const limits = effectiveLimits(context);
  const timeline = buildTimeline(
    place,
    context.timestamp,
    limits.availableWindow,
    drive,
    effectiveStayMinutes(place, context.children),
  );

  const perChild = context.children.map((child) => {
    const months = ageInMonths(child.birthDate, context.timestamp);
    const breakdown = breakdownForChild(
      place,
      child,
      months,
      visits,
      context,
      timeline,
      drive,
      preferenceSuppressed,
    );
    return { child, months, breakdown, score: totalScore(breakdown) };
  });

  const weakest = perChild.reduce((min, cur) => (cur.score < min.score ? cur : min));

  // 「候選 / 已驗證」由造訪紀錄導出，不存成欄位（§6.2）
  const status = visits.some((v) => v.placeId === place.id) ? "verified" : "candidate";

  const explanation = explain({
    place,
    breakdown: weakest.breakdown,
    // 理由取自分數最低的那個小孩，與顯示的總分同一個來源——
    // 若理由講老大而分數扣在老二身上，使用者會看到前後矛盾的說明。
    weakestChild: weakest.child,
    weakestChildAgeMonths: weakest.months,
    context,
    timeline,
    drive,
    visits,
    status,
  });

  return {
    place,
    slot: null,
    score: weakest.score,
    scoreBreakdown: weakest.breakdown,
    perChildScores: perChild.map((p) => ({ childId: p.child.id, score: p.score })),
    drive,
    reasons: explanation.reasons,
    // Stage 1 的警示（估算車程、資料可疑）與評分階段的警示（午睡、降雨、高溫）
    // 合併成一份，使用者不需要知道它們來自不同階段。
    warnings: [...warnings, ...explanation.warnings],
    suggestedDeparture: formatClock(timeline.departAt),
    // §7.5：未造訪過的地點**不給精確返家時間**，其停留時長僅為估計值
    suggestedReturn: status === "verified" ? formatClock(timeline.homeAt) : null,
    status,
    timeline,
  };
}

/**
 * 「今天不要出門」的說明（§9.1）。
 *
 * **推播不得沉默，也不得降低標準硬推。**
 * 「今天大雨、體感 34°C，建議在家」是有價值的輸出——它省下了糾結的成本。
 */
function describeNoOuting(
  rejected: FilterResult[],
  context: RecommendContext,
): string {
  const counts = new Map<string, number>();
  for (const r of rejected) {
    if (r.rejectedBy) counts.set(r.rejectedBy, (counts.get(r.rejectedBy) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const windowEnd = new Date(context.timestamp.getTime() + 6 * 3600_000);
  const peak = forecastPeak(context.weather, context.timestamp, windowEnd);
  const weather = peak
    ? `降雨機率 ${peak.rainProbability}%、體感 ${peak.apparentTempC}°C`
    : null;

  switch (top) {
    case "rain":
      return weather ? `今天${weather}，建議在家` : "今天雨太大，建議在家";
    case "heat":
      return weather ? `今天${weather}，戶外太曬，建議在家` : "今天太熱，建議在家";
    case "not_enough_time":
      return "今天剩下的時間不夠來回，建議在家";
    case "drive_too_long":
      return "車程範圍內今天沒有合適的地方";
    default:
      return "今天沒有適合的地點，建議在家";
  }
}

export { applyStage1, effectiveLimits } from "./filters";
export { applyStage3, isWeatherProof } from "./diversity";
export { selectPrecisionShortlist } from "./precision";
export { pickReferenceNote, TRANSIENT_REJECTIONS } from "./reference";
export {
  COVERAGE_SCENARIOS,
  COVERAGE_TARGET,
  diagnoseCoverage,
  diagnoseScenario,
  importedOnly,
  type CoverageBaseline,
  type CoverageResult,
  type CoverageScenario,
} from "./coverage";
export { effectiveStayMinutes } from "./stay";
export { breakdownForChild, totalScore, shouldSuppressPreference } from "./scoring";
export { explain, REASON_THRESHOLDS } from "./reasons";
export { formatClock, driveFor, buildTimeline } from "./timeline";
export { THRESHOLDS, TIME_SLOT_RANGES } from "./thresholds";
export { SCORING, WEIGHTS, DIVERSITY } from "./weights";
export type {
  DriveEstimate,
  DriveLegs,
  DriveSource,
  FilterResult,
  RecommendContext,
  Recommendation,
  RecommendResult,
  RejectionReason,
  ScoreBreakdown,
  SlotKind,
  TripTimeline,
  WeatherForecast,
  WeatherSlot,
} from "./types";

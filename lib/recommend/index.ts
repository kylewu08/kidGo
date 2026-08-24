/**
 * 推薦引擎的進入點（設計架構書 §6、§8.3）
 *
 * **無副作用、不讀資料庫、不呼叫網路。**
 * 這是為了讓演算法能單獨寫單元測試——調權重是長期持續的工作，
 * 沒有測試會越調越亂（§8.3）。
 *
 * `context.timestamp` 由呼叫端傳入而非在函式內取 `new Date()`，
 * 同樣是為了可測試與可重現。
 *
 * ⚠️ 目前實作到 Stage 1 + Stage 2。尚缺 Stage 3 多樣性調整（§6.4）與
 * `reasons` 規則模板（§6.5），所以回傳型別是 `ScoredPlace[]` 而非
 * §8.3 所定義的 `Recommendation[]`。那兩項完成後型別會收斂。
 */

import type { Place, Visit } from "@/lib/db/schema";
import { applyStage1 } from "./filters";
import { breakdownForChild, totalScore } from "./scoring";
import { buildTimeline, effectiveDriveMinutes } from "./timeline";
import type { FilterResult, RecommendContext, ScoredPlace } from "./types";

export function recommend(
  places: Place[],
  visits: Visit[],
  context: RecommendContext,
): ScoredPlace[] {
  if (context.children.length === 0) {
    // 沒有小孩就沒有推薦可言。安靜地回傳全部或空陣列都會讓呼叫端難以除錯，
    // 所以直接讓它壞在最接近原因的地方。
    throw new Error("recommend() 需要至少一個 Child，這是推薦邏輯的支點");
  }

  return applyStage1(places, context)
    .filter((result) => result.passed)
    .map((result) => scorePlace(result, visits, context))
    .sort((a, b) => b.score - a.score);
}

/**
 * 對每個小孩獨立算分，**取最低分而非平均**（設計架構書 §6.3）。
 *
 * 這是刻意的保守設計：只要有一個小孩不適合，整趟就毀了。
 * 平均會讓「老大玩得很開心、老二全程崩潰」看起來像一次還可以的出遊。
 *
 * `scoreBreakdown` 取自**分數最低的那個小孩**，而不是重新平均——
 * breakdown 是除錯用的（§6.5），它必須解釋得了旁邊那個總分是怎麼來的。
 */
function scorePlace(
  result: FilterResult,
  visits: Visit[],
  context: RecommendContext,
): ScoredPlace {
  const { place, warnings } = result;
  const { minutes: driveMinutes, source } = effectiveDriveMinutes(place, context);
  const timeline = buildTimeline(
    place,
    context.timestamp,
    context.availableWindow,
    driveMinutes,
  );

  const perChild = context.children.map((child) => {
    const breakdown = breakdownForChild(
      place,
      child,
      visits,
      context,
      timeline,
      driveMinutes,
    );
    return { childId: child.id, breakdown, score: totalScore(breakdown) };
  });

  const weakest = perChild.reduce((min, current) =>
    current.score < min.score ? current : min,
  );

  return {
    place,
    driveMinutes,
    driveMinutesSource: source,
    score: weakest.score,
    scoreBreakdown: weakest.breakdown,
    perChildScores: perChild.map(({ childId, score }) => ({ childId, score })),
    warnings,
    timeline,
  };
}

export { applyStage1 } from "./filters";
export { breakdownForChild, totalScore } from "./scoring";
export { THRESHOLDS, TIME_SLOT_RANGES, DEFAULT_EXCLUDE_RECENT_DAYS } from "./thresholds";
export { SCORING, WEIGHTS } from "./weights";
export type {
  FilterResult,
  RecommendContext,
  RejectionReason,
  ScoreBreakdown,
  ScoredPlace,
  TripTimeline,
  WeatherForecast,
  WeatherSlot,
} from "./types";

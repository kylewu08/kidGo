/**
 * Stage 2 — 加權評分 0–100（設計架構書 §6.3）
 *
 * 六個因子各自算出 0–1 的分數，再依 weights.ts 的權重加總乘以 100。
 *
 * **多小孩情境：對每個小孩獨立算分，取最低分而非平均。**
 * 這是刻意的保守設計——只要有一個小孩不適合，整趟就毀了（§6.3）。
 *
 * 所有調參常數來自 weights.ts，這裡不出現任何魔術數字。
 */

import type { Child, Place, Visit } from "@/lib/db/schema";
import { ageInMonths } from "@/lib/schedule/napStage";
import { DEFAULT_EXCLUDE_RECENT_DAYS } from "./thresholds";
import { atClock, forecastPeak, overlaps, slotProximity } from "./timeline";
import type {
  RecommendContext,
  ScoreBreakdown,
  TripTimeline,
  WeatherForecast,
} from "./types";
import { SCORING, WEIGHTS } from "./weights";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const MS_PER_DAY = 86_400_000;

/** 兩個 "YYYY-MM-DD" / Date 之間相差幾天（以日曆日計） */
function daysBetween(from: string, to: Date): number {
  const [y, m, d] = from.split("-").map(Number);
  const fromMidnight = new Date(y, m - 1, d).getTime();
  const toMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((toMidnight - fromMidnight) / MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// 因子一：作息契合度 30% —— 依小孩而異
// ---------------------------------------------------------------------------

/**
 * 兩件事各佔一半：現在這個時段適不適合去這裡，以及行程會不會撞到午睡。
 *
 * 時段配對用柔化邊界（slotProximity）而非硬性命中，理由見 timeline.ts。
 * 地點填了多個時段時取最接近的那一個。
 *
 * 設計架構書 §2 與 §6.2 對「撞到午睡」的歸屬有矛盾（一個說剔除、一個說評分）。
 * 已裁定依 §6.2 實作為**評分**：衝突時作息分數的一半歸零，總分扣 15 分，
 * 但地點不會從清單消失。完整理由見 docs/adr/0004-nap-conflict-scores-not-filters.md。
 *
 * ⚠️ ADR-0004 附帶一項待辦：既然這類地點會出現在清單裡，§6.5 的 reasons/warnings
 * 就必須包含「這趟會撞到午睡」，否則使用者不知道它為什麼排在後面。
 */
function scoreSchedule(
  place: Place,
  child: Child,
  timeline: TripTimeline,
  now: Date,
): number {
  const slotMatch = (() => {
    if (place.bestTimeSlots.length === 0) {
      return SCORING.schedule.unknownSlotsScore;
    }
    // 取最接近的那個時段。地點常常填兩個時段（例如清晨與午睡後），
    // 只要貼近其中一個就算數。
    return Math.max(
      ...place.bestTimeSlots.map((slot) =>
        slotProximity(timeline.departAt, slot, SCORING.schedule.softEdgeMinutes),
      ),
    );
  })();

  const napFit = (() => {
    if (child.napWindows.length === 0) return 1; // no_nap 階段，無所謂
    const conflicts = child.napWindows.some((w) =>
      overlaps(
        timeline.departAt,
        timeline.homeAt,
        atClock(now, w.start),
        atClock(now, w.end),
      ),
    );
    return conflicts ? SCORING.schedule.napConflictScore : 1;
  })();

  return clamp01(
    SCORING.schedule.slotMatchShare * slotMatch +
      SCORING.schedule.napFitShare * napFit,
  );
}

// ---------------------------------------------------------------------------
// 因子二：年齡契合度 25% —— 依小孩而異
// ---------------------------------------------------------------------------

/**
 * 落在 sweetSpotAge 滿分；只落在 ageRange 則從 sweet spot 邊界向 ageRange 邊界
 * 線性遞減至 atRangeEdge。
 *
 * 注意這個函式不假設 Stage 1 已經過濾過月齡——評分必須能獨立測試（§8.3）。
 */
function scoreAge(place: Place, child: Child, now: Date): number {
  const months = ageInMonths(child.birthDate, now);
  const { ageRange, sweetSpotAge } = place;

  if (months < ageRange.minMonths || months > ageRange.maxMonths) return 0;
  if (!sweetSpotAge) return SCORING.age.unknownSweetSpot;
  if (months >= sweetSpotAge.minMonths && months <= sweetSpotAge.maxMonths) {
    return SCORING.age.inSweetSpot;
  }

  const [distance, span] =
    months < sweetSpotAge.minMonths
      ? [sweetSpotAge.minMonths - months, sweetSpotAge.minMonths - ageRange.minMonths]
      : [months - sweetSpotAge.maxMonths, ageRange.maxMonths - sweetSpotAge.maxMonths];

  // span 為 0 表示 sweet spot 剛好貼齊 ageRange 邊界，此時只要不在 sweet spot
  // 內就是邊緣，直接給邊緣分數。
  const ratio = span > 0 ? clamp01(distance / span) : 1;
  return clamp01(
    SCORING.age.inSweetSpot -
      ratio * (SCORING.age.inSweetSpot - SCORING.age.atRangeEdge),
  );
}

// ---------------------------------------------------------------------------
// 因子三：天氣適配度 20% —— 全體共用
// ---------------------------------------------------------------------------

/**
 * 用一個 0–1 的「暴露程度」係數統一處理下雨、高溫與低溫，
 * 而不是為四種 IndoorType 寫四組分支。
 *
 * 三種懲罰取最差的那一個（不是相乘）：又下雨又太熱的日子不該被扣兩次，
 * 因為使用者的實際感受是「今天不適合出門」這一件事，不是兩件事。
 */
function scoreWeather(
  place: Place,
  timeline: TripTimeline,
  forecast: WeatherForecast,
): number {
  const peak = forecastPeak(forecast, timeline.departAt, timeline.homeAt);
  // 沒有預報資料時給中性分數。Stage 1 已針對純戶外地點發出警示，
  // 這裡不再重複懲罰，也不假裝天氣很好。
  if (peak === null) return 0.5;

  const exposure = SCORING.weather.exposure[place.indoor];
  const { comfortableMaxTempC, comfortableMinTempC, tempPenaltySpanC } =
    SCORING.weather;

  const rainScore = 1 - exposure * (peak.rainProbability / 100);

  // 遮蔽只補償高溫，不補償下雨也不補償低溫——樹蔭擋不住雨，也不會讓人變暖。
  const shadeCompensation =
    (place.shadeLevel / 3) * SCORING.weather.maxShadeCompensation;
  const heatExposure = exposure * (1 - shadeCompensation);
  const heatExcess = Math.max(0, peak.apparentTempC - comfortableMaxTempC);
  const heatScore = 1 - clamp01(heatExcess / tempPenaltySpanC) * heatExposure;

  const coldDeficit = Math.max(0, comfortableMinTempC - peak.apparentTempC);
  const coldScore = 1 - clamp01(coldDeficit / tempPenaltySpanC) * exposure;

  const base = Math.min(rainScore, heatScore, coldScore);

  // 「晴天戶外加分」（§6.3）。只在三個條件都舒適時才給，
  // 而且加分與暴露程度成正比——好天氣對室內地點沒有意義。
  const isPleasant =
    peak.rainProbability <= SCORING.weather.sunnyMaxRainProbability &&
    heatExcess === 0 &&
    coldDeficit === 0;
  const bonus = isPleasant ? SCORING.weather.sunnyOutdoorBonus * exposure : 0;

  // 基礎分壓縮到 [0, 1 - 加分上限]，把最上面那一段留給晴天加分。
  //
  // 不這樣做的話，好天氣時室內與戶外都會撞到 1.0 的天花板，加分等於沒作用——
  // 這是測試「天氣好時戶外地點的分數高於室內地點」抓出來的。
  //
  // 副作用是室內地點的天氣分數永遠到不了 1.0，而這是對的：
  // 下雨天待在室內是止損，不是一個和晴天出門一樣好的選擇。
  const headroom = 1 - SCORING.weather.sunnyOutdoorBonus;
  return clamp01(base * headroom + bonus);
}

// ---------------------------------------------------------------------------
// 因子四：新鮮度 10% —— 全體共用
// ---------------------------------------------------------------------------

/** 距上次造訪越久越高；excludeRecentDays 內大幅降權（§6.3） */
function scoreFreshness(
  place: Place,
  visits: Visit[],
  now: Date,
  excludeRecentDays: number,
): number {
  const placeVisits = visits.filter((v) => v.placeId === place.id);
  if (placeVisits.length === 0) return 1; // 沒去過就是最新鮮的

  const daysSince = Math.min(...placeVisits.map((v) => daysBetween(v.date, now)));
  const { recentVisitCeiling, fullRecoveryDays } = SCORING.freshness;

  if (daysSince < excludeRecentDays) {
    // 剛去過 → 接近 0；剛好滿 excludeRecentDays → recentVisitCeiling
    return clamp01((daysSince / excludeRecentDays) * recentVisitCeiling);
  }

  const recovery = clamp01((daysSince - excludeRecentDays) / fullRecoveryDays);
  return clamp01(recentVisitCeiling + (1 - recentVisitCeiling) * recovery);
}

// ---------------------------------------------------------------------------
// 因子五：車程成本 10% —— 全體共用
// ---------------------------------------------------------------------------

/**
 * 非線性：30 分鐘內差異不大，超過後急降（§6.3）。
 *
 * 用指數衰減而非線性：40 分鐘和 30 分鐘的差別，遠小於 70 分鐘和 60 分鐘的差別——
 * 後者已經進入「小孩在車上就先睡著或先崩潰」的區間。
 */
function scoreDrive(place: Place): number {
  const { freeMinutes, scoreAtFreeBoundary, decayMinutes } = SCORING.drive;
  const minutes = place.driveMinutes;

  if (minutes <= freeMinutes) {
    return clamp01(1 - (minutes / freeMinutes) * (1 - scoreAtFreeBoundary));
  }
  return clamp01(
    scoreAtFreeBoundary * Math.exp(-(minutes - freeMinutes) / decayMinutes),
  );
}

// ---------------------------------------------------------------------------
// 因子六：歷史成效 5% —— 全體共用
// ---------------------------------------------------------------------------

/**
 * `Visit.outcome` 平均，`meltdown` 為負向（§6.3）。
 *
 * 這個因子只佔 5%，**紀錄筆數少於 20 筆前不得調高**（§2）。
 * 三筆紀錄算不出可信平均值，過度加權只會產生雜訊。
 */
function scoreHistory(place: Place, visits: Visit[]): number {
  const placeVisits = visits.filter((v) => v.placeId === place.id);
  if (placeVisits.length === 0) return SCORING.history.noVisitsScore;

  const avgOutcome =
    placeVisits.reduce((sum, v) => sum + v.outcome, 0) / placeVisits.length;
  const meltdownRate =
    placeVisits.filter((v) => v.meltdown).length / placeVisits.length;

  // outcome 是 1–5，映射到 0–1
  const base = (avgOutcome - 1) / 4;
  return clamp01(base - meltdownRate * SCORING.history.meltdownPenalty);
}

// ---------------------------------------------------------------------------
// 組合
// ---------------------------------------------------------------------------

/** 六個因子的原始分數 → 0–100 的總分 */
export function totalScore(breakdown: ScoreBreakdown): number {
  const sum = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).reduce(
    (acc, factor) => acc + WEIGHTS[factor] * breakdown[factor],
    0,
  );
  return sum * 100;
}

/** 針對單一小孩計算六個因子。共用因子每個小孩都一樣，依小孩而異的只有前兩項。 */
export function breakdownForChild(
  place: Place,
  child: Child,
  visits: Visit[],
  context: RecommendContext,
  timeline: TripTimeline,
): ScoreBreakdown {
  const excludeRecentDays =
    context.excludeRecentDays ?? DEFAULT_EXCLUDE_RECENT_DAYS;

  return {
    schedule: scoreSchedule(place, child, timeline, context.timestamp),
    age: scoreAge(place, child, context.timestamp),
    weather: scoreWeather(place, timeline, context.weather),
    freshness: scoreFreshness(place, visits, context.timestamp, excludeRecentDays),
    drive: scoreDrive(place),
    history: scoreHistory(place, visits),
  };
}

export const __testing = {
  scoreSchedule,
  scoreAge,
  scoreWeather,
  scoreFreshness,
  scoreDrive,
  scoreHistory,
  daysBetween,
};

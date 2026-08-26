/**
 * Stage 2 — 加權評分 0–100（設計架構書 v1.0 §7.2）
 *
 * 七個因子各自算出 0–1，再依 weights.ts 加權。
 *
 * **多小孩：對每個小孩獨立算分，取最低分而非平均。**
 * 刻意的保守設計——只要有一個不適合，整趟就毀了。
 */

import type { CategoryPreference, Child, Place, Visit } from "@/lib/db/schema";
import { facilityCoversAge } from "@/lib/domain/age-bands";
import { THRESHOLDS } from "./thresholds";
import { atClock, forecastPeak, overlaps, slotProximity } from "./timeline";
import type {
  DriveEstimate,
  RecommendContext,
  ScoreBreakdown,
  TripTimeline,
  WeatherForecast,
} from "./types";
import { SCORING, WEIGHTS } from "./weights";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const MS_PER_DAY = 86_400_000;

function daysBetween(from: string, to: Date): number {
  const [y, m, d] = from.split("-").map(Number);
  const fromMidnight = new Date(y, m - 1, d).getTime();
  const toMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((toMidnight - fromMidnight) / MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// 一：作息契合度 25% —— 依小孩而異
// ---------------------------------------------------------------------------

/**
 * 兩件事各佔一半：現在這個時段適不適合，以及行程會不會撞到午睡。
 *
 * 午睡判斷用 timeline.homeAt，而那是用**回程**車程算的（§7.1）。
 */
function scoreSchedule(
  place: Place,
  child: Child,
  timeline: TripTimeline,
  now: Date,
): number {
  const slotMatch =
    place.bestTimeSlots.length === 0
      ? SCORING.schedule.unknownSlotsScore
      : Math.max(
          ...place.bestTimeSlots.map((slot) =>
            slotProximity(timeline.departAt, slot, SCORING.schedule.softEdgeMinutes),
          ),
        );

  const napFit = (() => {
    if (child.napWindows.length === 0) return 1; // 已無午睡
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
    SCORING.schedule.slotMatchShare * slotMatch + SCORING.schedule.napFitShare * napFit,
  );
}

// ---------------------------------------------------------------------------
// 二：年齡契合度 20% —— 依小孩而異
// ---------------------------------------------------------------------------

/**
 * §7.2：「落在最適齡區間給滿分；**可奔跑空間可補償無適齡設施**」。
 *
 * 那句補償是 §6.2 整段論證的濃縮：美術館沒有遊具、放電強度低，
 * 但對 20 個月幼兒是好選擇，因為可跑、家長不累、有冷氣、跑不掉。
 * 只有「放電強度」的模型區分不出美術館與大型兒童樂園。
 */
function scoreAge(place: Place, child: Child, months: number): number {
  const hasFacility = place.facilityAgeBands !== null;

  if (hasFacility) {
    return facilityCoversAge(place.facilityAgeBands, months)
      ? SCORING.age.facilityMatches
      : SCORING.age.facilityMismatch;
  }

  // 無遊具設施：看可奔跑空間能不能替代
  return place.runnableSpace >= THRESHOLDS.runnableSpaceCompensatesAge
    ? SCORING.age.runnableCompensation
    : SCORING.age.noFacilityNoSpace;
}

// ---------------------------------------------------------------------------
// 三：天氣適配度 15% —— 全體共用
// ---------------------------------------------------------------------------

function scoreWeather(
  place: Place,
  timeline: TripTimeline,
  forecast: WeatherForecast,
): number {
  const peak = forecastPeak(forecast, timeline.departAt, timeline.homeAt);
  // 沒有預報資料時給中性分數。Stage 1 已對純戶外地點發出警示，
  // 這裡不重複懲罰，也不假裝天氣很好。
  if (peak === null) return 0.5;

  const w = SCORING.weather;
  const exposure = w.exposure[place.indoorType];

  const rainScore = 1 - exposure * (peak.rainProbability / 100);

  // 遮蔭只補償高溫，不補償下雨也不補償低溫——樹蔭擋不住雨，也不會讓人變暖。
  const shadeCompensation = (place.shadeLevel / 3) * w.maxShadeCompensation;
  const heatExcess = Math.max(0, peak.apparentTempC - w.comfortableMaxTempC);
  const heatScore =
    1 - clamp01(heatExcess / w.tempPenaltySpanC) * exposure * (1 - shadeCompensation);

  const coldDeficit = Math.max(0, w.comfortableMinTempC - peak.apparentTempC);
  const coldScore = 1 - clamp01(coldDeficit / w.tempPenaltySpanC) * exposure;

  // 三種懲罰取最差的，不相乘：使用者的實際感受是「今天不適合出門」這一件事，
  // 不是兩件事。
  const base = Math.min(rainScore, heatScore, coldScore);

  const isPleasant =
    peak.rainProbability <= w.sunnyMaxRainProbability &&
    heatExcess === 0 &&
    coldDeficit === 0;

  // 「晴天戶外加分」與「高溫時有冷氣加分」是同一個位置的兩種情況
  const bonus = isPleasant
    ? w.sunnyOutdoorBonus * exposure
    : heatExcess > 0 && place.hasAirConditioning
      ? w.airConditioningBonus
      : 0;

  // 基礎分壓縮到 [0, 1 − 加分上限]，把最上面那段留給加分。
  // 不這樣做的話好天氣時室內外都會撞到 1.0，加分等於沒有作用。
  const headroom = 1 - Math.max(w.sunnyOutdoorBonus, w.airConditioningBonus);
  return clamp01(base * headroom + bonus);
}

// ---------------------------------------------------------------------------
// 四：家庭偏好 15% —— 全體共用，且可被整個抑制
// ---------------------------------------------------------------------------

/**
 * 小孩約束決定「哪些不可能」，家庭偏好決定「哪些你們真的會去」（§6.3）。
 *
 * `suppressed` 為真時回傳中性分數——這是 §7.4 的防線一。
 * **偏好只能調整排序，永遠不能覆蓋硬過濾。**
 */
function scoreFamilyPreference(
  place: Place,
  context: RecommendContext,
  suppressed: boolean,
): number {
  const p = SCORING.familyPreference;
  if (suppressed) return p.neutralScore;

  const pref = context.categoryPreferences.find((c) => c.category === place.category);

  // 手動覆寫優先於學習值，且學習不再更新它（§6.3）。
  // 樣本不足時不套用學習權重——那是雜訊，不是偏好。
  const weight =
    pref?.manualWeight ??
    (pref && pref.sampleCount >= p.minSampleCount ? pref.learnedWeight : 0);

  const exposure = SCORING.weather.exposure[place.indoorType];
  // outdoorTendency 是 −2…+2，換算成 −1…+1 後與地點的戶外程度相乘
  const tendency = context.familyPreference.outdoorTendency / 2;
  const outdoorMatch = tendency * (exposure * 2 - 1);

  // 家長負擔已在 Stage 1 擋掉超標的，但接近上限仍略微扣分
  const effortHeadroom =
    context.familyPreference.maxParentEffort - place.parentEffort;
  const effortPenalty =
    effortHeadroom < p.parentEffortSlack ? 0.1 * (p.parentEffortSlack - effortHeadroom) : 0;

  return clamp01(
    p.neutralScore +
      p.categoryInfluence * weight +
      p.outdoorInfluence * outdoorMatch -
      effortPenalty,
  );
}

/**
 * §7.4 防線一：偏好權重在受限情境下歸零。
 *
 * 偏好學習會持續壓低不偏好的類別，使得雨天——正是最需要室內選項的時刻——
 * 系統手上只剩品質最差、從未驗證的牌。**偏好學習的失效點，
 * 恰好落在產品最該發揮價值的情境。**
 */
export function shouldSuppressPreference(
  context: RecommendContext,
  survivorCount: number,
  peak: { rainProbability: number; apparentTempC: number } | null,
): boolean {
  const s = SCORING.preferenceSuppression;
  if (survivorCount < s.survivorsFewerThan) return true;
  if (peak === null) return false;
  return (
    peak.rainProbability >= s.rainProbabilityAtLeast ||
    peak.apparentTempC >= s.apparentTempAtLeast
  );
}

// ---------------------------------------------------------------------------
// 五：新鮮度 10% —— 全體共用
// ---------------------------------------------------------------------------

function scoreFreshness(
  place: Place,
  visits: Visit[],
  now: Date,
  excludeRecentDays: number,
): number {
  const placeVisits = visits.filter((v) => v.placeId === place.id);
  if (placeVisits.length === 0) return 1;

  const daysSince = Math.min(...placeVisits.map((v) => daysBetween(v.date, now)));
  const { recentVisitCeiling, fullRecoveryDays } = SCORING.freshness;

  if (daysSince < excludeRecentDays) {
    return clamp01((daysSince / excludeRecentDays) * recentVisitCeiling);
  }
  const recovery = clamp01((daysSince - excludeRecentDays) / fullRecoveryDays);
  return clamp01(recentVisitCeiling + (1 - recentVisitCeiling) * recovery);
}

// ---------------------------------------------------------------------------
// 六：車程成本 10% —— 全體共用，含壅塞的超線性懲罰
// ---------------------------------------------------------------------------

/**
 * 非線性：短程差異不大，超過門檻後急降。**壅塞另計超線性懲罰**（§7.2）。
 *
 * 塞車的成本不只是時間。在國道塞 40 分鐘與在一般道路開 40 分鐘，
 * 對小孩是完全不同的事——前者伴隨額外的車上崩潰風險。
 */
function scoreDrive(drive: DriveEstimate): number {
  const d = SCORING.drive;
  // 用去回程的平均：兩段都要坐在車上
  const minutes = (drive.outboundMinutes + drive.returnMinutes) / 2;

  const base =
    minutes <= d.freeMinutes
      ? 1 - (minutes / d.freeMinutes) * (1 - d.scoreAtFreeBoundary)
      : d.scoreAtFreeBoundary * Math.exp(-(minutes - d.freeMinutes) / d.decayMinutes);

  // 壅塞比值只在精算時才有意義——粗估的去回程就是基準值本身。
  if (drive.source !== "precise" || drive.baselineMinutes <= 0) return clamp01(base);

  const ratio = minutes / drive.baselineMinutes;
  if (ratio <= d.congestionOnsetRatio) return clamp01(base);

  const excess = ratio - d.congestionOnsetRatio;
  const penalty = d.congestionPenaltyPerUnit * excess ** d.congestionExponent;
  return clamp01(base - penalty);
}

// ---------------------------------------------------------------------------
// 七：歷史成效 5% —— 全體共用
// ---------------------------------------------------------------------------

/**
 * 過往回饋；「崩潰」為負向（§7.2）。
 *
 * **只佔 5%**，而且紀錄筆數少的階段不得調高（§3）。
 */
function scoreHistory(place: Place, visits: Visit[]): number {
  const placeVisits = visits.filter((v) => v.placeId === place.id);
  if (placeVisits.length === 0) return SCORING.history.noVisitsScore;

  const total = placeVisits.reduce(
    (sum, v) => sum + SCORING.history.outcomeScore[v.outcome],
    0,
  );
  return clamp01(total / placeVisits.length);
}

// ---------------------------------------------------------------------------
// 組合
// ---------------------------------------------------------------------------

export function totalScore(breakdown: ScoreBreakdown): number {
  const sum = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).reduce(
    (acc, factor) => acc + WEIGHTS[factor] * breakdown[factor],
    0,
  );
  return sum * 100;
}

export function breakdownForChild(
  place: Place,
  child: Child,
  ageMonths: number,
  visits: Visit[],
  context: RecommendContext,
  timeline: TripTimeline,
  drive: DriveEstimate,
  preferenceSuppressed: boolean,
): ScoreBreakdown {
  const excludeRecentDays =
    context.excludeRecentDays ?? THRESHOLDS.defaultExcludeRecentDays;

  return {
    schedule: scoreSchedule(place, child, timeline, context.timestamp),
    age: scoreAge(place, child, ageMonths),
    weather: scoreWeather(place, timeline, context.weather),
    familyPreference: scoreFamilyPreference(place, context, preferenceSuppressed),
    freshness: scoreFreshness(place, visits, context.timestamp, excludeRecentDays),
    drive: scoreDrive(drive),
    history: scoreHistory(place, visits),
  };
}

export const __testing = {
  scoreSchedule,
  scoreAge,
  scoreWeather,
  scoreFamilyPreference,
  scoreFreshness,
  scoreDrive,
  scoreHistory,
  daysBetween,
};

export type { CategoryPreference };

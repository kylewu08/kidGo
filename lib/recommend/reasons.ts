/**
 * 規則式理由模板（設計架構書 §6.5）
 *
 * **這是 AI 邊界最敏感的一個檔案。**
 *
 * `Recommendation.reasons` 與 `warnings` 永遠由這裡的規則產生。
 * 呈現層的 LLM 可以潤飾句子讓它更自然，**不得改變語意，
 * 也不得新增這裡沒有產生的理由**（AGENTS.md、ADR-0002）。
 *
 * 理由是這樣：一個推薦如果附上一條系統其實沒有考慮過的理由，
 * 那就是憑空捏造的說服力。使用者會依照那條理由做決定——
 * 帶著一歲半的小孩開四十分鐘車出門——而它是假的。
 *
 * 所以每條理由都必須能對回 `scoreBreakdown` 裡的某個數字，
 * 或對回一個明確的事實（午睡窗、預報時段）。這也讓理由可以被測試：
 * 「分數這樣的時候，該說什麼」是一個可以斷言的問題。
 */

import type { Child, Place, Visit } from "@/lib/db/schema";
import { formatClock, overlaps, atClock, forecastPeak } from "./timeline";
import { SCORING } from "./weights";
import type { RecommendContext, ScoreBreakdown, TripTimeline } from "./types";

/**
 * 一個因子要多好才值得拿出來講。
 *
 * 這些門檻與評分無關，只影響「說不說」。訂得太低的話每個地點都會列出六條理由，
 * 而六條理由等於沒有理由——使用者看不出這個地點和下一個的差別在哪。
 */
export const REASON_THRESHOLDS = {
  /** 作息契合度高到值得說「時間剛剛好」 */
  schedule: 0.8,
  /** 年齡落在 sweet spot（滿分）才說，部分吻合不值得提 */
  age: SCORING.age.inSweetSpot,
  /** 天氣好到值得說 */
  weather: 0.75,
  /** 久到值得說「很久沒去了」 */
  freshness: 0.9,
  /** 近到值得說「很近」 */
  drive: 0.85,
  /** 歷史成效好到值得說 */
  history: 0.75,
  /** 一次最多列幾條理由。§10.1 的畫面只放得下這麼多。 */
  maxReasons: 3,
} as const;

/** 出遊後這段時間內的降雨機率若偏高，就提醒。單位小時。 */
const RAIN_LOOKAHEAD_HOURS = 3;
/** 降雨機率超過這個值（%）就值得提醒，但還沒到 Stage 1 剔除的門檻 */
const RAIN_WARNING_PROBABILITY = 40;
/** 體感溫度超過這個值（°C）就提醒補水防曬 */
const HEAT_WARNING_TEMP = 31;

export interface ExplainInput {
  place: Place;
  /** 取自分數最低的那個小孩，與顯示的總分一致 */
  breakdown: ScoreBreakdown;
  /** 分數最低的那個小孩。理由若提到人，指的是他。 */
  weakestChild: Child;
  context: RecommendContext;
  timeline: TripTimeline;
  driveMinutes: number;
  visits: Visit[];
}

export interface Explanation {
  reasons: string[];
  warnings: string[];
}

const MS_PER_DAY = 86_400_000;

function daysSinceLastVisit(place: Place, visits: Visit[], now: Date): number | null {
  const dates = visits
    .filter((v) => v.placeId === place.id)
    .map((v) => {
      const [y, m, d] = v.date.split("-").map(Number);
      return new Date(y, m - 1, d).getTime();
    });
  if (dates.length === 0) return null;
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((midnight - Math.max(...dates)) / MS_PER_DAY);
}

/** 這趟行程是否與這個小孩的午睡窗重疊，以及重疊的是哪一段 */
function napConflict(child: Child, timeline: TripTimeline, now: Date) {
  return child.napWindows.find((w) =>
    overlaps(timeline.departAt, timeline.homeAt, atClock(now, w.start), atClock(now, w.end)),
  );
}

/**
 * 產生理由與警示。
 *
 * 純函式：同樣的輸入永遠得到同樣的句子。這一點不只是為了測試——
 * 使用者今天看到「接得上午睡」明天看到別的說法，會失去對系統的信任。
 */
export function explain({
  place,
  breakdown,
  weakestChild,
  context,
  timeline,
  driveMinutes,
  visits,
}: ExplainInput): Explanation {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const { timestamp: now } = context;

  // --- 理由 ----------------------------------------------------------------
  // 順序即優先序：截斷時留下的是最上面幾條。

  if (breakdown.schedule >= REASON_THRESHOLDS.schedule) {
    // 有午睡的小孩，「接得上午睡」比「時段對」更具體也更有說服力。
    reasons.push(
      weakestChild.napWindows.length > 0
        ? `現在出發，${formatClock(timeline.homeAt)} 前回到家，接得上午睡`
        : `現在出發，${formatClock(timeline.homeAt)} 回到家`,
    );
  }

  if (breakdown.age >= REASON_THRESHOLDS.age) {
    reasons.push(`${weakestChild.name}現在的月齡正好適合`);
  }

  if (breakdown.weather >= REASON_THRESHOLDS.weather) {
    reasons.push(place.indoor === "indoor" ? "室內，不受天氣影響" : "天氣適合出門");
  }

  if (breakdown.freshness >= REASON_THRESHOLDS.freshness) {
    const days = daysSinceLastVisit(place, visits, now);
    reasons.push(days === null ? "還沒去過" : `上次去已經是 ${days} 天前`);
  }

  if (breakdown.drive >= REASON_THRESHOLDS.drive) {
    reasons.push(`車程只要 ${driveMinutes} 分`);
  }

  if (breakdown.history >= REASON_THRESHOLDS.history) {
    reasons.push("前幾次去的結果都不錯");
  }

  // --- 警示 ----------------------------------------------------------------
  // 這些不影響排序，但影響使用者要不要照做。

  // ADR-0004 的待辦：撞到午睡的地點會留在清單裡而不是被剔除，
  // 那就**必須說出來**。使用者看到一個排名偏後的地點卻不知道為什麼，
  // 比直接剔除還糟。
  const conflict = napConflict(weakestChild, timeline, now);
  if (conflict) {
    warnings.push(
      `這趟會撞到${weakestChild.name}的午睡（${conflict.start} 開始），${formatClock(timeline.homeAt)} 才到家`,
    );
  }

  // 出遊結束後一段時間內的降雨。§6.5 的 weather.rainProbAfter(15) 就是這個意思。
  const after = new Date(timeline.homeAt.getTime() + RAIN_LOOKAHEAD_HOURS * 3600_000);
  const later = forecastPeak(context.weather, timeline.leaveAt, after);
  if (later && later.rainProbability >= RAIN_WARNING_PROBABILITY) {
    warnings.push(`${formatClock(timeline.leaveAt)} 之後降雨機率 ${later.rainProbability}%`);
  }

  const during = forecastPeak(context.weather, timeline.departAt, timeline.homeAt);
  if (during && during.apparentTempC >= HEAT_WARNING_TEMP && place.indoor !== "indoor") {
    warnings.push(`體感 ${during.apparentTempC}°C，記得補水`);
  }

  return { reasons: reasons.slice(0, REASON_THRESHOLDS.maxReasons), warnings };
}

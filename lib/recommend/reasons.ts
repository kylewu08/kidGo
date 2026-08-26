/**
 * 規則式理由模板（設計架構書 v1.0 §7.5、§13.2.9）
 *
 * **這是 AI 邊界最敏感的一個檔案。**
 *
 * 理由與警示永遠由這裡的規則產生。呈現層的 LLM 可以潤飾句子，
 * **不得改變語意，也不得新增這裡沒有產生的理由**。
 * §13.2.9 進一步要求推播文案與推薦理由**共用同一組模板**。
 *
 * 理由是這樣：一個推薦如果附上一條系統其實沒有考慮過的理由，
 * 那就是憑空捏造的說服力。使用者會依照那條理由做決定——
 * 帶著一歲半的小孩開四十分鐘車出門——而它是假的。
 *
 * ## 依「候選／已驗證」分流（ADR-0011）
 *
 * 零建檔啟動意味著大部分推薦的地點家長**沒聽過**，而對沒聽過的地名，
 * 推播不可能「自成完整答案」——缺的那塊資訊不在系統裡。
 *
 * 所以兩種地點需要的理由根本不是同一種：
 * - 已驗證 → 「為什麼是**今天**」
 * - 候選　 → 「這是**什麼地方**」
 */

import type { Child, Place, Visit } from "@/lib/db/schema";
import { AGE_BAND_LABELS } from "@/lib/domain/age-bands";
import { CATEGORY_LABELS } from "@/lib/domain/category-priors";
import { atClock, formatClock, forecastPeak, overlaps } from "./timeline";
import type {
  DriveEstimate,
  RecommendContext,
  ScoreBreakdown,
  TripTimeline,
} from "./types";

/**
 * 一個因子要多好才值得拿出來講。訂太低的話每個地點都會列出七條理由，
 * 而七條理由等於沒有理由——看不出這個地點和下一個的差別在哪。
 */
export const REASON_THRESHOLDS = {
  schedule: 0.8,
  age: 0.8,
  weather: 0.75,
  freshness: 0.9,
  drive: 0.85,
  history: 0.75,
  maxReasons: 3,
} as const;

const RAIN_LOOKAHEAD_HOURS = 3;
const RAIN_WARNING_PROBABILITY = 40;
const HEAT_WARNING_TEMP = 31;

export interface ExplainInput {
  place: Place;
  breakdown: ScoreBreakdown;
  /** 分數最低的那個小孩。理由若提到人，指的是他。 */
  weakestChild: Child;
  weakestChildAgeMonths: number;
  context: RecommendContext;
  timeline: TripTimeline;
  drive: DriveEstimate;
  visits: Visit[];
  status: "candidate" | "verified";
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

/**
 * 「這是什麼地方」——給沒去過的地點。
 *
 * 這些資料 §6.2 已經要求要有，那批新欄位本來就是在描述地點的性質。
 * 它們原本只進評分，ADR-0011 讓它們也進理由。
 */
function describePlace(place: Place): string[] {
  const out: string[] = [];

  if (place.facilityAgeBands !== null && place.facilityAgeBands.length > 0) {
    const bands = place.facilityAgeBands.map((b) => AGE_BAND_LABELS[b]).join("、");
    out.push(`${CATEGORY_LABELS[place.category]}，遊具標示適合${bands}`);
  } else if (place.runnableSpace >= 3) {
    out.push(`${CATEGORY_LABELS[place.category]}，沒有遊具但空間大、可以自由跑`);
  } else {
    out.push(CATEGORY_LABELS[place.category]);
  }

  if (place.safetyEnclosure >= 3) out.push("空間封閉，跑不出去");
  if (place.hasAirConditioning && place.indoorType === "indoor") out.push("室內有冷氣");
  if (place.shadeLevel >= 2 && place.indoorType === "outdoor") out.push("樹蔭多");
  if (place.parentEffort <= 2) out.push("大人不太累");
  if (place.strollerFriendly) out.push("推車可進");

  return out;
}

export function explain({
  place,
  breakdown,
  weakestChild,
  context,
  timeline,
  drive,
  visits,
  status,
}: ExplainInput): Explanation {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const now = context.timestamp;

  // --- 理由：順序即優先序，截斷時留下最上面幾條 ---------------------------

  if (status === "candidate") {
    // 沒去過的地點，先回答「這是哪」。
    // §7.5：未造訪過的地點需標示，且不給精確返家時間。
    reasons.push(...describePlace(place));
  } else if (breakdown.schedule >= REASON_THRESHOLDS.schedule) {
    reasons.push(
      weakestChild.napWindows.length > 0
        ? `現在出發，${formatClock(timeline.homeAt)} 前回到家，接得上午睡`
        : `現在出發，${formatClock(timeline.homeAt)} 回到家`,
    );
  }

  if (status === "verified") {
    if (breakdown.age >= REASON_THRESHOLDS.age) {
      reasons.push(`${weakestChild.name}現在的月齡正好適合`);
    }
    if (breakdown.weather >= REASON_THRESHOLDS.weather) {
      reasons.push(
        place.indoorType === "indoor" ? "室內，不受天氣影響" : "天氣適合出門",
      );
    }
    if (breakdown.freshness >= REASON_THRESHOLDS.freshness) {
      const days = daysSinceLastVisit(place, visits, now);
      reasons.push(days === null ? "還沒去過" : `上次去已經是 ${days} 天前`);
    }
    if (breakdown.history >= REASON_THRESHOLDS.history) {
      reasons.push("前幾次去的結果都不錯");
    }
  }

  if (breakdown.drive >= REASON_THRESHOLDS.drive) {
    reasons.push(`車程約 ${drive.outboundMinutes} 分`);
  }

  // --- 警示 ----------------------------------------------------------------

  // 撞到午睡的地點會留在清單裡而不是被剔除，那就**必須說出來**——
  // 看到一個排名偏後的地點卻不知道為什麼，比直接剔除還糟。
  const conflict = weakestChild.napWindows.find((w) =>
    overlaps(timeline.departAt, timeline.homeAt, atClock(now, w.start), atClock(now, w.end)),
  );
  if (conflict) {
    warnings.push(
      `這趟會撞到${weakestChild.name}的午睡（${conflict.start} 開始），${formatClock(timeline.homeAt)} 才到家`,
    );
  }

  const after = new Date(timeline.homeAt.getTime() + RAIN_LOOKAHEAD_HOURS * 3600_000);
  const later = forecastPeak(context.weather, timeline.leaveAt, after);
  if (later && later.rainProbability >= RAIN_WARNING_PROBABILITY) {
    warnings.push(`${formatClock(timeline.leaveAt)} 之後降雨機率 ${later.rainProbability}%`);
  }

  const during = forecastPeak(context.weather, timeline.departAt, timeline.homeAt);
  if (
    during &&
    during.apparentTempC >= HEAT_WARNING_TEMP &&
    place.indoorType !== "indoor"
  ) {
    warnings.push(`體感 ${during.apparentTempC}°C，記得補水`);
  }

  // 沒去過的地點，停留時長只是類別先驗的估計值（§7.5）
  if (status === "candidate") {
    warnings.push("還沒去過，停留時間是估計值");
  }

  return { reasons: reasons.slice(0, REASON_THRESHOLDS.maxReasons), warnings };
}

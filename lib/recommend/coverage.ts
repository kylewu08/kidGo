/**
 * 情境覆蓋率診斷（需求補充 01 §B）
 *
 * 回答一個主觀問題：「資料收集夠了沒？」
 *
 * **核心觀念是覆蓋率有界。** 目標不是收集完整，而是在最惡劣的情境下
 * 仍有足夠選項可推薦。達到停止條件就停，而且只補缺口對應的類別。
 *
 * 這是純函式：對虛擬情境跑 Stage 1，統計存活數與剔除原因分佈。
 * 不讀資料庫、不呼叫網路，所以可以在測試裡跑，也可以在 App 設定頁跑。
 */

import type { Category, Child, DayType, FamilyPreference, Rating } from "@/lib/db/schema";
import type { Place } from "@/lib/db/schema";

import { isWeatherProof } from "./diversity";
import { applyStage1 } from "./filters";
import type { RecommendContext, RejectionReason, WeatherSlot } from "./types";

/**
 * 停止條件（需求補充 01 §B.2 的修正版）。
 *
 * 原始需求寫的是「存活數 ≥ 3」，但 2026-08-29 的實跑證明那量錯了東西：
 * 1405 個地點在酷暑情境下存活 632 個，遠超過 3，**卻只填得滿兩個槽位**——
 * 因為 §7.3 規定「前三名不得為同一類別」，而存活的 632 個只涵蓋兩個類別。
 *
 * 所以要量的是**填不填得滿三個槽位**：
 *
 * - 三個槽位需要三個不同類別（§7.3）
 * - 備案槽位需要至少一個室內或有頂戶外（§7.3「至少一個室內選項，供天氣突變」）
 *
 * 這些數字不放進 `thresholds.ts`：那個檔案是 Stage 1 的過濾門檻，
 * 這裡是診斷指標，兩者調整的理由完全不同，混在一起會讓人誤以為
 * 改這個數字會影響推薦結果。
 */
export const COVERAGE_TARGET = {
  /** §7.3 輸出固定三項 */
  minSurvivors: 3,
  /** 前三名不得為同一類別 */
  minCategories: 3,
  /** 備案要求至少一個室內選項 */
  minWeatherProof: 1,
} as const;

export interface CoverageScenario {
  key: string;
  label: string;
  /** 0–100 */
  rainProbability: number;
  apparentTempC: number;
  condition: string;
  dayType: DayType;
  /** "HH:MM" */
  startTime: string;
  endTime: string;
  /** 覆寫家庭偏好的家長負擔上限 */
  maxParentEffort?: Rating;
}

/**
 * 診斷情境（需求補充 01 §B.3）。
 *
 * ⚠️ 溫度與降雨的數值該對齊**當地實際極值**，不是固定值。
 * 原始需求的酷暑訂 35°C，但 2026-08-29 板橋實測體感 38°C——
 * 情境訂得比實際溫和，最惡劣情境就沒有測到最惡劣的情況。
 */
export const COVERAGE_SCENARIOS: readonly CoverageScenario[] = [
  {
    key: "sunny_morning",
    label: "晴天上午",
    rainProbability: 10,
    apparentTempC: 26,
    condition: "晴",
    dayType: "weekend",
    startTime: "09:00",
    endTime: "18:00",
  },
  {
    key: "afternoon_storm",
    label: "午後雷雨",
    rainProbability: 70,
    apparentTempC: 30,
    condition: "雷陣雨",
    dayType: "weekend",
    startTime: "14:00",
    endTime: "18:00",
  },
  {
    key: "extreme_heat",
    label: "酷暑",
    rainProbability: 20,
    apparentTempC: 38,
    condition: "晴",
    dayType: "weekend",
    startTime: "09:00",
    endTime: "18:00",
  },
  {
    key: "long_holiday",
    label: "連假",
    rainProbability: 20,
    apparentTempC: 28,
    condition: "多雲",
    dayType: "long_weekend",
    startTime: "09:00",
    endTime: "18:00",
  },
  {
    key: "tired_parent",
    label: "家長疲勞",
    rainProbability: 20,
    apparentTempC: 28,
    condition: "多雲",
    dayType: "weekend",
    startTime: "09:00",
    endTime: "18:00",
    maxParentEffort: 2,
  },
] as const;

/**
 * 剔除原因 → 缺乏的屬性組合與建議補充的類別。
 *
 * §B.4：**缺口描述必須指出缺乏的屬性組合，而非只說「數量不足」。**
 * 只講數量的話，使用者知道不夠卻不知道該補什麼。
 *
 * 這是領域判斷，所以集中在這張表裡並有測試，不散在呈現層。
 */
const GAP_BY_REJECTION: Record<
  RejectionReason,
  { missing: string; suggest: Category[] }
> = {
  heat: {
    missing: "有冷氣、或遮蔭充足的選項",
    suggest: ["museum", "library", "indoor_playground", "mall_play_area", "parenting_center"],
  },
  rain: {
    missing: "室內或有頂的選項",
    suggest: ["museum", "library", "indoor_playground", "mall_play_area", "parenting_center"],
  },
  facility_age_mismatch: {
    missing: "有適合這個年齡的遊具、或可奔跑空間足以替代的選項",
    suggest: ["inclusive_playground", "park", "museum"],
  },
  unsafe_for_toddler: {
    missing: "安全封閉性高、跑不出去的選項",
    suggest: ["parenting_center", "indoor_playground", "library", "mall_play_area"],
  },
  parent_effort_too_high: {
    missing: "家長負擔低的選項",
    suggest: ["library", "parenting_center", "museum", "kids_restaurant"],
  },
  not_enough_time: {
    missing: "車程近、或停留時間短的選項",
    suggest: ["park", "library", "parenting_center"],
  },
  drive_too_long: {
    // 這一項不是類別問題，是範圍問題——補再多同類別的地點也沒用。
    missing: "車程範圍內的選項（這是範圍問題，不是類別問題）",
    suggest: [],
  },
  age_out_of_range: {
    missing: "適合這個月齡的選項",
    suggest: ["parenting_center", "library", "park"],
  },
  stroller_unfriendly: {
    missing: "推車進得去的選項",
    suggest: ["library", "parenting_center", "museum", "mall_play_area"],
  },
};

export interface CoverageResult {
  scenario: CoverageScenario;
  survivors: number;
  categories: Category[];
  weatherProofSurvivors: number;
  meetsTarget: boolean;
  /**
   * 被整批消滅的類別（資料庫裡有、但這個情境下一個都沒存活）。
   * 缺口分析看的是這個，不是整體剔除數——見 `gapOf` 的說明。
   */
  wipedOutCategories: Category[];
  /** 造成缺口的剔除因子。達標時為 null。 */
  dominantRejection: { reason: RejectionReason; count: number } | null;
  rejectionBreakdown: Partial<Record<RejectionReason, number>>;
  /** 缺口描述。達標時為 null。 */
  gap: { missing: string; suggest: Category[] } | null;
}

/** 診斷需要的、與情境無關的部分。 */
export interface CoverageBaseline {
  children: Child[];
  home: { lat: number; lng: number };
  maxDriveMinutes: number;
  familyPreference: FamilyPreference;
  /** 診斷的基準日。用固定日期才能重現。 */
  date: Date;
}

function atTime(date: Date, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  const at = new Date(date);
  at.setHours(hours, minutes, 0, 0);
  return at;
}

/** 整天的逐三小時預報，全部套用情境的天氣值。 */
function syntheticForecast(date: Date, scenario: CoverageScenario): WeatherSlot[] {
  const slots: WeatherSlot[] = [];
  for (let hour = 0; hour < 24; hour += 3) {
    slots.push({
      startsAt: atTime(date, `${String(hour).padStart(2, "0")}:00`),
      rainProbability: scenario.rainProbability,
      apparentTempC: scenario.apparentTempC,
      condition: scenario.condition,
    });
  }
  return slots;
}

export function contextForScenario(
  baseline: CoverageBaseline,
  scenario: CoverageScenario,
): RecommendContext {
  return {
    timestamp: atTime(baseline.date, scenario.startTime),
    children: baseline.children,
    home: baseline.home,
    weather: { slots: syntheticForecast(baseline.date, scenario) },
    dayType: scenario.dayType,
    maxDriveMinutes: baseline.maxDriveMinutes,
    availableWindow: { start: scenario.startTime, end: scenario.endTime },
    familyPreference:
      scenario.maxParentEffort === undefined
        ? baseline.familyPreference
        : { ...baseline.familyPreference, maxParentEffort: scenario.maxParentEffort },
    categoryPreferences: [],
  };
}

/**
 * 缺口分析。
 *
 * **不看整體剔除數，看哪個類別被整批消滅了。**
 *
 * 理由是 2026-08-29 的實跑：整體最大宗的剔除因子永遠是 `drive_too_long`
 * （全國 616 個圖書館大多超出車程上限），而它在每個情境都一樣多——
 * 它不是情境特有的問題，拿它當缺口描述只會得到一句永遠正確也永遠沒用的話。
 *
 * 情境特有的訊號是「這個情境害死了哪一個類別」：酷暑害死共融遊戲場（heat）、
 * 雷雨害死所有戶外（rain）、家長疲勞害死高負擔類別（parent_effort_too_high）。
 *
 * 所以規則只有兩條：
 *
 * 1. 候選是被整批消滅的類別，各自帶著害死它的主要原因
 * 2. **情境特有的原因優先於範圍問題**。全部都死於車程過遠時才報車程——
 *    那代表這真的是範圍問題，補類別沒有用
 */
function gapOf(
  meetsTarget: boolean,
  wipedOut: readonly { category: Category; reason: RejectionReason; count: number }[],
  breakdown: Partial<Record<RejectionReason, number>>,
): { reason: RejectionReason; count: number } | null {
  if (meetsTarget) return null;

  const candidates =
    wipedOut.length > 0
      ? wipedOut.map((w) => ({ reason: w.reason, count: w.count }))
      : Object.entries(breakdown).map(([reason, count]) => ({
          reason: reason as RejectionReason,
          count,
        }));
  if (candidates.length === 0) return null;

  const scenarioSpecific = candidates.filter((c) => c.reason !== "drive_too_long");
  const pool = scenarioSpecific.length > 0 ? scenarioSpecific : candidates;

  return [...pool].sort((a, b) => b.count - a.count)[0];
}

export function diagnoseScenario(
  places: readonly Place[],
  baseline: CoverageBaseline,
  scenario: CoverageScenario,
): CoverageResult {
  const results = applyStage1([...places], contextForScenario(baseline, scenario));
  const survivors = results.filter((r) => r.passed);

  const categories = [...new Set(survivors.map((r) => r.place.category))];
  const weatherProofSurvivors = survivors.filter((r) =>
    isWeatherProof({ place: r.place } as Parameters<typeof isWeatherProof>[0]),
  ).length;

  const breakdown: Partial<Record<RejectionReason, number>> = {};
  for (const r of results) {
    if (r.passed || r.rejectedBy === undefined) continue;
    breakdown[r.rejectedBy] = (breakdown[r.rejectedBy] ?? 0) + 1;
  }

  // 資料庫裡有、但這個情境一個都沒存活的類別，以及害死它的主要原因。
  const corpusCategories = [...new Set(places.map((p) => p.category))];
  const wipedOut = corpusCategories
    .filter((c) => !categories.includes(c))
    .map((category) => {
      const reasons: Partial<Record<RejectionReason, number>> = {};
      for (const r of results) {
        if (r.place.category !== category || r.rejectedBy === undefined) continue;
        reasons[r.rejectedBy] = (reasons[r.rejectedBy] ?? 0) + 1;
      }
      const top = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0];
      return top
        ? { category, reason: top[0] as RejectionReason, count: top[1] }
        : null;
    })
    .filter((w): w is { category: Category; reason: RejectionReason; count: number } => w !== null);

  const meetsTarget =
    survivors.length >= COVERAGE_TARGET.minSurvivors &&
    categories.length >= COVERAGE_TARGET.minCategories &&
    weatherProofSurvivors >= COVERAGE_TARGET.minWeatherProof;

  const dominantRejection = gapOf(meetsTarget, wipedOut, breakdown);

  return {
    scenario,
    survivors: survivors.length,
    categories,
    weatherProofSurvivors,
    meetsTarget,
    wipedOutCategories: wipedOut.map((w) => w.category),
    dominantRejection,
    rejectionBreakdown: breakdown,
    gap: dominantRejection ? GAP_BY_REJECTION[dominantRejection.reason] : null,
  };
}

/**
 * 診斷只計算**匯入來的**地點，手動新增的排除在外（ADR-0024）。
 *
 * 手動地點會出現在推薦裡——它們是真的地方。但如果它們也算進覆蓋率，
 * 使用者自己補幾個洞就能讓診斷變綠，而**真正的覆蓋率沒有任何改善**。
 * 診斷存在的目的是逼資料來源擴充；讓它被手動輸入安撫，等於拆掉那個壓力。
 *
 * 這是 ADR-0024 開放手動新增時配套的解藥，不是可有可無的細節。
 */
export function importedOnly(places: readonly Place[]): readonly Place[] {
  return places.filter((p) => p.sourceDataset !== "manual");
}

export function diagnoseCoverage(
  places: readonly Place[],
  baseline: CoverageBaseline,
  scenarios: readonly CoverageScenario[] = COVERAGE_SCENARIOS,
): CoverageResult[] {
  const imported = importedOnly(places);
  return scenarios.map((scenario) => diagnoseScenario(imported, baseline, scenario));
}

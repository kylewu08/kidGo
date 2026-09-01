/**
 * 測試用的資料建構器。
 *
 * 每個 make* 回傳一筆「一切正常」的資料，測試只覆寫它關心的那幾個欄位。
 * 這樣測試讀起來就是「在**只有這一點不同**的情況下會怎樣」，
 * 而不是三十行 setup 淹沒掉一行斷言。
 */

import type {
  CategoryPreference,
  Child,
  FamilyPreference,
  Place,
  Visit,
} from "@/lib/db/schema";
import { CATEGORY_PRIORS } from "@/lib/domain/category-priors";
import type { RecommendContext, WeatherForecast } from "../types";

/** 2026-08-29（週六）09:00。所有測試的「現在」。 */
export const SATURDAY_9AM = new Date(2026, 7, 29, 9, 0, 0, 0);

/** 板橋。與 lib/weather 的鄉鎮座標一致。 */
export const HOME = { lat: 25.01154, lng: 121.450888 };

/**
 * 距離住家約 3 公里的座標——幾何估計約 12 分鐘車程，
 * 讓大多數測試不必操心車程過濾。
 */
const NEARBY = { lat: 25.03, lng: 121.47 };

export function makePlace(overrides: Partial<Place> = {}): Place {
  const prior = CATEGORY_PRIORS.inclusive_playground;
  return {
    id: "place-1",
    sourceDataset: "playground_registry",
    sourceId: "X-1",
    importedAt: null,
    sourceUpdatedAt: null,
    sourceRemovedAt: null,
    name: "測試遊戲場",
    category: "inclusive_playground",
    address: "",
    lat: NEARBY.lat,
    lng: NEARBY.lng,
    parkingSearchMinutes: 5,
    usesFreeway: false,
    energyBurn: prior.energyBurn,
    typicalDurationMinutes: 90,
    bestTimeSlots: ["morning"],
    facilityAgeBands: ["toddler", "preschool"],
    suitableAgeMonths: { minMonths: 6, maxMonths: 144 },
    runnableSpace: 3,
    safetyEnclosure: 2,
    parentEffort: 3,
    indoorType: "outdoor",
    hasAirConditioning: false,
    shadeLevel: 2,
    strollerFriendly: true,
    fieldSources: {},
    dataSuspect: false,
    dataSuspectReason: null,
    lastVerifiedAt: null,
    notes: null,
    ...overrides,
  };
}

/** 預設是 20 個月大、睡一次午覺、坐推車的小孩 */
export function makeChild(overrides: Partial<Child> = {}): Child {
  return {
    id: "child-1",
    name: "小寶",
    birthDate: "2024-12-29", // 2026-08-29 時為 20 個月
    napStage: "one_nap",
    wakeTime: "07:00",
    napWindows: [{ start: "12:30", end: "14:30" }],
    bedTime: "20:30",
    mobility: "stroller",
    // 預設不設限——選填欄位不該改變既有測試的行為（ADR-0025）
    attentionSpanMinutes: null,
    notes: null,
    ...overrides,
  };
}

export function makeVisit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: "visit-1",
    placeId: "place-1",
    suggestionId: null,
    date: "2026-06-01",
    childIds: ["child-1"],
    childAgesMonths: [18],
    durationFeeling: "as_expected",
    outcome: "smooth",
    arrivedAt: null,
    leftAt: null,
    actualDriveMinutes: null,
    weatherSnapshot: null,
    contextOverrideId: null,
    notes: null,
    ...overrides,
  };
}

export function makeFamilyPreference(
  overrides: Partial<FamilyPreference> = {},
): FamilyPreference {
  return {
    id: "default",
    outdoorTendency: 0,
    maxParentEffort: 4,
    requiresMeal: false,
    ...overrides,
  };
}

export function makeCategoryPreference(
  overrides: Partial<CategoryPreference> & Pick<CategoryPreference, "category">,
): CategoryPreference {
  return {
    learnedWeight: 0,
    manualWeight: null,
    sampleCount: 0,
    lastUpdatedAt: null,
    ...overrides,
  };
}

/** 整天的逐三小時預報。預設舒適：26°C、降雨 10%。 */
export function makeForecast({
  day = SATURDAY_9AM,
  rainProbability = 10,
  apparentTempC = 26,
  condition = "多雲",
}: {
  day?: Date;
  rainProbability?: number;
  apparentTempC?: number;
  condition?: string;
} = {}): WeatherForecast {
  return {
    slots: [0, 3, 6, 9, 12, 15, 18, 21].map((hour) => ({
      startsAt: new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour),
      rainProbability,
      apparentTempC,
      condition,
    })),
  };
}

export function makeContext(
  overrides: Partial<RecommendContext> = {},
): RecommendContext {
  return {
    timestamp: SATURDAY_9AM,
    children: [makeChild()],
    home: HOME,
    weather: makeForecast(),
    dayType: "weekend",
    maxDriveMinutes: 45,
    availableWindow: { start: "09:00", end: "18:00" },
    familyPreference: makeFamilyPreference(),
    categoryPreferences: [],
    ...overrides,
  };
}

/**
 * 測試用的資料建構器。
 *
 * 每個 make* 都回傳一筆「一切正常」的資料，測試只覆寫它關心的那幾個欄位。
 * 這樣測試讀起來就是「在這個地點/小孩/天氣**只有這一點不同**的情況下，會怎樣」，
 * 而不是三十行 setup 淹沒掉一行斷言。
 */

import type { Child, Place, Visit } from "@/lib/db/schema";
import type { RecommendContext, WeatherForecast } from "../types";

/** 2026-08-22（週六）09:00。所有測試的「現在」。 */
export const SATURDAY_9AM = new Date(2026, 7, 22, 9, 0, 0, 0);

export function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "park",
    ownerId: "local",
    name: "測試公園",
    category: "park",
    lat: 25.03,
    lng: 121.54,
    address: "測試地址",
    driveMinutes: 15,
    parking: "moderate",
    energyBurn: 4,
    typicalDurationMin: 120,
    bestTimeSlots: ["morning"],
    ageRange: { minMonths: 6, maxMonths: 96 },
    sweetSpotAge: { minMonths: 18, maxMonths: 48 },
    indoor: "outdoor",
    shadeLevel: 2,
    strollerFriendly: true,
    hasChangingTable: true,
    hasNursingSpace: true,
    hasFoodOnSite: true,
    hasWaterPlay: false,
    needsReservation: false,
    quietHours: null,
    crowdLevel: { weekday: 2, weekend: 4 },
    costPerFamily: null,
    indoorBackupPlaceIds: [],
    personalRating: null,
    notes: null,
    tags: [],
    fieldSources: {},
    lastVerifiedAt: null,
    ...overrides,
  };
}

/**
 * 預設是一個 22 個月大、睡一次午覺、坐推車的小孩。
 * 生日往回推：2026-08-22 減 22 個月 = 2024-10-22。
 */
export function makeChild(overrides: Partial<Child> = {}): Child {
  return {
    id: "child-1",
    name: "測試小孩",
    birthDate: "2024-10-22",
    napStage: "one_nap",
    wakeTime: "07:00",
    napWindows: [{ start: "12:30", end: "14:30" }],
    bedTime: "20:30",
    mobility: "stroller",
    notes: null,
    ...overrides,
  };
}

export function makeVisit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: "visit-1",
    placeId: "park",
    childIds: ["child-1"],
    date: "2026-06-01",
    arrivedAt: "09:30",
    leftAt: "11:00",
    childAgesMonths: [19],
    weatherSnapshot: { condition: "晴", tempC: 26, rainProbability: 10 },
    outcome: 4,
    actualEnergyBurn: 4,
    napHappened: true,
    meltdown: false,
    wouldReturn: true,
    notes: null,
    photos: [],
    ...overrides,
  };
}

/**
 * 產生整天的逐三小時預報。
 * 預設是舒適的天氣：26°C、降雨 10%——這樣天氣就不會意外影響其他測試。
 */
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
    weather: makeForecast(),
    maxDriveMinutes: 45,
    availableWindow: { start: "09:00", end: "12:00" },
    ...overrides,
  };
}

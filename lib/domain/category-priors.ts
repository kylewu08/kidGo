/**
 * 類別先驗值（設計架構書 v1.0 §11.1）
 *
 * 匯入時依類別套用，全部標記為 `category_prior` 來源。
 *
 * **先驗值不是實測值。** 它的作用是讓排序在零紀錄時就能運作——
 * 公園比圖書館放電高，這個**相對關係**足以支撐評分。
 * 精確值由造訪紀錄逐步覆蓋（§11.1）。
 *
 * ⚠️ 領域判斷，不得自行推導或更改（§11）。表格內容逐格對應規格。
 */

import type {
  AgeBand,
  Category,
  IndoorType,
  Level0to3,
  Rating,
} from "@/lib/db/schema";

export interface CategoryPrior {
  energyBurn: Rating;
  typicalDurationMinutes: number;
  indoorType: IndoorType;
  strollerFriendly: boolean;
  runnableSpace: Level0to3;
  parentEffort: Rating;
  hasAirConditioning: boolean;
  safetyEnclosure: Level0to3;
  /** null 代表無遊具設施 */
  facilityAgeBands: AgeBand[] | null;
  /** §6.2 語彙表未定義，由此補上（ADR-0014） */
  suitableAgeMonths: { minMonths: number; maxMonths: number };
  shadeLevel: Level0to3;
  parkingSearchMinutes: number;
}

export const CATEGORY_PRIORS: Record<Category, CategoryPrior> = {
  inclusive_playground: {
    energyBurn: 4, typicalDurationMinutes: 90, indoorType: "outdoor",
    strollerFriendly: true, runnableSpace: 3, parentEffort: 3,
    hasAirConditioning: false, safetyEnclosure: 2,
    // §11.1：依清冊，缺值取學步兒＋學齡前
    facilityAgeBands: ["toddler", "preschool"],
    suitableAgeMonths: { minMonths: 12, maxMonths: 144 },
    shadeLevel: 1, parkingSearchMinutes: 8,
  },
  park: {
    energyBurn: 3, typicalDurationMinutes: 60, indoorType: "outdoor",
    strollerFriendly: true, runnableSpace: 3, parentEffort: 2,
    hasAirConditioning: false, safetyEnclosure: 2,
    facilityAgeBands: ["preschool", "school_age"],
    suitableAgeMonths: { minMonths: 6, maxMonths: 144 },
    shadeLevel: 2, parkingSearchMinutes: 8,
  },
  parenting_center: {
    energyBurn: 3, typicalDurationMinutes: 90, indoorType: "indoor",
    strollerFriendly: true, runnableSpace: 2, parentEffort: 1,
    hasAirConditioning: true, safetyEnclosure: 3,
    facilityAgeBands: ["infant", "toddler"],
    suitableAgeMonths: { minMonths: 0, maxMonths: 72 },
    shadeLevel: 3, parkingSearchMinutes: 10,
  },
  indoor_playground: {
    energyBurn: 4, typicalDurationMinutes: 120, indoorType: "indoor",
    strollerFriendly: true, runnableSpace: 2, parentEffort: 2,
    hasAirConditioning: true, safetyEnclosure: 3,
    facilityAgeBands: ["toddler", "preschool"],
    suitableAgeMonths: { minMonths: 6, maxMonths: 144 },
    shadeLevel: 3, parkingSearchMinutes: 10,
  },
  /**
   * §6.2 用美術館當例子說明為什麼需要「可奔跑空間」與「家長負擔」：
   * 雖無遊具、放電強度低，但對 20 個月幼兒是好選擇——
   * 可跑（3）、家長不累（1）、有冷氣、跑不掉（3）。
   */
  museum: {
    energyBurn: 2, typicalDurationMinutes: 120, indoorType: "indoor",
    strollerFriendly: true, runnableSpace: 3, parentEffort: 1,
    hasAirConditioning: true, safetyEnclosure: 3,
    facilityAgeBands: null,
    suitableAgeMonths: { minMonths: 12, maxMonths: 144 },
    shadeLevel: 3, parkingSearchMinutes: 12,
  },
  library: {
    energyBurn: 1, typicalDurationMinutes: 60, indoorType: "indoor",
    strollerFriendly: true, runnableSpace: 1, parentEffort: 1,
    hasAirConditioning: true, safetyEnclosure: 3,
    facilityAgeBands: null,
    suitableAgeMonths: { minMonths: 0, maxMonths: 144 },
    shadeLevel: 3, parkingSearchMinutes: 8,
  },
  farm: {
    energyBurn: 4, typicalDurationMinutes: 180, indoorType: "mixed",
    strollerFriendly: false, runnableSpace: 3, parentEffort: 4,
    hasAirConditioning: false, safetyEnclosure: 2,
    facilityAgeBands: null,
    suitableAgeMonths: { minMonths: 12, maxMonths: 144 },
    shadeLevel: 1, parkingSearchMinutes: 5,
  },
  trail: {
    energyBurn: 5, typicalDurationMinutes: 120, indoorType: "outdoor",
    strollerFriendly: false, runnableSpace: 2, parentEffort: 5,
    hasAirConditioning: false, safetyEnclosure: 1,
    facilityAgeBands: null,
    suitableAgeMonths: { minMonths: 24, maxMonths: 144 },
    shadeLevel: 2, parkingSearchMinutes: 8,
  },
  /**
   * §6.2 的對照組：與美術館同樣「無設施、可跑空間 3」，
   * 但家長負擔 5、安全封閉性 1（開放水域）——完全不同的選擇。
   */
  beach: {
    energyBurn: 4, typicalDurationMinutes: 120, indoorType: "outdoor",
    strollerFriendly: false, runnableSpace: 3, parentEffort: 5,
    hasAirConditioning: false, safetyEnclosure: 1,
    facilityAgeBands: null,
    suitableAgeMonths: { minMonths: 12, maxMonths: 144 },
    shadeLevel: 0, parkingSearchMinutes: 10,
  },
  kids_restaurant: {
    energyBurn: 2, typicalDurationMinutes: 90, indoorType: "indoor",
    strollerFriendly: true, runnableSpace: 1, parentEffort: 1,
    hasAirConditioning: true, safetyEnclosure: 3,
    facilityAgeBands: ["toddler", "preschool"],
    suitableAgeMonths: { minMonths: 6, maxMonths: 144 },
    shadeLevel: 3, parkingSearchMinutes: 10,
  },
  mall_play_area: {
    energyBurn: 3, typicalDurationMinutes: 90, indoorType: "indoor",
    strollerFriendly: true, runnableSpace: 2, parentEffort: 2,
    hasAirConditioning: true, safetyEnclosure: 3,
    facilityAgeBands: ["toddler", "preschool"],
    suitableAgeMonths: { minMonths: 6, maxMonths: 144 },
    shadeLevel: 3, parkingSearchMinutes: 12,
  },
};

export const CATEGORY_LABELS: Record<Category, string> = {
  inclusive_playground: "共融／特色遊戲場",
  park: "一般公園",
  parenting_center: "親子館",
  indoor_playground: "室內遊樂場",
  museum: "博物館／美術館",
  library: "圖書館",
  farm: "農場／牧場",
  trail: "步道",
  beach: "海邊／沙灘",
  kids_restaurant: "親子餐廳",
  mall_play_area: "百貨遊戲區",
};

export const ALL_CATEGORIES = Object.keys(CATEGORY_PRIORS) as Category[];

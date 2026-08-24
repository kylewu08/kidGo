/**
 * 地點輸入的驗證（純函式）
 *
 * 與 home-base-input.ts 同樣的理由：Server Action 會寫資料庫，
 * 驗證本身不需要，抽出來就測得到。
 *
 * `Place` 的欄位定義是本產品的核心差異化（設計架構書 §5.2），
 * 這裡的每一條規則都對應那一節的一個欄位語意，不是通用的表單檢查。
 */

import type {
  AgeRangeMonths,
  Category,
  CrowdLevel,
  FieldSource,
  IndoorType,
  NewPlace,
  ParkingRating,
  Rating,
  ShadeLevel,
  TimeSlot,
} from "./schema";

export const CATEGORIES: Category[] = [
  "park", "playground", "indoor_playground", "museum", "farm",
  "beach", "trail", "kids_cafe", "mall", "library", "other",
];

export const INDOOR_TYPES: IndoorType[] = [
  "indoor", "outdoor", "mixed", "covered_outdoor",
];

export const PARKING_RATINGS: ParkingRating[] = ["easy", "moderate", "hard", "none"];

export const TIME_SLOTS: TimeSlot[] = [
  "early_morning", "morning", "post_nap", "late_afternoon",
];

/** 中文標籤集中在這裡，免得散落在各個 JSX 裡對不起來 */
export const LABELS = {
  category: {
    park: "公園", playground: "遊戲場", indoor_playground: "室內遊樂場",
    museum: "博物館", farm: "農場", beach: "海邊", trail: "步道",
    kids_cafe: "親子餐廳", mall: "百貨", library: "圖書館", other: "其他",
  } satisfies Record<Category, string>,
  indoor: {
    indoor: "室內", outdoor: "戶外", mixed: "室內外皆有", covered_outdoor: "有頂戶外",
  } satisfies Record<IndoorType, string>,
  parking: {
    easy: "好停", moderate: "普通", hard: "難停", none: "沒有停車場",
  } satisfies Record<ParkingRating, string>,
  timeSlot: {
    early_morning: "清晨", morning: "上午", post_nap: "午睡後", late_afternoon: "傍晚",
  } satisfies Record<TimeSlot, string>,
} as const;

/** 表單送來的原始字串。用最小介面，測試不必建構真的 FormData。 */
export interface RawPlaceInput {
  name: string;
  category: string;
  address: string;
  lat: string;
  lng: string;
  driveMinutes: string;
  parking: string;
  energyBurn: string;
  typicalDurationMin: string;
  bestTimeSlots: string[];
  ageMinMonths: string;
  ageMaxMonths: string;
  sweetSpotMinMonths: string;
  sweetSpotMaxMonths: string;
  indoor: string;
  shadeLevel: string;
  strollerFriendly: boolean;
  hasChangingTable: boolean;
  hasNursingSpace: boolean;
  hasFoodOnSite: boolean;
  hasWaterPlay: boolean;
  needsReservation: boolean;
  crowdWeekday: string;
  crowdWeekend: string;
  quietHours: string;
  costPerFamily: string;
  personalRating: string;
  notes: string;
  tags: string;
}

/**
 * 驗證通過的地點資料。
 *
 * fieldSources 標成必填而不是沿用 NewPlace 的選填：這個函式一定會設它，
 * 而呼叫端（含測試）該看得出這件事。設計架構書 §5.2 說 UI 必須能區分
 * 「AI 猜的」與「我確認過的」，一個可能是 undefined 的來源欄位撐不起那個需求。
 */
export type ValidatedPlace = Omit<NewPlace, "id" | "fieldSources"> & {
  fieldSources: Record<string, FieldSource>;
};

export type PlaceValidation =
  | { ok: true; value: ValidatedPlace }
  | { ok: false; message: string };

const TAIWAN_BOUNDS = { minLat: 21, maxLat: 26.5, minLng: 118, maxLng: 122.5 };

/** 小孩滿 12 歲之後就不是這個產品的服務對象了（P3 窄而深） */
const MAX_AGE_MONTHS = 144;

function intInRange(raw: string, min: number, max: number): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

/** 空字串代表「沒填」，回傳 null；填了但不是合法整數則回傳 undefined 表示錯誤。 */
function optionalInt(
  raw: string,
  min: number,
  max: number,
): number | null | undefined {
  if (raw.trim() === "") return null;
  const value = intInRange(raw, min, max);
  return value === null ? undefined : value;
}

export function validatePlaceInput(raw: RawPlaceInput): PlaceValidation {
  const name = raw.name.trim();
  if (name === "") return { ok: false, message: "地點名稱不能空白" };

  if (!CATEGORIES.includes(raw.category as Category)) {
    return { ok: false, message: `不認得的分類「${raw.category}」` };
  }
  if (!INDOOR_TYPES.includes(raw.indoor as IndoorType)) {
    return { ok: false, message: `不認得的室內外類型「${raw.indoor}」` };
  }
  if (!PARKING_RATINGS.includes(raw.parking as ParkingRating)) {
    return { ok: false, message: `不認得的停車狀況「${raw.parking}」` };
  }

  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, message: "座標必須是數字" };
  }
  if (
    lat < TAIWAN_BOUNDS.minLat || lat > TAIWAN_BOUNDS.maxLat ||
    lng < TAIWAN_BOUNDS.minLng || lng > TAIWAN_BOUNDS.maxLng
  ) {
    return { ok: false, message: "座標不在臺灣範圍內，緯度與經度可能填反了" };
  }

  // driveMinutes 是基準值兼離線後備（ADR-0005），仍然必填——
  // 沒有它的話 API 失敗時這個地點就完全沒有車程可用。
  const driveMinutes = intInRange(raw.driveMinutes, 0, 600);
  if (driveMinutes === null) {
    return { ok: false, message: "車程必須是 0 到 600 之間的整數（分鐘）" };
  }

  const energyBurn = intInRange(raw.energyBurn, 1, 5);
  if (energyBurn === null) {
    return { ok: false, message: "放電強度必須是 1 到 5" };
  }

  const typicalDurationMin = intInRange(raw.typicalDurationMin, 1, 1440);
  if (typicalDurationMin === null) {
    return { ok: false, message: "可撐時間必須是 1 到 1440 之間的整數（分鐘）" };
  }

  const shadeLevel = intInRange(raw.shadeLevel, 0, 3);
  if (shadeLevel === null) {
    return { ok: false, message: "遮蔽程度必須是 0 到 3" };
  }

  const badSlot = raw.bestTimeSlots.find((s) => !TIME_SLOTS.includes(s as TimeSlot));
  if (badSlot !== undefined) {
    return { ok: false, message: `不認得的時段「${badSlot}」` };
  }

  const ageMin = intInRange(raw.ageMinMonths, 0, MAX_AGE_MONTHS);
  const ageMax = intInRange(raw.ageMaxMonths, 0, MAX_AGE_MONTHS);
  if (ageMin === null || ageMax === null) {
    return { ok: false, message: `適合年齡必須是 0 到 ${MAX_AGE_MONTHS} 之間的月齡` };
  }
  if (ageMin > ageMax) {
    return { ok: false, message: "適合年齡的下限不能大於上限" };
  }

  // sweetSpotAge 可以整個留空——AI 不得填寫此欄位（§7.2），
  // 空著代表「還沒判斷過」，評分時會給中性分數而不是零分。
  const sweetMin = optionalInt(raw.sweetSpotMinMonths, 0, MAX_AGE_MONTHS);
  const sweetMax = optionalInt(raw.sweetSpotMaxMonths, 0, MAX_AGE_MONTHS);
  if (sweetMin === undefined || sweetMax === undefined) {
    return { ok: false, message: `最適年齡必須是 0 到 ${MAX_AGE_MONTHS} 之間的月齡，或整個留空` };
  }
  if ((sweetMin === null) !== (sweetMax === null)) {
    return { ok: false, message: "最適年齡要嘛兩個都填，要嘛兩個都留空" };
  }
  let sweetSpotAge: AgeRangeMonths | null = null;
  if (sweetMin !== null && sweetMax !== null) {
    if (sweetMin > sweetMax) {
      return { ok: false, message: "最適年齡的下限不能大於上限" };
    }
    // sweet spot 必須落在 ageRange 內，否則評分的線性內插會算出負的距離。
    if (sweetMin < ageMin || sweetMax > ageMax) {
      return { ok: false, message: "最適年齡必須落在適合年齡的範圍內" };
    }
    sweetSpotAge = { minMonths: sweetMin, maxMonths: sweetMax };
  }

  const crowdWeekday = intInRange(raw.crowdWeekday, 1, 5);
  const crowdWeekend = intInRange(raw.crowdWeekend, 1, 5);
  if (crowdWeekday === null || crowdWeekend === null) {
    return { ok: false, message: "人潮程度必須是 1 到 5" };
  }

  const costPerFamily = optionalInt(raw.costPerFamily, 0, 100000);
  if (costPerFamily === undefined) {
    return { ok: false, message: "費用必須是非負整數，或留空" };
  }

  const personalRating = optionalInt(raw.personalRating, 1, 5);
  if (personalRating === undefined) {
    return { ok: false, message: "個人評分必須是 1 到 5，或留空" };
  }

  const tags = raw.tags
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter((t) => t !== "");

  const ageRange: AgeRangeMonths = { minMonths: ageMin, maxMonths: ageMax };
  const crowdLevel: CrowdLevel = {
    weekday: crowdWeekday as Rating,
    weekend: crowdWeekend as Rating,
  };

  return {
    ok: true,
    value: {
      name,
      category: raw.category as Category,
      address: raw.address.trim(),
      lat,
      lng,
      driveMinutes,
      parking: raw.parking as ParkingRating,
      energyBurn: energyBurn as Rating,
      typicalDurationMin,
      bestTimeSlots: raw.bestTimeSlots as TimeSlot[],
      ageRange,
      sweetSpotAge,
      indoor: raw.indoor as IndoorType,
      shadeLevel: shadeLevel as ShadeLevel,
      strollerFriendly: raw.strollerFriendly,
      hasChangingTable: raw.hasChangingTable,
      hasNursingSpace: raw.hasNursingSpace,
      hasFoodOnSite: raw.hasFoodOnSite,
      hasWaterPlay: raw.hasWaterPlay,
      needsReservation: raw.needsReservation,
      crowdLevel,
      quietHours: raw.quietHours.trim() || null,
      costPerFamily,
      personalRating: personalRating as Rating | null,
      notes: raw.notes.trim() || null,
      tags,
      fieldSources: manualFieldSources(),
      lastVerifiedAt: new Date().toISOString(),
    },
  };
}

/**
 * 人工填寫的欄位來源（設計架構書 §12.6）。
 *
 * v1 全部是 "manual"，但這個欄位從第一天就存在，
 * Phase 2 導入 AI 建檔時不需要 migration。
 */
function manualFieldSources(): Record<string, FieldSource> {
  const fields = [
    "name", "category", "address", "lat", "lng", "driveMinutes", "parking",
    "energyBurn", "typicalDurationMin", "bestTimeSlots", "ageRange",
    "sweetSpotAge", "indoor", "shadeLevel", "strollerFriendly",
    "hasChangingTable", "hasNursingSpace", "hasFoodOnSite", "hasWaterPlay",
    "needsReservation", "crowdLevel", "quietHours", "costPerFamily",
    "personalRating", "notes", "tags",
  ];
  return Object.fromEntries(fields.map((f) => [f, "manual" as FieldSource]));
}

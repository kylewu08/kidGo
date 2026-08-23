/**
 * KidGo 資料模型 — 對應設計架構書 §5
 *
 * 三張核心表 Child / Place / Visit 加上單列的 HomeBase。
 * 設計架構書 §3.2 講得很直接：這三張表的持久化，比推薦演算法本身更接近產品的本質。
 * 聊天介面給不了持久狀態、驗證過的在地事實、個人歷史——那才是護城河。
 *
 * SQLite 沒有原生的 array 與 enum：
 * - 聯集型別用 text 欄位加 `$type<T>()`，型別由 TypeScript 保證
 * - 陣列與巢狀物件用 `{ mode: "json" }`
 * 這兩種做法在換到 Postgres 時分別對應 enum 與 jsonb，遷移成本可控（ADR-0001）。
 */

import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// 聯集型別（設計架構書 §5.1、§5.2）
// ---------------------------------------------------------------------------

/** 午睡階段。可由月齡推算，但允許手動覆寫——實際作息永遠比對照表準。 */
export type NapStage =
  | "two_naps" // 約 6-14m
  | "one_nap" // 約 14-36m
  | "transitioning" // 2→1 或 1→0 過渡期
  | "no_nap"; // 約 3y+

/** 行動能力。與 napStage 同為推薦邏輯的支點（見下方 children 表的註解）。 */
export type Mobility =
  | "carried" // 需揹/抱
  | "stroller" // 主要靠推車
  | "walks_short" // 能走但續航短
  | "walks_full";

export type Category =
  | "park"
  | "playground"
  | "indoor_playground"
  | "museum"
  | "farm"
  | "beach"
  | "trail"
  | "kids_cafe"
  | "mall"
  | "library"
  | "other";

export type IndoorType = "indoor" | "outdoor" | "mixed" | "covered_outdoor";

export type TimeSlot =
  | "early_morning"
  | "morning"
  | "post_nap"
  | "late_afternoon";

export type ParkingRating = "easy" | "moderate" | "hard" | "none";

/**
 * 每個欄位的資料來源（設計架構書 §5.2，v0.2 新增）
 *
 * AI 建議的欄位可信度低於親身驗證的欄位。UI 必須能區分「AI 猜的」與「我確認過的」，
 * 否則錯誤資料會混入而無法追查。
 *
 * v1 全部會是 "manual"（Phase 1 手動建檔 40–60 筆），但欄位從第一天就存在——
 * Phase 2 導入 AI 建檔時就不需要 migration（§12.6）。
 */
export type FieldSource =
  | "manual"
  | "ai_suggested"
  | "ai_confirmed"
  | "visit_corrected";

/** 1–5 的評級。用 TypeScript 縮小範圍，SQLite 端仍是 integer。 */
export type Rating = 1 | 2 | 3 | 4 | 5;

/** 遮蔽程度 0–3。0 = 全無遮蔽，3 = 幾乎全遮。影響高溫時的 Stage 1 過濾。 */
export type ShadeLevel = 0 | 1 | 2 | 3;

export interface TimeWindow {
  /** "HH:MM" */
  start: string;
  /** "HH:MM" */
  end: string;
}

export interface AgeRangeMonths {
  minMonths: number;
  maxMonths: number;
}

export interface CrowdLevel {
  weekday: Rating;
  weekend: Rating;
}

export interface WeatherSnapshot {
  condition: string;
  tempC: number;
  /** 0–100 */
  rainProbability: number;
}

// ---------------------------------------------------------------------------
// Child（設計架構書 §5.1）
// ---------------------------------------------------------------------------

/**
 * napStage 與 mobility 是推薦邏輯的支點，也是本產品相對於一般旅遊 App 的結構性優勢：
 * 它們每 3–6 個月改變一次，推薦結果必須跟著變，這本身就構成回訪理由。
 */
export const children = sqliteTable("children", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** ISO date, "YYYY-MM-DD" */
  birthDate: text("birth_date").notNull(),
  /** 預設由月齡推算（見 lib/schedule/napStage.ts），此欄位是覆寫後的實際值 */
  napStage: text("nap_stage").$type<NapStage>().notNull(),
  /** "HH:MM" */
  wakeTime: text("wake_time").notNull(),
  /** 可能有兩段（two_naps 階段） */
  napWindows: text("nap_windows", { mode: "json" })
    .$type<TimeWindow[]>()
    .notNull()
    .default(sql`'[]'`),
  /** "HH:MM" */
  bedTime: text("bed_time").notNull(),
  mobility: text("mobility").$type<Mobility>().notNull(),
  notes: text("notes"),
});

// ---------------------------------------------------------------------------
// Place（設計架構書 §5.2）
// ---------------------------------------------------------------------------

/**
 * 欄位設計原則：**只記錄 Google Maps 和現有懶人包查不到的東西。**
 *
 * 這是本產品的核心差異化，每個欄位都是刻意的選擇。
 * 要增刪欄位請先討論（CONTRIBUTING.md §4），不要直接改。
 */
export const places = sqliteTable("places", {
  id: text("id").primaryKey(),

  /**
   * v1 永遠是同一個值。預留給未來的多使用者支援，
   * 這樣那天到來時不需要大改 schema（設計架構書 §12.1）。
   */
  ownerId: text("owner_id").notNull().default("local"),

  name: text("name").notNull(),
  category: text("category").$type<Category>().notNull(),

  // --- 位置 ---
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  address: text("address").notNull(),
  /**
   * 從家出發的**實際**車程，手填。
   * 刻意不接 Directions API：一來省錢，二來自己開過的時間（含找停車位）比 API 準。
   * AI 建檔時禁止填寫此欄位（設計架構書 §7.2）。
   */
  driveMinutes: integer("drive_minutes").notNull(),
  parking: text("parking").$type<ParkingRating>().notNull(),

  // --- 核心：現有平台查不到的欄位 ---
  /** 放電強度 1–5 */
  energyBurn: integer("energy_burn").$type<Rating>().notNull(),
  /** 實際能撐多久，不是官方建議時間 */
  typicalDurationMin: integer("typical_duration_min").notNull(),
  bestTimeSlots: text("best_time_slots", { mode: "json" })
    .$type<TimeSlot[]>()
    .notNull()
    .default(sql`'[]'`),
  /** 硬性範圍：不在此範圍內於 Stage 1 直接剔除 */
  ageRange: text("age_range", { mode: "json" })
    .$type<AgeRangeMonths>()
    .notNull(),
  /**
   * 最適年齡。落在此範圍 Stage 2 年齡契合度給滿分。
   * AI 建檔時禁止填寫——這是關於你小孩的判斷，不是關於地點的事實（§7.2）。
   */
  sweetSpotAge: text("sweet_spot_age", { mode: "json" }).$type<AgeRangeMonths>(),

  // --- 環境條件 ---
  indoor: text("indoor").$type<IndoorType>().notNull(),
  shadeLevel: integer("shade_level").$type<ShadeLevel>().notNull(),
  strollerFriendly: integer("stroller_friendly", { mode: "boolean" }).notNull(),
  hasChangingTable: integer("has_changing_table", {
    mode: "boolean",
  }).notNull(),
  hasNursingSpace: integer("has_nursing_space", { mode: "boolean" }).notNull(),
  hasFoodOnSite: integer("has_food_on_site", { mode: "boolean" }).notNull(),
  hasWaterPlay: integer("has_water_play", { mode: "boolean" }).notNull(),
  needsReservation: integer("needs_reservation", { mode: "boolean" }).notNull(),

  // --- 實務情報 ---
  /** 自由文字，例如「平日 14:00-16:00 人最少」 */
  quietHours: text("quiet_hours"),
  crowdLevel: text("crowd_level", { mode: "json" }).$type<CrowdLevel>().notNull(),
  costPerFamily: integer("cost_per_family"),
  /** 雨天備案：天氣突變時可改去的室內地點 */
  indoorBackupPlaceIds: text("indoor_backup_place_ids", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),

  // --- 主觀 ---
  /** AI 建檔時禁止填寫（§7.2） */
  personalRating: integer("personal_rating").$type<Rating>(),
  notes: text("notes"),
  tags: text("tags", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),

  // --- 資料來源追蹤（設計架構書 §5.2，v0.2 新增）---
  /** key 是 Place 的欄位名，value 是該欄位的來源。見 FieldSource 的註解。 */
  fieldSources: text("field_sources", { mode: "json" })
    .$type<Partial<Record<string, FieldSource>>>()
    .notNull()
    .default(sql`'{}'`),
  /** ISO datetime。距今太久的資料在 UI 上應提示重新確認。 */
  lastVerifiedAt: text("last_verified_at"),
});

// ---------------------------------------------------------------------------
// Visit（設計架構書 §5.3）
// ---------------------------------------------------------------------------

/**
 * **append-only，永不刪除**（設計架構書 §12.3）。這是本產品最有價值的資產。
 *
 * 注意 Visit 在評分中只佔 5%。它真正的價值不在自動調整排序，
 * 而在讓開發者發現自己把靜態欄位填錯了（§2）——
 * 「不是這地點不好，是兩歲前撐不到兩小時」，然後手動改 sweetSpotAge。
 * 所以 UI 的地點歷史摘要視圖（§10.2）比任何自動化的權重學習都重要。
 */
export const visits = sqliteTable("visits", {
  id: text("id").primaryKey(),
  placeId: text("place_id")
    .notNull()
    .references(() => places.id),
  childIds: text("child_ids", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  /** ISO date, "YYYY-MM-DD" */
  date: text("date").notNull(),
  /** "HH:MM" */
  arrivedAt: text("arrived_at").notNull(),
  /** "HH:MM" */
  leftAt: text("left_at").notNull(),

  /**
   * 月齡**快照**，不要用 birthDate 反推。
   * 兩年後回頭看「小孩 18 個月時的結果」才有意義，反推會失去當下情境。
   * 順序對應 childIds。
   */
  childAgesMonths: text("child_ages_months", { mode: "json" })
    .$type<number[]>()
    .notNull()
    .default(sql`'[]'`),

  /** 當天實際天氣的快照，同樣是為了保留當下情境 */
  weatherSnapshot: text("weather_snapshot", { mode: "json" })
    .$type<WeatherSnapshot>()
    .notNull(),

  /** 整體結果 1–5 */
  outcome: integer("outcome").$type<Rating>().notNull(),
  /** 實際放電強度，用來對照 places.energyBurn 是否填錯 */
  actualEnergyBurn: integer("actual_energy_burn").$type<Rating>().notNull(),
  napHappened: integer("nap_happened", { mode: "boolean" }).notNull(),
  /**
   * 最誠實的訊號。長期累積能反推出「這地點對這年齡不適合」，
   * 是懶人包永遠給不了的洞察。
   */
  meltdown: integer("meltdown", { mode: "boolean" }).notNull(),
  wouldReturn: integer("would_return", { mode: "boolean" }).notNull(),
  notes: text("notes"),
  photos: text("photos", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
});

// ---------------------------------------------------------------------------
// HomeBase（設計架構書 §5.4）
// ---------------------------------------------------------------------------

/** 單列表。id 固定為 "default"，由 CHECK 約束保證不會有第二列。 */
export const homeBase = sqliteTable("home_base", {
  id: text("id").primaryKey().default("default"),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  /** 對應中央氣象署鄉鎮預報地區名，如「板橋區」。用於 F-D0047 系列 API。 */
  cwaLocationName: text("cwa_location_name").notNull(),
  maxDriveMinutes: integer("max_drive_minutes").notNull(),
});

// ---------------------------------------------------------------------------
// 推斷型別
// ---------------------------------------------------------------------------

export type Child = typeof children.$inferSelect;
export type NewChild = typeof children.$inferInsert;

export type Place = typeof places.$inferSelect;
export type NewPlace = typeof places.$inferInsert;

export type Visit = typeof visits.$inferSelect;
export type NewVisit = typeof visits.$inferInsert;

export type HomeBase = typeof homeBase.$inferSelect;
export type NewHomeBase = typeof homeBase.$inferInsert;

/**
 * KidGo 資料模型 — 依設計架構書 v1.0 §6 語彙與 §7 流程
 *
 * 取捨理由見 docs/資料模型草案.md 與 docs/adr/0014-data-model-decisions.md。
 *
 * 三個貫穿全檔的原則：
 *
 * 1. **使用者負擔與系統負擔要分開。** §13.2.6「除兩項回饋外皆為選填」
 *    講的是使用者要填的東西，不是系統本來就知道的東西。
 *    每個欄位的註解標明是誰填的。
 * 2. **不可能的狀態要無法表示。** 例如「有遊具但適齡層是空的」不該存在。
 * 3. **每個欄位都要知道自己怎麼來的**（`fieldSources`），
 *    因為匯入器重跑時要靠它判斷能不能覆蓋。
 *
 * SQLite 沒有原生 array / boolean / enum：聯集型別用 text + `$type<T>()`，
 * 陣列與物件用 `{ mode: "json" }`，布林用 integer + `{ mode: "boolean" }`。
 */

import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// 聯集型別
// ---------------------------------------------------------------------------

/** 類別。決定匯入時套用哪一組先驗值（v1.0 §11.1）。 */
export type Category =
  | "inclusive_playground" // 共融／特色遊戲場
  | "park" // 一般公園
  | "parenting_center" // 親子館／托育資源中心
  | "indoor_playground" // 室內遊樂場
  | "museum" // 博物館／美術館／科教館
  | "library" // 圖書館
  | "farm" // 農場／牧場
  | "trail" // 步道
  | "beach" // 海邊／沙灘
  | "kids_restaurant" // 親子餐廳
  | "mall_play_area"; // 百貨遊戲區

/**
 * 年齡層（v1.0 §6.2 設施適齡層）。
 * 對應的月齡區間屬於領域參數，不存在資料庫裡——見 lib/domain/age-bands.ts。
 */
export type AgeBand = "infant" | "toddler" | "preschool" | "school_age";

export type IndoorType = "indoor" | "outdoor" | "mixed" | "covered_outdoor";

export type TimeSlot =
  | "early_morning"
  | "morning"
  | "post_nap"
  | "late_afternoon";

export type NapStage = "two_naps" | "one_nap" | "transitioning" | "no_nap";

export type Mobility = "carried" | "stroller" | "walks_short" | "walks_full";

/**
 * 欄位來源（v1.0 §6.2）。
 *
 * **匯入器只能覆蓋 `category_prior` 的欄位**，其餘代表人已經確認過。
 * 這是 upsert 規則的依據，也是「時長自動修正」只動先驗值的依據（ADR-0014）。
 */
export type FieldSource =
  | "category_prior"
  | "ai_suggested"
  | "manual"
  | "visit_corrected";

/** 開放資料來源（v1.0 §10.1） */
export type SourceDataset =
  | "playground_registry" // 兒童遊戲場／共融遊戲場清冊
  | "parenting_center" // 親子館／托育資源中心
  | "park_facility" // 公園設施
  | "tourism_spot" // 觀光資訊資料庫－景點
  | "library" // 圖書館／文化中心
  | "manual"; // 使用者自行新增（非匯入）

export type Rating = 1 | 2 | 3 | 4 | 5;
export type Level0to3 = 0 | 1 | 2 | 3;

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

export interface WeatherSnapshot {
  condition: string;
  apparentTempC: number;
  /** 0–100 */
  rainProbability: number;
}

// ---------------------------------------------------------------------------
// Place（地點）
// ---------------------------------------------------------------------------

export const places = sqliteTable("places", {
  id: text("id").primaryKey(),

  // --- 來源追蹤：讓重複匯入能認出「這是同一個地點」---
  sourceDataset: text("source_dataset").$type<SourceDataset>().notNull(),
  /** 該資料集內的原始主鍵。與 sourceDataset 合成外部唯一鍵。 */
  sourceId: text("source_id").notNull(),
  importedAt: text("imported_at"),
  sourceUpdatedAt: text("source_updated_at"),
  /**
   * 來源資料集不再包含這筆時標記，**但不刪除**——它可能已有造訪紀錄，
   * 刪掉會讓紀錄變成孤兒（§6.4 紀錄永不刪除）。
   */
  sourceRemovedAt: text("source_removed_at"),

  // --- 位置 ---
  name: text("name").notNull(),
  category: text("category").$type<Category>().notNull(),
  address: text("address").notNull().default(""),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  /** 找車位要花的時間，加在車程估算上（§6.2）。先驗值，可手動改。 */
  parkingSearchMinutes: integer("parking_search_minutes").notNull().default(5),
  /**
   * 是否走國道。決定連假係數（§11.2）與能否跳過即時查詢（§10.3.2）。
   * 匯入階段不呼叫 Google（ADR-0013），所以用直線距離門檻推導（ADR-0014）。
   */
  usesFreeway: integer("uses_freeway", { mode: "boolean" }).notNull().default(false),

  // --- 核心判斷欄位（§6.2）---
  /** 放電強度：消耗小孩體力的程度 */
  energyBurn: integer("energy_burn").$type<Rating>().notNull(),
  /** 實際能撐多久，不是官方建議時間 */
  typicalDurationMinutes: integer("typical_duration_minutes").notNull(),
  bestTimeSlots: text("best_time_slots", { mode: "json" })
    .$type<TimeSlot[]>()
    .notNull()
    .default(sql`'[]'`),

  /**
   * 現場遊具實際適用的年齡層。**null 代表無遊具設施**（美術館、步道、沙灘）。
   *
   * 用「集合或 null」而不是「布林 + 集合」：後者能表示
   * 「有設施但適齡層是空的」這種不可能的狀態。
   *
   * §7.1：有設施但不含小孩年齡層、且無可奔跑空間可替代 → **硬過濾剔除**。
   * 家長不會「去了才發現不適合」，而是看到現場只有大型遊具就事前排除。
   */
  facilityAgeBands: text("facility_age_bands", { mode: "json" }).$type<AgeBand[]>(),

  /**
   * 這個「地方」適合的月齡範圍，與 facilityAgeBands 是不同的概念（ADR-0014）。
   * 步道沒有遊具，但對六個月大的嬰兒仍然不適合——那要靠這個欄位擋。
   */
  suitableAgeMonths: text("suitable_age_months", { mode: "json" })
    .$type<AgeRangeMonths>()
    .notNull(),

  /** 能否自由跑動 0–3。可補償「無適齡設施」（§7.1）。 */
  runnableSpace: integer("runnable_space").$type<Level0to3>().notNull(),
  /** 3＝跑不掉；0＝鄰接車道或開放水域。幼兒階段的硬過濾條件。 */
  safetyEnclosure: integer("safety_enclosure").$type<Level0to3>().notNull(),
  /**
   * 家長的體力消耗 1–5。超過偏好上限 → **硬過濾剔除**。
   *
   * §6.2：這是決策中被長期忽略的變數。決定要不要去的是家長，
   * 「小孩玩得開心但家長累垮」與「兩者皆可」是不同的結果。
   */
  parentEffort: integer("parent_effort").$type<Rating>().notNull(),

  // --- 環境 ---
  indoorType: text("indoor_type").$type<IndoorType>().notNull(),
  /** 夏季關鍵（§6.2） */
  hasAirConditioning: integer("has_air_conditioning", { mode: "boolean" }).notNull(),
  /** 遮蔭 0–3，對高溫的補償 */
  shadeLevel: integer("shade_level").$type<Level0to3>().notNull(),
  strollerFriendly: integer("stroller_friendly", { mode: "boolean" }).notNull(),

  // --- 資料品質 ---
  /** key 是本表的欄位名。匯入器只能覆蓋值為 category_prior 的欄位。 */
  fieldSources: text("field_sources", { mode: "json" })
    .$type<Partial<Record<string, FieldSource>>>()
    .notNull()
    .default(sql`'{}'`),
  /**
   * 使用者按「看了覺得不適合」時標記（ADR-0011）。
   * 這是**資料品質訊號不是偏好訊號**——它降低這個地點的曝光，
   * 但不影響類別權重。
   */
  dataSuspect: integer("data_suspect", { mode: "boolean" }).notNull().default(false),
  dataSuspectReason: text("data_suspect_reason"),
  lastVerifiedAt: text("last_verified_at"),
  notes: text("notes"),
});

/**
 * 「候選 / 已驗證」刻意**不存成欄位**，由造訪紀錄筆數導出。
 * 存成欄位會與紀錄不同步，而它零成本就能算出來。
 */

// ---------------------------------------------------------------------------
// Child（小孩）— 與 v0.2 幾乎相同，§6.1 與 §11.3 皆未變
// ---------------------------------------------------------------------------

export const children = sqliteTable("children", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** ISO date */
  birthDate: text("birth_date").notNull(),
  /** 由月齡推導，可手動覆寫 */
  napStage: text("nap_stage").$type<NapStage>().notNull(),
  wakeTime: text("wake_time").notNull(),
  napWindows: text("nap_windows", { mode: "json" })
    .$type<TimeWindow[]>()
    .notNull()
    .default(sql`'[]'`),
  bedTime: text("bed_time").notNull(),
  mobility: text("mobility").$type<Mobility>().notNull(),
  notes: text("notes"),
});

// ---------------------------------------------------------------------------
// HomeBase — 固定的家，不是當下位置
// ---------------------------------------------------------------------------

export const homeBase = sqliteTable("home_base", {
  id: text("id").primaryKey().default("default"),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  /** 縣市，決定抓哪一份 CWA 鄉鎮預報（ADR-0006、ADR-0012） */
  cwaCountyName: text("cwa_county_name").notNull(),
  cwaLocationName: text("cwa_location_name").notNull(),
  maxDriveMinutes: integer("max_drive_minutes").notNull(),
});

// ---------------------------------------------------------------------------
// FamilyPreference（家庭偏好）— §6.3
// ---------------------------------------------------------------------------

/** 單列表。小孩約束決定「哪些不可能」，家庭偏好決定「哪些你們真的會去」。 */
export const familyPreferences = sqliteTable("family_preferences", {
  id: text("id").primaryKey().default("default"),
  /** −2…+2，負為偏室內。五段而非連續值，UI 才講得清楚（ADR-0014）。 */
  outdoorTendency: integer("outdoor_tendency").notNull().default(0),
  /** 家長負擔上限 1–5。超過的地點在 Stage 1 被剔除。 */
  maxParentEffort: integer("max_parent_effort").$type<Rating>().notNull(),
  requiresMeal: integer("requires_meal", { mode: "boolean" }).notNull().default(false),
});

/**
 * 各類別的相對偏好，由回饋累積學習（§6.3）。
 *
 * 另立一張表而不是塞進 familyPreferences 的 JSON 欄位，
 * 因為它有學習狀態要追蹤，而且 §6.3 硬性要求 UI 顯示學習依據
 * （「戶外公園 +35%，依你最近 12 次選擇」）——那個「12 次」必須查得到。
 */
export const categoryPreferences = sqliteTable("category_preferences", {
  category: text("category").$type<Category>().primaryKey(),
  /** 由採納／跳過／回饋累積 */
  learnedWeight: real("learned_weight").notNull().default(0),
  /**
   * 非 null 時**優先於學習值，且學習不再更新它**（§6.3）。
   * 你必須能在半年後說「這條學錯了」然後改掉它。
   */
  manualWeight: real("manual_weight"),
  /** **少於 8 筆時不套用學習權重**（§6.3） */
  sampleCount: integer("sample_count").notNull().default(0),
  lastUpdatedAt: text("last_updated_at"),
});

// ---------------------------------------------------------------------------
// ContextOverride（一次性情境）— §8
// ---------------------------------------------------------------------------

/** AI 可以覆寫的推薦條件，範圍由 §8 限定，不得擴充。 */
export interface ContextOverrideValues {
  maxParentEffort?: Rating;
  availableWindow?: TimeWindow;
  maxDriveMinutes?: number;
  avoidCrowds?: boolean;
  maxEnergyBurn?: Rating;
}

/**
 * 一次性情境輸入的轉譯結果。
 *
 * **僅對本次有效，不寫入 FamilyPreference，不影響長期學習**（§8.3）。
 * 原始輸入與轉譯說明必須保存，否則日後會誤讀——
 * 「因外婆同行才去沙灘」不該被解讀為「沙灘一直都適合我們家」（§6.4）。
 */
export const contextOverrides = sqliteTable("context_overrides", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  /** 使用者實際打的字 */
  rawInput: text("raw_input").notNull(),
  /** 經型別與範圍驗證後的結構化值。超出允許範圍的一律丟棄（§8.6）。 */
  overrides: text("overrides", { mode: "json" })
    .$type<ContextOverrideValues>()
    .notNull()
    .default(sql`'{}'`),
  /** 給 UI 顯示的說明，必須明示且可逐項取消（§8.2） */
  explanation: text("explanation").notNull().default(""),
});

// ---------------------------------------------------------------------------
// Suggestion（推播建議）— 回饋迴路的樞紐
// ---------------------------------------------------------------------------

export type SuggestionKind = "morning" | "afternoon";

/**
 * 使用者對建議的回應（ADR-0011）。
 *
 * 原本 §9.3 只有「去了／沒去」，但「沒去」混合了三種完全不同的事，
 * 卻全部被當成降權依據餵給最重要的長期訊號。
 */
export type SuggestionResponse =
  /** 去了 → 類別權重 ↑，產生一筆 Visit */
  | "went"
  /** 今天沒出門 → **不影響任何權重**。這是生活的問題不是推薦的問題 */
  | "stayed_home"
  /** 去了別的地方 → 類別權重 ↓（幅度小於採納） */
  | "went_elsewhere"
  /** 看了覺得不適合 → **不影響偏好**，改為標記該地點 dataSuspect */
  | "looked_unsuitable";

/**
 * 系統送出了什麼。
 *
 * §6.4 說「到離時間：取當日推播的建議值，不要求使用者提供」——
 * **那個建議值就存在這裡。** 這張表是「三次點擊完成回饋」得以成立的原因。
 */
export const suggestions = sqliteTable("suggestions", {
  id: text("id").primaryKey(),
  sentAt: text("sent_at").notNull(),
  kind: text("kind").$type<SuggestionKind>().notNull(),

  /** 主建議。「今天不要出門」路徑時為 null。 */
  primaryPlaceId: text("primary_place_id").references(() => places.id),
  /** 備案，至少一個室內選項供天氣突變（§7.3） */
  backupPlaceId: text("backup_place_id").references(() => places.id),
  /**
   * 探索槽（§7.4）。引擎產出三項，但**推播只顯示前兩項**（§9.1
   * 「不列第三個」），這一項在落地頁才看得到。
   */
  explorePlaceId: text("explore_place_id").references(() => places.id),

  /** "HH:MM"，§9.1 要求具體到分鐘 */
  suggestedDeparture: text("suggested_departure"),
  suggestedReturn: text("suggested_return"),

  /**
   * 「今天不要出門」的理由。硬過濾後無存活地點時填。
   * §9.1：推播不得沉默，也不得降低標準硬推——
   * 「今天大雨、體感 34°C，建議在家」是有價值的輸出。
   */
  noOutingReason: text("no_outing_reason"),

  contextOverrideId: text("context_override_id").references(() => contextOverrides.id),

  response: text("response").$type<SuggestionResponse>(),
  respondedAt: text("responded_at"),
  /** went_elsewhere 時若使用者願意說去了哪，這是比較性訊號，強度高得多 */
  wentElsewherePlaceId: text("went_elsewhere_place_id").references(() => places.id),
  responseNote: text("response_note"),
});

// ---------------------------------------------------------------------------
// Visit（造訪紀錄）— §6.4，永不刪除
// ---------------------------------------------------------------------------

/** 停留時間感受。相對值而非分鐘數——使用者不必知道確切時間（§9.2）。 */
export type DurationFeeling = "shorter" | "as_expected" | "longer";

/** 過程結果。「崩潰」是最誠實的訊號。 */
export type VisitOutcome = "smooth" | "ok" | "meltdown";

export const visits = sqliteTable("visits", {
  id: text("id").primaryKey(),
  placeId: text("place_id")
    .notNull()
    .references(() => places.id),
  /** 由推播產生時有值，手動補建時為 null */
  suggestionId: text("suggestion_id").references(() => suggestions.id),
  date: text("date").notNull(),

  childIds: text("child_ids", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  /**
   * 月齡**快照**，順序對應 childIds。
   * **不可由 birthDate 反推**——兩年後回顧「18 個月時的結果」才有意義（§6.4）。
   */
  childAgesMonths: text("child_ages_months", { mode: "json" })
    .$type<number[]>()
    .notNull()
    .default(sql`'[]'`),

  // --- 唯二必填，且皆由推播上的按鈕產生（§6.4、§13.2.6）---
  durationFeeling: text("duration_feeling").$type<DurationFeeling>().notNull(),
  outcome: text("outcome").$type<VisitOutcome>().notNull(),

  // --- 以下皆選填。系統填的不算使用者負擔（ADR-0014）---
  /** 取自當日推播的建議值，不要求使用者提供（§6.4） */
  arrivedAt: text("arrived_at"),
  leftAt: text("left_at"),
  /** Phase 1 不收集（§6.4） */
  actualDriveMinutes: integer("actual_drive_minutes"),
  /**
   * 當日天氣快照。v1.0 未要求，但保留（ADR-0014）：
   * 零使用者負擔，而且**事後補不回來**。
   */
  weatherSnapshot: text("weather_snapshot", { mode: "json" }).$type<WeatherSnapshot>(),
  /**
   * 當次若套用過一次性情境，必須一併保存，否則日後會誤讀（§6.4）。
   */
  contextOverrideId: text("context_override_id").references(() => contextOverrides.id),
  notes: text("notes"),
});

// ---------------------------------------------------------------------------
// 支援性資料
// ---------------------------------------------------------------------------

/** 日型，決定車程係數（§11.2） */
export type DayType = "weekday" | "weekend" | "public_holiday" | "long_weekend";

/** 政府行政機關辦公日曆表，年度快取，無需即時查詢（§10.2） */
export const calendarDays = sqliteTable("calendar_days", {
  /** "YYYY-MM-DD" */
  date: text("date").primaryKey(),
  dayType: text("day_type").$type<DayType>().notNull(),
  note: text("note"),
});

/** Web Push 訂閱。iOS 僅在 PWA 加入主畫面後可用（§9.4）。 */
export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: text("id").primaryKey(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
});

/**
 * Google Routes API 精算結果的短期快取。
 *
 * ⚠️ **必須在 30 天內刪除。** Google Maps Platform 服務條款允許暫存
 * distance / duration / ETA 最多 30 個連續日曆日（ADR-0013）。
 *
 * **這是合規要求不是效能優化**，所以清理排程失敗必須能被發現，不得靜默。
 */
export const routeCache = sqliteTable("route_cache", {
  id: text("id").primaryKey(),
  placeId: text("place_id")
    .notNull()
    .references(() => places.id),
  /** 去程與回程必須分開查與分開存（§7.1） */
  direction: text("direction").$type<"outbound" | "return">().notNull(),
  /** 查詢時指定的出發時刻，ISO datetime */
  departureAt: text("departure_at").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  /** 清理排程依此判斷是否超過 30 天 */
  fetchedAt: text("fetched_at").notNull(),
});

// ---------------------------------------------------------------------------
// 推斷型別
// ---------------------------------------------------------------------------

export type Place = typeof places.$inferSelect;
export type NewPlace = typeof places.$inferInsert;
export type Child = typeof children.$inferSelect;
export type NewChild = typeof children.$inferInsert;
export type HomeBase = typeof homeBase.$inferSelect;
export type NewHomeBase = typeof homeBase.$inferInsert;
export type FamilyPreference = typeof familyPreferences.$inferSelect;
export type NewFamilyPreference = typeof familyPreferences.$inferInsert;
export type CategoryPreference = typeof categoryPreferences.$inferSelect;
export type NewCategoryPreference = typeof categoryPreferences.$inferInsert;
export type Suggestion = typeof suggestions.$inferSelect;
export type NewSuggestion = typeof suggestions.$inferInsert;
export type Visit = typeof visits.$inferSelect;
export type NewVisit = typeof visits.$inferInsert;
export type ContextOverride = typeof contextOverrides.$inferSelect;
export type NewContextOverride = typeof contextOverrides.$inferInsert;
export type CalendarDay = typeof calendarDays.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type RouteCacheEntry = typeof routeCache.$inferSelect;

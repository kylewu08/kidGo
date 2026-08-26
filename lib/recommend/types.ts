/**
 * 推薦引擎的輸入與輸出型別（設計架構書 v1.0 §7）
 *
 * §7.6：引擎是純函式，外部資料（天氣、路況、紀錄）由呼叫端取得後傳入。
 * 這裡定義的就是那個邊界。
 */

import type {
  CategoryPreference,
  Child,
  ContextOverrideValues,
  DayType,
  FamilyPreference,
  Place,
  TimeWindow,
  Visit,
} from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// 天氣
// ---------------------------------------------------------------------------

/** 逐三小時的預報，對應 CWA F-D0047 的資料粒度（§10.2） */
export interface WeatherSlot {
  startsAt: Date;
  /** 0–100 */
  rainProbability: number;
  apparentTempC: number;
  condition: string;
}

export interface WeatherForecast {
  /** 依 startsAt 遞增排序 */
  slots: WeatherSlot[];
}

// ---------------------------------------------------------------------------
// 車程
// ---------------------------------------------------------------------------

/**
 * 去程與回程分開（§7.1「回程必須獨立計算，不可假設等於去程」）。
 *
 * 早上出發與下午返程是不同的路況，而「能否在午睡前返家」正是依賴回程。
 */
export interface DriveLegs {
  outboundMinutes: number;
  returnMinutes: number;
}

/**
 * 車程的來源與信心度（§10.3）。
 *
 * §10.3.5：API 失敗時降級為係數估算並將信心度標為低，
 * **UI 須明示「路況資料暫時無法取得」，不得靜默使用低信心估值。**
 * 這個欄位就是讓 UI 有辦法做到那件事。
 */
export type DriveSource = "precise" | "coarse";

export interface DriveEstimate extends DriveLegs {
  source: DriveSource;
  /** 幾何估計的基準值，用來算壅塞比值。精算時才有意義。 */
  baselineMinutes: number;
}

// ---------------------------------------------------------------------------
// 輸入
// ---------------------------------------------------------------------------

export interface RecommendContext {
  /** 「現在」。由呼叫端傳入而非在函式內取 new Date()，否則測試無法重現。 */
  timestamp: Date;
  children: Child[];
  /** 住家座標。幾何車程估計的起點。 */
  home: { lat: number; lng: number };
  weather: WeatherForecast;
  /** 決定車程係數（§11.2）。由呼叫端查行事曆後傳入。 */
  dayType: DayType;
  maxDriveMinutes: number;
  availableWindow: TimeWindow;

  familyPreference: FamilyPreference;
  categoryPreferences: CategoryPreference[];

  excludeRecentDays?: number;

  /**
   * 精算車程，placeId → 去回程分鐘（§7.1）。
   *
   * 由呼叫端在**進入引擎之前**取得（lib/routes/），僅對粗篩後存活的前 8 名。
   * **缺席即退回幾何估計**——那不是錯誤處理，是 P9 離線可用的保證。
   */
  preciseDrive?: ReadonlyMap<string, DriveLegs>;

  /**
   * 一次性情境覆寫（§8），**必須已經過型別與範圍驗證**。
   * 僅覆寫既有條件，不新增評分因子，僅對本次有效。
   */
  contextOverride?: ContextOverrideValues;
}

// ---------------------------------------------------------------------------
// Stage 1
// ---------------------------------------------------------------------------

export type RejectionReason =
  | "drive_too_long"
  | "not_enough_time"
  | "rain"
  | "heat"
  | "age_out_of_range"
  | "stroller_unfriendly"
  /** 有遊具但不含小孩年齡層，且無可奔跑空間可替代（§7.1） */
  | "facility_age_mismatch"
  /** 家長負擔超過偏好上限（§7.1） */
  | "parent_effort_too_high"
  /** 幼兒階段且安全封閉性過低（§7.1） */
  | "unsafe_for_toddler";

export interface FilterResult {
  place: Place;
  passed: boolean;
  /** 未通過時，第一個踩到的剔除理由 */
  rejectedBy?: RejectionReason;
  warnings: string[];
  drive: DriveEstimate;
}

// ---------------------------------------------------------------------------
// Stage 2
// ---------------------------------------------------------------------------

export type ScoreBreakdown = Record<
  | "schedule"
  | "age"
  | "weather"
  | "familyPreference"
  | "freshness"
  | "drive"
  | "history",
  number
>;

export interface TripTimeline {
  departAt: Date;
  arriveAt: Date;
  leaveAt: Date;
  /** 回到家的時間。用**回程**車程算，不是去程。 */
  homeAt: Date;
}

// ---------------------------------------------------------------------------
// Stage 3 與輸出
// ---------------------------------------------------------------------------

/** §7.3：輸出固定為三項 */
export type SlotKind = "primary" | "backup" | "explore";

export interface Recommendation {
  place: Place;
  /** 這一項在輸出裡的角色。null 代表未進入前三名。 */
  slot: SlotKind | null;
  /** 0–100 */
  score: number;
  scoreBreakdown: ScoreBreakdown;
  perChildScores: { childId: string; score: number }[];
  drive: DriveEstimate;
  /**
   * 人話的理由，由 reasons.ts 的規則模板產生。
   * AI 可潤飾但**不得改變語意、不得新增規則未產生的理由**（§7.5）。
   */
  reasons: string[];
  warnings: string[];
  /** "HH:MM" */
  suggestedDeparture: string;
  /**
   * "HH:MM"。**未造訪過的地點不給精確返家時間**（§7.5），
   * 因為其停留時長僅為類別先驗的估計值。此時為 null。
   */
  suggestedReturn: string | null;
  /** 候選（未造訪）或已驗證（有造訪紀錄）（§6.2） */
  status: "candidate" | "verified";
  timeline: TripTimeline;
}

/** 引擎的完整輸出 */
export interface RecommendResult {
  /** 依 §7.3 挑出的三項，可能不足三項 */
  slots: Recommendation[];
  /** 全部通過硬過濾並評分的地點，依分數排序。除錯與落地頁用。 */
  scored: Recommendation[];
  /** 被剔除的地點與原因。調門檻時看得到才調得動。 */
  rejected: FilterResult[];
  /**
   * 硬過濾後無存活地點時的說明（§9.1「今天不要出門」路徑）。
   * **推播不得沉默，也不得降低標準硬推。**
   */
  noOutingReason: string | null;
  /** 偏好權重是否被 §7.4 防線一抑制。UI 可據此說明為何排序看起來不同。 */
  preferenceSuppressed: boolean;
}

export type { Child, Place, TimeWindow, Visit, DayType };

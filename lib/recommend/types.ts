/**
 * 推薦引擎的輸入與輸出型別（設計架構書 §6.1、§6.5）
 *
 * ⚠️ 這個檔案不在設計架構書 §8.2 列出的結構裡。加它的理由是 filters.ts 與
 * scoring.ts 都需要 RecommendContext，型別放在 index.ts 會造成循環 import。
 */

import type { Child, Place, TimeWindow, Visit } from "@/lib/db/schema";

/**
 * 逐三小時的天氣預報，對應中央氣象署 F-D0047 系列的資料粒度（設計架構書 §9）。
 *
 * ⚠️ 設計架構書沒有定義 WeatherForecast 的形狀，只提到需要「逐 3 小時降雨機率、
 * 體感溫度」以及 §6.5 用到的 `weather.rainProbAfter(15)`。這裡定義成**純資料**
 * 而非帶方法的物件，因為 §8.3 要求 recommend() 不呼叫網路——
 * 預報必須在進入推薦引擎之前就取好，引擎只負責讀。
 */
export interface WeatherSlot {
  /** 這個三小時區間的起點 */
  startsAt: Date;
  /** 降雨機率 0–100 */
  rainProbability: number;
  /** 體感溫度。用體感而非氣溫，理由見 thresholds.ts */
  apparentTempC: number;
  /** CWA 的天氣現象描述，例如「多雲時陰短暫陣雨」 */
  condition: string;
}

export interface WeatherForecast {
  /** 依 startsAt 遞增排序 */
  slots: WeatherSlot[];
}

/** 推薦引擎的輸入（設計架構書 §6.1） */
export interface RecommendContext {
  /** 「現在」。由呼叫端傳入而非在函式內取 new Date()，否則測試無法重現。 */
  timestamp: Date;
  /** 這趟要帶的小孩。多個小孩時取最低分，見 scoring.ts */
  children: Child[];
  weather: WeatherForecast;
  maxDriveMinutes: number;
  /** 今天可用的時間區間，"HH:MM" */
  availableWindow: TimeWindow;
  /** 預設 14（THRESHOLDS.DEFAULT_EXCLUDE_RECENT_DAYS） */
  excludeRecentDays?: number;
}

/** 一趟出遊的時間軸，Stage 1 與 Stage 2 都要用 */
export interface TripTimeline {
  departAt: Date;
  arriveAt: Date;
  leaveAt: Date;
  /** 回到家的時間。午睡相容性判斷的關鍵。 */
  homeAt: Date;
}

/** Stage 1 的結果。被剔除的地點也保留，附上原因供除錯與 UI 說明。 */
export interface FilterResult {
  place: Place;
  passed: boolean;
  /** 未通過時，第一個踩到的剔除理由 */
  rejectedBy?: RejectionReason;
  /** 不影響通過與否，但要提醒使用者的事項 */
  warnings: string[];
}

export type RejectionReason =
  | "drive_too_long"
  | "not_enough_time"
  | "rain"
  | "heat"
  | "age_out_of_range"
  | "stroller_unfriendly";

/** 六個因子各自的 0–1 得分，加權前的原始值。除錯用。 */
export type ScoreBreakdown = Record<
  "schedule" | "age" | "weather" | "freshness" | "drive" | "history",
  number
>;

/**
 * Stage 1 + Stage 2 的輸出。
 *
 * ⚠️ 這**還不是** §6.5 定義的 `Recommendation`。缺 Stage 3 多樣性調整（§6.4）、
 * `reasons` 規則模板（§6.5）與 `suggestedDeparture` / `backupPlace`。
 * 那些完成後，index.ts 的回傳型別會收斂為 `Recommendation[]`（§8.3 的簽章）。
 */
export interface ScoredPlace {
  place: Place;
  /** 0–100 */
  score: number;
  /** UI 預設不顯示，僅開發模式可見（§6.5） */
  scoreBreakdown: ScoreBreakdown;
  /** 每個小孩各自的總分。多小孩時 score 取其最低值。 */
  perChildScores: { childId: string; score: number }[];
  warnings: string[];
  timeline: TripTimeline;
}

export type { Child, Place, TimeWindow, Visit };

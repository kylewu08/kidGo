/**
 * Stage 1 硬性過濾的門檻值（設計架構書 v1.0 §7.1、§13.2.10）
 *
 * 這些值編碼的是 **L1 判斷力**——育兒常識，第一天就具備，不需要任何歷史紀錄。
 * 這一階段通常能把數百筆縮減至個位數。
 *
 * 集中在這裡的理由：調門檻是長期持續的工作。散在 filters.ts 裡的魔術數字
 * 半年後沒人知道是怎麼來的，而且改一個值要翻三個檔案。
 *
 * **改動時 commit 訊息必須寫出觸發調整的實際觀察**（CONTRIBUTING.md 的 `tune`）。
 */

import type { TimeSlot } from "@/lib/db/schema";

export const THRESHOLDS = {
  /**
   * 降雨機率超過此值（%），純戶外地點剔除。
   *
   * 60 而不是 50：台灣午後雷陣雨的預報常態性偏高，門檻訂太低會在夏天
   * 把戶外選項清空，那時系統就只剩室內遊樂場，失去意義。
   */
  rainProbabilityExcludeOutdoor: 60,

  /** 體感溫度超過此值（°C）且遮蔭不足時，純戶外地點剔除 */
  apparentTempExcludeOutdoor: 33,
  /** 上一條的但書：遮蔭大於此值不受高溫剔除（0＝全無遮蔽） */
  heatExemptShadeLevelAbove: 1,

  /**
   * 粗篩的車程門檻放寬倍數（§7.1「門檻放寬約 20%，避免粗估誤差誤殺」）。
   *
   * **這是整條管線唯一的誤差緩衝**（ADR-0014）。幾何估計本身求準、
   * 不刻意偏移，容忍度全部集中在這一個數字上——
   * 兩層緩衝會互相抵銷而且無法單獨調整。
   */
  coarseDriveSlack: 1.2,

  /**
   * 「有遊具但不適齡」時，可奔跑空間要達到多少才算有替代方案（§7.1）。
   *
   * §6.2 的例子：美術館沒有遊具、放電低，但對 20 個月幼兒是好選擇——
   * 可跑（3）、家長不累、有冷氣、跑不掉。可奔跑空間就是那個替代品。
   */
  runnableSpaceCompensatesAge: 3,

  /**
   * 幼兒階段時，安全封閉性低於此值即剔除（§7.1）。
   *
   * 0＝鄰接車道或開放水域。對還在被抱著或走沒幾步就要抱的小孩，
   * 那不是「要多留意」，是不能去。
   */
  minSafetyEnclosureForToddlers: 1,

  /** 判定為「幼兒階段」的行動力（§7.1「需抱／續航短」） */
  toddlerMobilities: ["carried", "walks_short"] as const,

  /** `excludeRecentDays` 未指定時的預設值 */
  defaultExcludeRecentDays: 14,
} as const;

/**
 * 時段的時鐘定義。
 *
 * ⚠️ 這組區間是**推測值**，設計架構書沒有定義 TimeSlot 對應的時鐘範圍。
 * 起點取自 §11.3 的建議出遊窗。
 *
 * 邊界不是懸崖：離開區間後於 `SCORING.schedule.softEdgeMinutes` 內線性遞減，
 * 因為小孩不會在 11:30 整點變得不適合出門。
 *
 * ⚠️ **已知問題**：11:30–14:30 不屬於任何時段，柔化邊界也蓋不滿。
 * 對還在睡午覺的小孩，這只是加強了本來就正確的訊號；
 * 但對已無午睡的小孩不合理——他們午睡那半拿滿分，卻仍因為
 * 「12:00 不屬於任何時段」被扣分，而中午帶四歲小孩出門並沒有不對。
 * 若實際使用發現大小孩的中午推薦明顯偏低，處理方式是把四個時段
 * 改成連續覆蓋，而不是再加一個補償係數。
 */
export const TIME_SLOT_RANGES: Record<
  TimeSlot,
  { startHour: number; endHour: number }
> = {
  early_morning: { startHour: 6, endHour: 9 },
  morning: { startHour: 9, endHour: 11.5 },
  post_nap: { startHour: 14.5, endHour: 16.5 },
  late_afternoon: { startHour: 16.5, endHour: 18.5 },
};

/**
 * 今天大人想去哪一類（ADR-0026）
 *
 * 模型裡跟喜好有關的三種東西都是**慢變數**：`outdoorTendency` 是常態、
 * `categoryPreferences` 是學來的常態、§8 允許覆寫的五項不含類別。
 * 但使用者指出「有時候想去海邊，有時候想去美術館，有時候想去親子館」
 * ——**大人今天想幹嘛是快變數**，而那實際會影響決定。
 *
 * ## 為什麼是選項不是自由輸入
 *
 * §8 的一次性情境是「自由輸入 + AI 轉譯」。這件事不需要 AI：
 * 憲法規定 AI 只能「轉譯輸入」，而「想待在有冷氣的地方」**本身就是那個值**，
 * 沒有需要轉譯的東西。少一層 AI 就少一個不可重現的環節，而且離線可用（P9）。
 *
 * ## 為什麼不用「室內／戶外」兩分
 *
 * 使用者自己的例子就穿過那條線——親子館是室內，但跟美術館的體感完全不同。
 * 所以切的是**體感群組**，不是物理屬性。
 */

import type { Category } from "@/lib/db/schema";

export type DayIntent = "air_conditioned" | "run_around" | "further_afield";

export const DAY_INTENT_LABELS: Record<DayIntent, string> = {
  air_conditioned: "想待在有冷氣的地方",
  run_around: "想讓他跑一跑",
  further_afield: "想去遠一點的",
};

/** 「沒想法，你推薦吧」不是一個值，是不設定——所以這裡沒有它。 */
export const DAY_INTENT_CATEGORIES: Record<DayIntent, readonly Category[]> = {
  air_conditioned: ["library", "museum", "parenting_center", "mall_play_area"],
  run_around: ["park", "inclusive_playground", "indoor_playground"],
  /**
   * ⚠️ 這一組**目前資料庫裡一個都沒有**（2026-09-02 查證）。
   * 按了會沒東西可推。這不是實作問題是覆蓋率問題——
   * 覆蓋率診斷會繼續指著它，別為了讓這個選項「有反應」而放寬別的地方。
   */
  further_afield: ["beach", "farm", "trail"],
};

export function matchesDayIntent(category: Category, intent: DayIntent): boolean {
  return DAY_INTENT_CATEGORIES[intent].includes(category);
}

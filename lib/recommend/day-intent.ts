/**
 * 當日意圖的加分（ADR-0026）
 *
 * ## 為什麼是加分不是硬過濾
 *
 * 硬過濾的失敗模式很糟：雨天選「想讓他跑一跑」→ 戶外選項已被 rain 剔除
 * → 兩個條件相乘後**存活數為零** → 系統說「今天不要出門」。
 * 但使用者其實很樂意去親子館，只是早上按了那個鍵。
 *
 * **明確的意圖不該把系統逼進死路。** 加分保留了安全網，
 * 也符合憲法「偏好只能調整排序，永遠不能覆蓋硬過濾」。
 *
 * ## 為什麼加在加權總分之外
 *
 * WEIGHTS 的七個因子加起來是 1.0，塞第八個進去就得重新分配其餘七個——
 * 那會動到所有情境的排序，而這個功能只影響「使用者今天按了鍵」的那些次。
 * 所以它是總分之上的一個獨立加分項。
 *
 * ## 為什麼不受 §7.4 抑制
 *
 * §7.4 在受限情境把家庭偏好權重歸零，理由是**學來的**偏好會壓死室內選項，
 * 而雨天正是最需要它們的時候。
 *
 * 但當日意圖不是學來的，是**人在看得到今天天氣的情況下自己按的**。
 * 把它一起歸零，等於系統對使用者說「我知道你剛選了什麼，但我不理你」，
 * 而使用者不會知道發生了什麼事。
 *
 * ⚠️ **這一條最容易被日後「優化」掉。** 抑制機制是為慢變數設計的；
 * 把快變數也一起關掉是誤用。
 */

import { matchesDayIntent } from "@/lib/domain/day-intent";
import type { Place } from "@/lib/db/schema";
import type { RecommendContext } from "./types";
import { SCORING } from "./weights";

export function dayIntentBonus(place: Place, context: RecommendContext): number {
  const intent = context.contextOverride?.dayIntent;
  if (!intent) return 0;
  return matchesDayIntent(place.category, intent) ? SCORING.dayIntent.bonus : 0;
}

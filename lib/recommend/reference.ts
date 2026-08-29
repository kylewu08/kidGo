/**
 * 參考欄：一個「今天不行，改天可以」的地點（ADR-0021）
 *
 * §7.3 規定輸出固定三項。這一項**不是第四個推薦**——它不參與排序、
 * 不進入槽位、必須連同被剔除的理由一起呈現。它回答的是另一個問題：
 * 「有沒有什麼好地方，只是今天的條件不對？」
 *
 * **這是硬過濾的唯一出口，所以出口必須很窄。**
 * 只有取決於**當日條件**的剔除理由能進來；取決於地點與小孩固有屬性的不行。
 * 否則它會變成繞過 Stage 1 的後門，而 Stage 1 擋掉的東西裡
 * 有「緊鄰車道」「有遊具但不適齡」這種不該以任何形式出現的地方。
 */

import type { FilterResult, RejectionReason } from "./types";
import type { Category } from "@/lib/db/schema";

/**
 * 可以進參考欄的剔除理由。
 *
 * 判準是「明天會不會不一樣」：
 * - `heat` / `rain`：天氣，改天就變了
 * - `not_enough_time`：今天的可用時間窗不夠，換個時段就行
 *
 * 刻意排除的：
 * - `age_out_of_range` / `facility_age_mismatch`：要等小孩長大，不是「改天」
 * - `unsafe_for_toddler`：緊鄰車道或開放水域。**這種地方不該被看到**
 * - `stroller_unfriendly` / `parent_effort_too_high`：這個家庭的固有條件
 * - `drive_too_long`：距離不會因為換一天而變近
 */
export const TRANSIENT_REJECTIONS: readonly RejectionReason[] = [
  "heat",
  "rain",
  "not_enough_time",
] as const;

export interface ReferenceNote {
  result: FilterResult;
  /** 呈現時**必須**一併顯示，否則它會被讀成推薦 */
  rejectedBy: RejectionReason;
}

/**
 * 從被剔除的地點裡挑一個當參考。
 *
 * 優先挑三個槽位沒用到的類別——參考欄的用處是讓人知道有這個地方存在，
 * 推一個跟主建議同類別的沒有增加任何資訊。
 * 同類別內取車程最近的：那是最可能真的改天會去的。
 */
export function pickReferenceNote(
  rejected: readonly FilterResult[],
  usedCategories: readonly Category[],
): ReferenceNote | null {
  const eligible = rejected.filter(
    (r) => r.rejectedBy !== undefined && TRANSIENT_REJECTIONS.includes(r.rejectedBy),
  );
  if (eligible.length === 0) return null;

  const fresh = eligible.filter((r) => !usedCategories.includes(r.place.category));
  const pool = fresh.length > 0 ? fresh : eligible;

  const nearest = pool.reduce((best, r) =>
    r.drive.outboundMinutes < best.drive.outboundMinutes ? r : best,
  );
  return { result: nearest, rejectedBy: nearest.rejectedBy! };
}

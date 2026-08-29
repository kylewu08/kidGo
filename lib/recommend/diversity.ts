/**
 * Stage 3 — 多樣性調整（設計架構書 v1.0 §7.3、§7.4）
 *
 * 輸出固定三項：主建議、備案、探索槽。**前三名不得為同一類別。**
 *
 * 這一階段在 v0.2 排在 Phase 2，v1.0 把它提前到 Phase 1——
 * 因為 §7.4 的防同溫層機制不是錦上添花，它是產品在雨天還能用的原因。
 */

import type { Category } from "@/lib/db/schema";
import { DIVERSITY, SCORING } from "./weights";
import type { Recommendation, RecommendContext, SlotKind } from "./types";

/** 室內或有頂戶外都能應付天氣突變 */
export function isWeatherProof(r: Recommendation): boolean {
  return r.place.indoorType === "indoor" || r.place.indoorType === "covered_outdoor";
}

/**
 * 這個類別對這個家庭而言是「偏好之外」的嗎？
 *
 * §7.4 防線二：**探索槽優先分配給偏好之外的類別**，
 * 而非單純選最新鮮的地點。兩者的差別很重要——
 * 選最新鮮只會在你已經偏好的類別裡輪流，同溫層不會被打破。
 */
function preferenceWeightOf(category: Category, context: RecommendContext): number {
  const pref = context.categoryPreferences.find((c) => c.category === category);
  if (!pref) return 0;
  if (pref.manualWeight !== null) return pref.manualWeight;
  return pref.sampleCount >= SCORING.familyPreference.minSampleCount
    ? pref.learnedWeight
    : 0;
}

/**
 * 依 §7.3 從評分結果挑出三項。
 *
 * 輸入必須已依分數由高到低排序。
 */
export function applyStage3(
  scored: Recommendation[],
  context: RecommendContext,
): Recommendation[] {
  if (scored.length === 0) return [];

  const chosen: { rec: Recommendation; slot: SlotKind }[] = [];
  const usedCategories = new Set<Category>();
  const usedIds = new Set<string>();

  const take = (rec: Recommendation, slot: SlotKind) => {
    chosen.push({ rec, slot });
    usedCategories.add(rec.place.category);
    usedIds.add(rec.place.id);
  };

  const available = (r: Recommendation) =>
    !usedIds.has(r.place.id) && !usedCategories.has(r.place.category);

  // --- 1. 主建議：綜合分數最高 --------------------------------------------
  take(scored[0], "primary");

  // --- 2. 備案：至少一個室內選項，供天氣突變 -------------------------------
  // 找不到室內的話退而求其次取次高分——備案的存在比它是不是室內更重要，
  // 但要在理由裡誠實說明它不是天氣備案。
  const backup =
    scored.find((r) => available(r) && isWeatherProof(r)) ??
    scored.find((r) => available(r));
  if (backup) take(backup, "backup");

  // --- 3. 探索槽：優先分配給偏好之外的類別（§7.4 防線二）-------------------
  //
  // 分數門檻的用意：太低會推出明顯不合適的地點，太高又會讓探索槽退化成
  // 「第三名」，失去防同溫層的作用。
  const floor = scored[0].score * DIVERSITY.exploreMinScoreRatio;
  const candidates = scored.filter((r) => available(r) && r.score >= floor);

  // 在符合門檻的候選裡，挑偏好權重最低的類別——那正是長期被壓低、
  // 資料停留在先驗值而未被驗證的那一群。
  const explore = candidates.reduce<Recommendation | null>((best, r) => {
    if (best === null) return r;
    const wr = preferenceWeightOf(r.place.category, context);
    const wb = preferenceWeightOf(best.place.category, context);
    if (wr < wb) return r;
    // 權重相同時取分數高的（candidates 已排序，所以保留先出現的）
    return best;
  }, null);
  if (explore) take(explore, "explore");

  return chosen.map(({ rec, slot }) => ({ ...rec, slot }));
}

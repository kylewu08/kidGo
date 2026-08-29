/**
 * 精算名單：Stage 2 初評之後，要對哪幾個地點查即時路況
 * （設計架構書 v1.0 §7.1、§10.3；資料模型草案 §8）
 *
 * 流程是兩段式的：
 *
 *   Stage 1 粗篩（幾何估計）→ Stage 2 初評 → **取前 N 名** → 即時路況精算
 *                                              ↑ 這個檔案
 *
 * 這是**純函式**：它只決定「該查誰」，不查。查詢由呼叫端負責，
 * 因為 §13.2 第 1 條要求推薦引擎不呼叫網路。
 *
 * 為什麼這件事值得一個獨立模組而不是呼叫端 `slice(0, 8)`：
 * 名單的挑法直接決定 Routes API 額度花在哪裡，而挑錯的症狀很隱晦——
 * 額度照樣用完，推薦結果卻仍是估算值。實測踩過一次。
 */

import { isWeatherProof } from "./diversity";
import { THRESHOLDS } from "./thresholds";
import type { Recommendation } from "./types";

/**
 * 從已排序的評分結果挑出要精算的名單。
 *
 * 輸入必須已依分數由高到低排序。回傳同樣依分數排序。
 *
 * 前 N 名之中若已有足夠的室內選項就原樣返回；否則從名單外分數最高的
 * 室內選項補進來，換掉名單內分數最低的戶外選項。
 */
export function selectPrecisionShortlist(
  scored: readonly Recommendation[],
): Recommendation[] {
  const size = THRESHOLDS.precisionShortlistSize;
  const head = scored.slice(0, size);

  const shortfall =
    THRESHOLDS.precisionReservedIndoorSlots - head.filter(isWeatherProof).length;
  if (shortfall <= 0) return head;

  const replacements = scored.slice(size).filter(isWeatherProof).slice(0, shortfall);
  if (replacements.length === 0) return head;

  const result = [...head];
  for (const replacement of replacements) {
    // 從尾端找分數最低的戶外項目換掉——犧牲最小的那一個。
    for (let i = result.length - 1; i >= 0; i -= 1) {
      if (!isWeatherProof(result[i])) {
        result[i] = replacement;
        break;
      }
    }
  }

  return result.sort((a, b) => b.score - a.score);
}

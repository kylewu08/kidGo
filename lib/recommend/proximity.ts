/**
 * 供給面診斷：住家半徑內到底有幾張牌可以打？
 *
 * `coverage.ts` 問的是「在最惡劣的情境下，還有沒有東西存活」——那是**過濾之後**
 * 的問題。這個檔案問的是它前面那一層：**還沒開始過濾之前，你家附近有什麼。**
 *
 * ## 為什麼需要它（2026-09-04 的實際觀察）
 *
 * 使用者連續三天、每兩三小時重新整理一次，換時段也換降雨機率，
 * 結果推薦「就是那兩三個都不會變」。
 *
 * 用引擎實測後，機制是這樣：**同類別內，七個評分因子有六個是常數。**
 * `freshness` 與 `history` 因為沒有造訪紀錄而全域相同、`familyPreference`
 * 的學習值因為 `category_preferences` 是空的而為零、其餘三個由類別先驗決定。
 * 唯一在區分地點的是車程（名義權重 10%），於是**每個類別永遠是離家最近的
 * 那一個勝出**，而且是確定性的。
 *
 * 但那只是機制。**真正的原因是供給**：那個類別在近距離內本來就只有一個候選。
 *
 * ## 這個指標與覆蓋率診斷量的不是同一件事
 *
 * ADR-0027 的停止條件是「類別 ≥ 3」，它量的是**類別多樣性**，
 * 而且在那個目的上是正確的。但它量不到兩件事：
 *
 * 1. 那些類別的地點**在不在你家附近**——資料庫有 684 座公園，
 *    但它們全部來自臺北市，對住新北的人來說隔著一條河
 * 2. 每個類別**有幾個候選**——只有一個的話，不管評分怎麼調都不會輪替
 *
 * 第 2 點是這個檔案最重要的輸出。**輪替的可能性等於同類別內的候選數**，
 * 這是資料的性質，不是演算法能補救的東西。
 */

import type { Category, Place } from "@/lib/db/schema";
import { baselineDriveMinutes } from "@/lib/domain/drive-estimate";

/**
 * 距離帶（分鐘）。用**基準車程**而非粗篩值——後者含日型係數，
 * 會讓同一批資料在平日與連假得到不同的診斷結果，而供給面不該隨日期變動。
 *
 * 選這四個值的理由：10 分鐘是「臨時起意也願意去」，45 分鐘是家庭偏好的
 * 常見上限。中間兩個用來看衰減——若 10 分鐘內只有 2 個而 45 分鐘內有 80 個，
 * 那是「東西都在遠處」，與「東西很少」是完全不同的問題，解法也不同。
 */
export const PROXIMITY_BANDS = [10, 20, 30, 45] as const;

/**
 * 供給面的達標條件。
 *
 * `minCategories` 與 §7.3「前三名不得為同一類別」對齊，和覆蓋率診斷同一個 3。
 *
 * `minPerCategory` 是這裡獨有的，而且是 2 不是 1：**只有一個候選的類別，
 * 那一格永遠是同一個地點。** 2 是「至少有得換」的最低標準，不是舒適值。
 */
export const PROXIMITY_TARGET = {
  minCategories: 3,
  minPerCategory: 2,
} as const;

export interface CategorySupply {
  category: Category;
  count: number;
  /** 這個類別在這一帶內能不能輪替（count >= minPerCategory） */
  canRotate: boolean;
}

export interface ProximityBand {
  /** 這一帶的上限（基準車程分鐘） */
  maxDriveMinutes: number;
  total: number;
  categories: CategorySupply[];
  /** 有候選的類別數 */
  categoryCount: number;
  /** 類別數達標，且**每個類別都輪替得動** */
  meetsTarget: boolean;
}

export interface ProximityDiagnosis {
  bands: ProximityBand[];
  /**
   * 家庭實際設定的車程上限那一圈——引擎真正看得到的範圍。
   * 與 `bands` 分開，因為使用者的設定不一定落在四個固定值上。
   */
  withinFamilyLimit: ProximityBand;
  /**
   * 只有一個候選的類別（取 `withinFamilyLimit`）。
   * 這些就是「永遠推薦同一個地點」的那些格子。
   */
  singletons: Category[];
}

function bandOf(
  places: readonly Place[],
  home: { lat: number; lng: number },
  maxDriveMinutes: number,
): ProximityBand {
  const within = places.filter(
    (p) => baselineDriveMinutes(home, p) <= maxDriveMinutes,
  );

  const counts = new Map<Category, number>();
  for (const p of within) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);

  const categories: CategorySupply[] = [...counts.entries()]
    .map(([category, count]) => ({
      category,
      count,
      canRotate: count >= PROXIMITY_TARGET.minPerCategory,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    maxDriveMinutes,
    total: within.length,
    categories,
    categoryCount: categories.length,
    // 兩個條件都要成立。只看類別數會漏掉「三個類別但每個都只有一個」——
    // 那正是使用者遇到的情況，而它在類別數上看起來是達標的。
    meetsTarget:
      categories.length >= PROXIMITY_TARGET.minCategories &&
      categories.every((c) => c.canRotate),
  };
}

/**
 * 診斷住家周邊的供給。
 *
 * `places` 應先經 `importedOnly()` 過濾（ADR-0024：手動地點不該讓診斷變綠）。
 * 這裡不自己呼叫它，是為了讓呼叫端明確做出那個選擇——診斷函式安靜地
 * 丟掉一部分輸入，是很難察覺的行為。
 */
export function diagnoseProximity(
  places: readonly Place[],
  home: { lat: number; lng: number },
  familyMaxDriveMinutes: number,
): ProximityDiagnosis {
  const withinFamilyLimit = bandOf(places, home, familyMaxDriveMinutes);

  return {
    bands: PROXIMITY_BANDS.map((m) => bandOf(places, home, m)),
    withinFamilyLimit,
    singletons: withinFamilyLimit.categories
      .filter((c) => !c.canRotate)
      .map((c) => c.category),
  };
}

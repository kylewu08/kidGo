/**
 * 從來源欄位推導決策欄位的規則（ADR-0019）
 *
 * 這是決策邏輯（P7），不是解析程式碼：這裡的每一個門檻與每一條對照
 * 都會直接改變硬過濾與評分的結果，所以**集中在這個檔案**（§13.2.10），
 * 不散在各個 adapter 裡，而且每一條都有對應測試。
 *
 * 與 `category-priors.ts` 的分工：先驗值是「這個類別大概如何」，
 * 這裡是「這一筆實際如何」。這裡推導出來的值會覆蓋先驗值，
 * 並在 `fieldSources` 標記為非 `category_prior`。
 */

import type { AgeBand, Level0to3 } from "@/lib/db/schema";

/**
 * 遊具名稱 → 適齡層。
 *
 * **刻意放寬**（使用者於 2026-08-28 決定）。理由：§13.2.4 規定適齡判斷
 * 在硬過濾階段，**剔除是不可逆的**——放窄會讓合適的地點永遠不出現，
 * 而放寬造成的誤入會被造訪回饋修正（P5）。兩種錯誤的代價不對稱。
 *
 * 比對方式是**子字串聯集**：一筆遊具可能命中多條規則，取聯集而非首條。
 * 這也是「放寬」的一部分——「共融式組合遊具-愛的搖籃」同時命中
 * 「組合遊具」與「搖籃」時，兩者的年齡層都算數。
 *
 * 詞彙取自臺北市公園基本資料還原後的 212 種遊具名稱。
 */
export const AGE_BANDS_BY_EQUIPMENT: readonly {
  readonly keywords: readonly string[];
  readonly bands: readonly AgeBand[];
}[] = [
  {
    // 低重心、不需自行攀爬或坐穩
    keywords: ["搖搖馬", "搖搖樂", "搖滾盤", "沙坑", "戲沙", "爬管", "尿布鞦韆", "搖籃", "小石搬運"],
    bands: ["infant", "toddler"],
  },
  {
    // 需要坐穩，但不需上肢力量
    keywords: ["鞦韆", "翹翹板", "蹺蹺板", "滑梯", "溜滑梯", "遊戲板", "旋轉", "搖晃", "搖動", "跳格子", "傳聲筒", "遊戲牆", "小屋"],
    bands: ["toddler", "preschool"],
  },
  {
    // 多段式綜合遊具，各年齡都有可玩處
    keywords: ["組合遊具", "遊具組", "攀爬組", "彈跳床", "平衡木", "跳樁", "木樁", "隧道", "山丘", "獨木橋", "吊床", "遊戲組"],
    bands: ["toddler", "preschool", "school_age"],
  },
  {
    // 需上肢力量與風險判斷
    keywords: ["攀岩", "monkey bar", "滑索", "溜索", "跑酷", "攀爬網", "爬網", "爬繩", "攀爬架", "天梯", "競技", "滑軌"],
    bands: ["preschool", "school_age"],
  },
] as const;

const BAND_ORDER: readonly AgeBand[] = ["infant", "toddler", "preschool", "school_age"];

/**
 * 由遊具清單推導適齡層。
 *
 * 回傳 `null` 代表**推不出來**（沒有任何遊具命中規則），
 * 此時該欄位留給類別先驗值處理——推不出來與「確認無遊具」是不同的事，
 * 不可混為一談。
 */
export function ageBandsFromEquipment(equipment: readonly string[]): AgeBand[] | null {
  const bands = new Set<AgeBand>();
  for (const item of equipment) {
    const normalized = item.toLowerCase();
    for (const rule of AGE_BANDS_BY_EQUIPMENT) {
      if (rule.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
        for (const band of rule.bands) bands.add(band);
      }
    }
  }
  if (bands.size === 0) return null;
  return BAND_ORDER.filter((band) => bands.has(band));
}

/**
 * 場地面積（m²）→ 可奔跑空間 0–3。
 *
 * 門檻取自臺北市 814 座公園的面積分布（中位數 2313、上四分位 6558）。
 * 用**公園面積**而非遊戲場面積：`runnableSpace` 問的是「能否自由跑動」，
 * 那是整個場地的事，不是遊具佔地的事。
 *
 * 注意這條推導多半會**調低**分數：`category-priors.ts` 給 park 與
 * inclusive_playground 的先驗值都是 3，而依面積只有約四分之一到得了 3。
 * 這正是它的用處——先驗值分不出來的，面積分得出來。
 */
export const RUNNABLE_SPACE_AREA_THRESHOLDS = {
  /** 低於此面積視為跑不太開的社區小綠地 */
  crampedBelowSqm: 1000,
  /** 達到此面積視為可自由奔跑 */
  spaciousAtLeastSqm: 5000,
} as const;

export function runnableSpaceFromAreaSqm(areaSqm: number): Level0to3 | null {
  if (!Number.isFinite(areaSqm) || areaSqm <= 0) return null;
  if (areaSqm >= RUNNABLE_SPACE_AREA_THRESHOLDS.spaciousAtLeastSqm) return 3;
  if (areaSqm >= RUNNABLE_SPACE_AREA_THRESHOLDS.crampedBelowSqm) return 2;
  return 1;
}

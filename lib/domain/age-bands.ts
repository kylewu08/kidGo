/**
 * 年齡層與月齡的對應（設計架構書 v1.0 §6.2 設施適齡層）
 *
 * v1.0 用「嬰兒／學步兒／學齡前／學齡」描述遊具的適用對象，
 * 但推薦時手上的是月齡。這個檔案是兩者之間的翻譯。
 *
 * ⚠️ 這是**領域判斷**，不是技術參數。§11 說「實作者不應自行推導或更改」。
 * 要改請走 ADR。
 */

import type { AgeBand } from "@/lib/db/schema";

/** 各年齡層涵蓋的月齡，前閉後開 [min, max) */
export const AGE_BAND_MONTHS: Record<AgeBand, { min: number; max: number }> = {
  infant: { min: 0, max: 12 },
  toddler: { min: 12, max: 36 },
  preschool: { min: 36, max: 72 },
  school_age: { min: 72, max: 144 },
};

export const AGE_BAND_LABELS: Record<AgeBand, string> = {
  infant: "嬰兒",
  toddler: "學步兒",
  preschool: "學齡前",
  school_age: "學齡",
};

/** 某個月齡屬於哪個年齡層。超出上限回傳 school_age。 */
export function ageBandOf(months: number): AgeBand {
  for (const band of ["infant", "toddler", "preschool"] as const) {
    if (months < AGE_BAND_MONTHS[band].max) return band;
  }
  return "school_age";
}

/**
 * 遊具是否涵蓋這個月齡。
 *
 * `facilityAgeBands` 為 null 代表**無遊具設施**，此時回傳 false——
 * 但那不代表地點不適合，§7.1 的規則是「有設施但不含小孩年齡層，
 * **且無可奔跑空間可替代**」才剔除。判斷可跑空間的責任在 filters.ts。
 */
export function facilityCoversAge(
  facilityAgeBands: AgeBand[] | null,
  months: number,
): boolean {
  if (facilityAgeBands === null) return false;
  return facilityAgeBands.includes(ageBandOf(months));
}

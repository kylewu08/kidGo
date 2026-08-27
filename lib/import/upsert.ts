/**
 * 匯入的 upsert 規則（docs/資料模型草案.md §7）
 *
 * 草案自己說這是「最容易出錯的一塊」，理由值得抄在這裡：
 *
 * > 匯入是**冪等**的：同樣的來源資料跑兩次，結果必須完全相同。
 * > 這需要測試守著，因為它壞掉的方式很安靜——你要等到某天發現
 * > 自己改過的值不見了。
 *
 * 所以這個檔案裡**決策的部分是純函式**（`planUpsert`），不碰資料庫。
 * 資料庫存取薄薄一層包在外面，讓「什麼情況下可以覆蓋」這件事
 * 能夠被完整測試而不需要建一個資料庫。
 */

import type { FieldSource, Place } from "@/lib/db/schema";
import { CATEGORY_PRIORS } from "@/lib/domain/category-priors";

import type { ObservedFieldName, SourceRecord } from "./types";

/**
 * 來源的強度順序。**匯入器只動得了前兩級。**
 *
 * `visit_corrected` 排在 `ai_suggested` 之上，因為紀錄是實際發生過的事；
 * `manual` 最高，因為那是人看著現場填的。
 */
const SOURCE_RANK: Record<FieldSource, number> = {
  category_prior: 0,
  source_data: 1,
  ai_suggested: 2,
  visit_corrected: 3,
  manual: 4,
};

/** 匯入器動得了的最高強度。超過這一級的欄位一律不碰。 */
const IMPORTER_MAY_OVERWRITE_UP_TO = SOURCE_RANK.source_data;

/** `places` 表中由類別先驗或來源實值決定的欄位。 */
const DERIVED_FIELDS = [
  "energyBurn",
  "typicalDurationMinutes",
  "indoorType",
  "strollerFriendly",
  "runnableSpace",
  "parentEffort",
  "hasAirConditioning",
  "safetyEnclosure",
  "facilityAgeBands",
  "suitableAgeMonths",
  "shadeLevel",
  "parkingSearchMinutes",
] as const;

type DerivedField = (typeof DERIVED_FIELDS)[number];

export type ExistingPlace = Pick<Place, "id" | "fieldSources"> &
  Partial<Pick<Place, DerivedField>>;

export interface UpsertPlan {
  action: "create" | "update";
  /** 要寫入的欄位值。update 時只含真的要改的欄位。 */
  values: Partial<Record<DerivedField, unknown>>;
  /** 寫入後的完整 fieldSources */
  fieldSources: Partial<Record<string, FieldSource>>;
  /** 因為已被人或紀錄確認過而**沒有**被覆蓋的欄位，供匯入報告使用 */
  protectedFields: DerivedField[];
}

/**
 * 這一筆的每個欄位該用什麼值、標什麼來源。
 *
 * 先驗值不會覆蓋曾經讀到的實值：來源哪天拿掉了某個欄位，
 * 舊的實值雖然可能過時，仍然比一個查表值準。
 */
export function planUpsert(
  existing: ExistingPlace | null,
  record: SourceRecord,
): UpsertPlan {
  const prior = CATEGORY_PRIORS[record.category];
  const existingSources = existing?.fieldSources ?? {};

  const values: Partial<Record<DerivedField, unknown>> = {};
  const fieldSources: Partial<Record<string, FieldSource>> = { ...existingSources };
  const protectedFields: DerivedField[] = [];

  for (const field of DERIVED_FIELDS) {
    const observedValue = record.observed[field as ObservedFieldName];
    const isObserved = observedValue !== undefined;

    const incomingSource: FieldSource = isObserved ? "source_data" : "category_prior";
    const incomingValue = isObserved ? observedValue : prior[field as keyof typeof prior];

    const existingSource = existingSources[field];
    if (existingSource !== undefined) {
      const existingRank = SOURCE_RANK[existingSource];
      // 人、AI 或造訪紀錄確認過的欄位，匯入器一律不碰。
      if (existingRank > IMPORTER_MAY_OVERWRITE_UP_TO) {
        protectedFields.push(field);
        continue;
      }
      // 先驗值不得覆蓋曾經讀到的實值。
      if (SOURCE_RANK[incomingSource] < existingRank) {
        protectedFields.push(field);
        continue;
      }
    }

    values[field] = incomingValue;
    fieldSources[field] = incomingSource;
  }

  return {
    action: existing ? "update" : "create",
    values,
    fieldSources,
    protectedFields,
  };
}

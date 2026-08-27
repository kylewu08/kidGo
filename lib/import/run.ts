/**
 * 匯入的執行層：把 SourceRecord 落地到資料庫。
 *
 * 決策（哪些欄位可以覆蓋、值是什麼）全在 `upsert.ts` 的純函式裡；
 * 這裡只負責讀寫與統計，因此本檔案沒有測試——**要測的東西不在這裡**。
 */

import type { NewPlace, SourceDataset } from "@/lib/db/schema";
import {
  clearSourceRemovedFlag,
  createPlace,
  findPlaceBySource,
  markPlacesRemovedFromSource,
  updatePlaceFields,
} from "@/lib/db/queries";

import { admit } from "./admission";
import type { SourceRecord } from "./types";
import { planUpsert } from "./upsert";

export interface ImportReport {
  dataset: SourceDataset;
  /** 來源共幾筆（已扣掉 adapter 判定為不屬於任何領域類別的） */
  incoming: number;
  /** 入場測試擋下幾筆 */
  rejected: number;
  /** 沒有座標、待 geocode 而暫緩的筆數 */
  deferredNoCoordinates: number;
  created: number;
  updated: number;
  /** 因為已被人或紀錄確認過而未被覆蓋的欄位次數 */
  protectedFields: number;
  /** 標記為來源已移除（不刪除） */
  markedRemoved: number;
  /** 曾被標記移除、這次又回到來源裡 */
  restored: number;
}

export async function importRecords(
  dataset: SourceDataset,
  records: readonly SourceRecord[],
  now: () => string = () => new Date().toISOString(),
): Promise<ImportReport> {
  const report: ImportReport = {
    dataset,
    incoming: records.length,
    rejected: 0,
    deferredNoCoordinates: 0,
    created: 0,
    updated: 0,
    protectedFields: 0,
    markedRemoved: 0,
    restored: 0,
  };

  const importedAt = now();
  const seenSourceIds: string[] = [];

  for (const record of records) {
    if (!admit(record).admitted) {
      report.rejected += 1;
      continue;
    }

    // 座標是硬需求：沒有座標就算不出車程，Stage 1 無從過濾。
    // 這些筆等 geocoding 那一步補上後再匯入，不是被拒絕。
    if (record.lat === null || record.lng === null) {
      report.deferredNoCoordinates += 1;
      continue;
    }

    seenSourceIds.push(record.sourceId);

    const existing = await findPlaceBySource(dataset, record.sourceId);
    const plan = planUpsert(existing, record);
    report.protectedFields += plan.protectedFields.length;

    const identity = {
      sourceDataset: dataset,
      sourceId: record.sourceId,
      name: record.name,
      address: record.address,
      lat: record.lat,
      lng: record.lng,
      category: record.category,
      importedAt,
      sourceUpdatedAt: record.sourceUpdatedAt ?? null,
      fieldSources: plan.fieldSources,
    };

    if (plan.action === "create") {
      await createPlace({ ...identity, ...plan.values } as Omit<NewPlace, "id">);
      report.created += 1;
    } else {
      await updatePlaceFields(existing!.id, { ...identity, ...plan.values } as Partial<NewPlace>);
      report.updated += 1;
    }
  }

  report.restored = await clearSourceRemovedFlag(dataset, seenSourceIds);
  report.markedRemoved = await markPlacesRemovedFromSource(dataset, seenSourceIds, importedAt);

  return report;
}

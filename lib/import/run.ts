/**
 * 匯入的執行層：把 SourceRecord 落地到資料庫。
 *
 * 決策（哪些欄位可以覆蓋、值是什麼）全在 `upsert.ts` 的純函式裡；
 * 這裡負責流程與統計，資料庫存取則走 `PlaceStore` 介面，
 * 因此整條落地流程可以用記憶體實作測到，不需要真的建一個資料庫。
 */

import type { NewPlace, SourceDataset } from "@/lib/db/schema";

import { admit } from "./admission";
import { EMPTY_GEOCODE_TABLE, type GeocodeTable } from "./geocode";
import type { PlaceStore } from "./store";
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
  /** 由 TGOS 結果檔補上座標的筆數 */
  geocoded: number;
  created: number;
  updated: number;
  /** 因為已被人或紀錄確認過而未被覆蓋的欄位次數 */
  protectedFields: number;
  /** 標記為來源已移除（不刪除） */
  markedRemoved: number;
  /** 曾被標記移除、這次又回到來源裡 */
  restored: number;
}

export interface ImportOptions {
  /** TGOS 批次比對的結果。來源沒有座標時用地址查這張表。 */
  geocode?: GeocodeTable;
  now?: () => string;
}

export async function importRecords(
  store: PlaceStore,
  dataset: SourceDataset,
  records: readonly SourceRecord[],
  options: ImportOptions = {},
): Promise<ImportReport> {
  const geocode = options.geocode ?? EMPTY_GEOCODE_TABLE;
  const now = options.now ?? (() => new Date().toISOString());
  const report: ImportReport = {
    dataset,
    incoming: records.length,
    rejected: 0,
    deferredNoCoordinates: 0,
    geocoded: 0,
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

    // 來源裡確實有這一筆，所以無論後面處不處理得了，都算「見過」——
    // 否則缺座標的筆數會被下面的移除掃描誤標為「來源不再包含」，
    // 而且每跑一次標記一次。
    seenSourceIds.push(record.sourceId);

    // 座標是硬需求：沒有座標就算不出車程，Stage 1 無從過濾。
    // 來源沒給的話先查 TGOS 結果檔；還是查不到就暫緩，不是被拒絕。
    let { lat, lng } = record;
    if (lat === null || lng === null) {
      const located = geocode.lookup(record.address);
      if (located) {
        lat = located.lat;
        lng = located.lng;
        report.geocoded += 1;
      } else {
        report.deferredNoCoordinates += 1;
        continue;
      }
    }

    const existing = await store.findBySource(dataset, record.sourceId);
    const plan = planUpsert(existing, record);
    report.protectedFields += plan.protectedFields.length;

    const identity = {
      sourceDataset: dataset,
      sourceId: record.sourceId,
      name: record.name,
      address: record.address,
      lat,
      lng,
      category: record.category,
      importedAt,
      sourceUpdatedAt: record.sourceUpdatedAt ?? null,
      fieldSources: plan.fieldSources,
    };

    if (plan.action === "create") {
      await store.create({ ...identity, ...plan.values } as Omit<NewPlace, "id">);
      report.created += 1;
    } else {
      await store.updateFields(existing!.id, { ...identity, ...plan.values } as Partial<NewPlace>);
      report.updated += 1;
    }
  }

  report.restored = await store.clearRemoved(dataset, seenSourceIds);
  report.markedRemoved = await store.markRemoved(dataset, seenSourceIds, importedAt);

  return report;
}

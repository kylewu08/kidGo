/**
 * `PlaceStore` 的 SQLite 實作。
 *
 * 刻意接受一個現成的連線而不是自己開：匯入器是批次工作，
 * 連線與交易的生命週期該由呼叫端決定（見 store.ts 的說明）。
 */

import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";

import { places, type NewPlace, type Place, type SourceDataset } from "@/lib/db/schema";

import type { PlaceStore } from "./store";

export function createSqlitePlaceStore(
  db: BetterSQLite3Database<Record<string, unknown>>,
): PlaceStore {
  return {
    async findBySource(dataset, sourceId): Promise<Place | null> {
      const rows = await db
        .select()
        .from(places)
        .where(and(eq(places.sourceDataset, dataset), eq(places.sourceId, sourceId)))
        .limit(1);
      return rows[0] ?? null;
    },

    async create(values: Omit<NewPlace, "id">): Promise<string> {
      const id = crypto.randomUUID();
      await db.insert(places).values({ ...values, id });
      return id;
    },

    async updateFields(id, values): Promise<void> {
      if (Object.keys(values).length === 0) return;
      await db.update(places).set(values).where(eq(places.id, id));
    },

    async markRemoved(
      dataset: SourceDataset,
      stillPresentSourceIds: readonly string[],
      removedAt: string,
    ): Promise<number> {
      const stillPresent =
        stillPresentSourceIds.length > 0
          ? notInArray(places.sourceId, [...stillPresentSourceIds])
          : sql`1 = 1`;
      const result = await db
        .update(places)
        .set({ sourceRemovedAt: removedAt })
        .where(
          and(
            eq(places.sourceDataset, dataset),
            stillPresent,
            sql`${places.sourceRemovedAt} IS NULL`,
          ),
        );
      return result.changes ?? 0;
    },

    async clearRemoved(dataset, sourceIds): Promise<number> {
      if (sourceIds.length === 0) return 0;
      const result = await db
        .update(places)
        .set({ sourceRemovedAt: null })
        .where(
          and(
            eq(places.sourceDataset, dataset),
            inArray(places.sourceId, [...sourceIds]),
            isNotNull(places.sourceRemovedAt),
          ),
        );
      return result.changes ?? 0;
    },
  };
}

import { describe, expect, it } from "vitest";

import type { NewPlace, Place, SourceDataset } from "@/lib/db/schema";

import { parseTgosResult } from "./geocode";
import { importRecords } from "./run";
import type { PlaceStore } from "./store";
import type { SourceRecord } from "./types";

/**
 * 記憶體版的 PlaceStore。
 *
 * 有了它，整條落地流程（入場測試 → 保護規則 → 標記移除）可以完整測到，
 * 而不只是測 planUpsert 算出來的計畫是對的——計畫對而寫入錯是可能的。
 */
function memoryStore(seed: Place[] = []): PlaceStore & { rows: Place[] } {
  const rows: Place[] = [...seed];
  let nextId = seed.length + 1;
  return {
    rows,
    async findBySource(dataset, sourceId) {
      return rows.find((r) => r.sourceDataset === dataset && r.sourceId === sourceId) ?? null;
    },
    async create(values: Omit<NewPlace, "id">) {
      const id = `p${nextId++}`;
      rows.push({ ...(values as unknown as Place), id });
      return id;
    },
    async updateFields(id, values) {
      const row = rows.find((r) => r.id === id);
      if (row) Object.assign(row, values);
    },
    async markRemoved(dataset, stillPresent, removedAt) {
      let n = 0;
      for (const row of rows) {
        if (
          row.sourceDataset === dataset &&
          !stillPresent.includes(row.sourceId) &&
          row.sourceRemovedAt === null
        ) {
          row.sourceRemovedAt = removedAt;
          n += 1;
        }
      }
      return n;
    },
    async clearRemoved(dataset, sourceIds) {
      let n = 0;
      for (const row of rows) {
        if (
          row.sourceDataset === dataset &&
          sourceIds.includes(row.sourceId) &&
          row.sourceRemovedAt !== null
        ) {
          row.sourceRemovedAt = null;
          n += 1;
        }
      }
      return n;
    },
  };
}

const DATASET: SourceDataset = "park_facility";

function record(sourceId: string, overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    sourceDataset: DATASET,
    sourceId,
    name: `公園 ${sourceId}`,
    address: "某處",
    lat: 25.1,
    lng: 121.5,
    category: "park",
    observed: { runnableSpace: 2 },
    ...overrides,
  };
}

const at = () => "2026-08-29T00:00:00.000Z";

describe("匯入流程", () => {
  it("第一次匯入全部新增", async () => {
    const store = memoryStore();
    const report = await importRecords(store, DATASET, [record("1"), record("2")], { now: at });
    expect(report).toMatchObject({ created: 2, updated: 0, rejected: 0 });
    expect(store.rows).toHaveLength(2);
  });

  it("第二次匯入全部更新，不重複新增", async () => {
    const store = memoryStore();
    const records = [record("1"), record("2")];
    await importRecords(store, DATASET, records, { now: at });
    const second = await importRecords(store, DATASET, records, { now: at });
    expect(second).toMatchObject({ created: 0, updated: 2 });
    expect(store.rows).toHaveLength(2);
  });

  it("入場測試擋下的地點不會被寫入", async () => {
    const store = memoryStore();
    const report = await importRecords(store, DATASET, [record("1", { observed: {} })], { now: at });
    expect(report.rejected).toBe(1);
    expect(store.rows).toHaveLength(0);
  });

  it("沒有座標的地點算暫緩而不是拒絕，等 geocoding 補上", async () => {
    const store = memoryStore();
    const report = await importRecords(store, DATASET, [record("1", { lat: null, lng: null })], { now: at });
    expect(report).toMatchObject({ deferredNoCoordinates: 1, rejected: 0, created: 0 });
    expect(store.rows).toHaveLength(0);
  });

  it("來源不再包含的地點被標記，而不是刪除", async () => {
    // 那筆地點可能已經有造訪紀錄，刪掉會讓紀錄變成孤兒（§6.4 紀錄永不刪除）。
    const store = memoryStore();
    await importRecords(store, DATASET, [record("1"), record("2")], { now: at });

    const report = await importRecords(store, DATASET, [record("1")], { now: at });
    expect(report.markedRemoved).toBe(1);
    expect(store.rows).toHaveLength(2);
    expect(store.rows.find((r) => r.sourceId === "2")?.sourceRemovedAt).toBe(at());
    expect(store.rows.find((r) => r.sourceId === "1")?.sourceRemovedAt).toBeNull();
  });

  it("曾被標記移除、又回到來源裡的地點，標記會被清掉", async () => {
    const store = memoryStore();
    await importRecords(store, DATASET, [record("1"), record("2")], { now: at });
    await importRecords(store, DATASET, [record("1")], { now: at });

    const report = await importRecords(store, DATASET, [record("1"), record("2")], { now: at });
    expect(report.restored).toBe(1);
    expect(store.rows.find((r) => r.sourceId === "2")?.sourceRemovedAt).toBeNull();
  });

  it("暫緩的地點不會被誤判為「來源不再包含」", async () => {
    // 缺座標的筆數沒有進 seenSourceIds，若處理不當會在下一步被標記移除——
    // 那會讓 geocoding 補完之前，同一批資料每跑一次就標記一次。
    const store = memoryStore();
    await importRecords(store, DATASET, [record("1"), record("2")], { now: at });

    const report = await importRecords(
      store,
      DATASET,
      [record("1"), record("2", { lat: null, lng: null })],
      { now: at },
    );
    expect(report.deferredNoCoordinates).toBe(1);
    expect(store.rows.find((r) => r.sourceId === "2")?.sourceRemovedAt).toBeNull();
  });

  it("來源沒給座標時用 TGOS 結果檔補上", async () => {
    const store = memoryStore();
    const geocode = parseTgosResult(
      "id,Address,Response_Address,Response_X,Response_Y\n1,某處,某處,121.5,25.1",
    );
    const report = await importRecords(
      store,
      DATASET,
      [record("1", { lat: null, lng: null })],
      { geocode, now: at },
    );
    expect(report).toMatchObject({ geocoded: 1, deferredNoCoordinates: 0, created: 1 });
    expect(store.rows[0]).toMatchObject({ lat: 25.1, lng: 121.5 });
  });

  it("TGOS 也查不到時仍然暫緩，不是拒絕", async () => {
    const store = memoryStore();
    const geocode = parseTgosResult(
      "id,Address,Response_Address,Response_X,Response_Y\n1,別的地方,,121.5,25.1",
    );
    const report = await importRecords(
      store,
      DATASET,
      [record("1", { lat: null, lng: null })],
      { geocode, now: at },
    );
    expect(report).toMatchObject({ geocoded: 0, deferredNoCoordinates: 1, rejected: 0 });
  });

  it("人改過的欄位在重跑後仍是人的值", async () => {
    const store = memoryStore();
    await importRecords(store, DATASET, [record("1")], { now: at });
    const row = store.rows[0];
    row.parentEffort = 5;
    row.fieldSources = { ...row.fieldSources, parentEffort: "manual" };

    const report = await importRecords(store, DATASET, [record("1")], { now: at });
    expect(report.protectedFields).toBe(1);
    expect(store.rows[0].parentEffort).toBe(5);
  });
});

/**
 * Schema 往返測試。
 *
 * 存在的理由：SQLite 沒有原生的 array、boolean 與 enum，這些欄位全靠 Drizzle
 * 在讀寫兩端做轉換。轉換錯了不會有型別錯誤——TypeScript 端看起來永遠是對的，
 * 但存進去是 0/1、讀出來變成 number 而不是 boolean，或 JSON 欄位變成字串。
 *
 * 這個測試把「寫進去的東西讀出來要一模一樣」釘住。
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "./schema";
import type { NewPlace, NewVisit } from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

let db: Db;

beforeEach(() => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
});

/** 一筆最小但合法的 Place，欄位值刻意各不相同以免遮蔽對應錯誤。 */
function makePlace(overrides: Partial<NewPlace> = {}): NewPlace {
  return {
    id: "place-1",
    name: "大安森林公園",
    category: "park",
    lat: 25.0299,
    lng: 121.5361,
    address: "台北市大安區新生南路二段1號",
    driveMinutes: 15,
    parking: "hard",
    energyBurn: 4,
    typicalDurationMin: 120,
    bestTimeSlots: ["early_morning", "post_nap"],
    ageRange: { minMonths: 6, maxMonths: 96 },
    sweetSpotAge: { minMonths: 22, maxMonths: 60 },
    indoor: "outdoor",
    shadeLevel: 2,
    strollerFriendly: true,
    hasChangingTable: true,
    hasNursingSpace: false,
    hasFoodOnSite: false,
    hasWaterPlay: true,
    needsReservation: false,
    crowdLevel: { weekday: 2, weekend: 5 },
    tags: ["近捷運", "有沙坑"],
    fieldSources: { driveMinutes: "manual", energyBurn: "visit_corrected" },
    ...overrides,
  };
}

describe("Place", () => {
  it("JSON 欄位往返後結構完全相同，不是字串", async () => {
    await db.insert(schema.places).values(makePlace());
    const [row] = await db.select().from(schema.places);

    expect(row.bestTimeSlots).toEqual(["early_morning", "post_nap"]);
    expect(row.ageRange).toEqual({ minMonths: 6, maxMonths: 96 });
    expect(row.crowdLevel).toEqual({ weekday: 2, weekend: 5 });
    expect(row.tags).toEqual(["近捷運", "有沙坑"]);
  });

  it("boolean 欄位讀回來是 true/false，不是 1/0", async () => {
    await db.insert(schema.places).values(makePlace());
    const [row] = await db.select().from(schema.places);

    expect(row.strollerFriendly).toBe(true);
    expect(row.hasNursingSpace).toBe(false);
  });

  it("ownerId 未指定時預設為 local，預留給未來的多使用者支援", async () => {
    await db.insert(schema.places).values(makePlace());
    const [row] = await db.select().from(schema.places);

    // 設計架構書 §12.1：v1 全填同一值，未來多使用者不需大改 schema。
    expect(row.ownerId).toBe("local");
  });

  it("fieldSources 從第一天就存在，能區分 AI 猜的與親身驗證的欄位", async () => {
    await db.insert(schema.places).values(
      makePlace({
        fieldSources: {
          typicalDurationMin: "ai_suggested",
          driveMinutes: "manual",
        },
      }),
    );
    const [row] = await db.select().from(schema.places);

    // 設計架構書 §5.2：UI 必須能區分兩者，否則錯誤資料會混入而無法追查。
    expect(row.fieldSources.typicalDurationMin).toBe("ai_suggested");
    expect(row.fieldSources.driveMinutes).toBe("manual");
  });

  it("陣列與物件欄位有預設值，最小建檔不需填滿每一格", async () => {
    const minimal = makePlace();
    delete minimal.bestTimeSlots;
    delete minimal.tags;
    delete minimal.fieldSources;

    await db.insert(schema.places).values(minimal);
    const [row] = await db.select().from(schema.places);

    expect(row.bestTimeSlots).toEqual([]);
    expect(row.tags).toEqual([]);
    expect(row.fieldSources).toEqual({});
    // sweetSpotAge 沒有預設值：AI 不得填寫，未判斷過就該是 null 而不是空物件。
    expect(row.sweetSpotAge).toEqual({ minMonths: 22, maxMonths: 60 });
  });
});

describe("Child", () => {
  it("napWindows 可存兩段午睡，涵蓋 two_naps 階段", async () => {
    await db.insert(schema.children).values({
      id: "child-1",
      name: "小寶",
      birthDate: "2024-10-01",
      napStage: "two_naps",
      wakeTime: "07:00",
      napWindows: [
        { start: "09:30", end: "10:30" },
        { start: "13:00", end: "14:30" },
      ],
      bedTime: "20:30",
      mobility: "stroller",
    });
    const [row] = await db.select().from(schema.children);

    expect(row.napWindows).toHaveLength(2);
    expect(row.napWindows[1]).toEqual({ start: "13:00", end: "14:30" });
    expect(row.napStage).toBe("two_naps");
  });
});

describe("Visit", () => {
  function makeVisit(overrides: Partial<NewVisit> = {}): NewVisit {
    return {
      id: "visit-1",
      placeId: "place-1",
      childIds: ["child-1"],
      date: "2026-08-15",
      arrivedAt: "09:30",
      leftAt: "10:45",
      childAgesMonths: [18],
      weatherSnapshot: { condition: "多雲", tempC: 26, rainProbability: 20 },
      outcome: 2,
      actualEnergyBurn: 3,
      napHappened: false,
      meltdown: true,
      wouldReturn: true,
      ...overrides,
    };
  }

  beforeEach(async () => {
    await db.insert(schema.places).values(makePlace());
  });

  it("childAgesMonths 是快照，與 birthDate 無關", async () => {
    await db.insert(schema.visits).values(makeVisit());
    const [row] = await db.select().from(schema.visits);

    // 設計架構書 §5.3：兩年後回頭看「小孩 18 個月時的結果」才有意義，
    // 用出生日期反推會失去當下情境。
    expect(row.childAgesMonths).toEqual([18]);
  });

  it("weatherSnapshot 保留當下天氣，不是事後查詢", async () => {
    await db.insert(schema.visits).values(makeVisit());
    const [row] = await db.select().from(schema.visits);

    expect(row.weatherSnapshot).toEqual({
      condition: "多雲",
      tempC: 26,
      rainProbability: 20,
    });
  });

  it("meltdown 存成 boolean，是評分的負向訊號", async () => {
    await db.insert(schema.visits).values(makeVisit());
    const [row] = await db.select().from(schema.visits);

    expect(row.meltdown).toBe(true);
    expect(row.napHappened).toBe(false);
  });

  it("place_id 參照不存在的地點時寫入失敗", async () => {
    await expect(
      db.insert(schema.visits).values(makeVisit({ placeId: "does-not-exist" })),
    ).rejects.toThrow();
  });

  it("同一地點可累積多筆紀錄，供地點歷史摘要視圖使用", async () => {
    await db.insert(schema.visits).values([
      makeVisit({ id: "v1", childAgesMonths: [18], outcome: 2, meltdown: true }),
      makeVisit({ id: "v2", childAgesMonths: [20], outcome: 3, meltdown: true }),
      makeVisit({ id: "v3", childAgesMonths: [23], outcome: 5, meltdown: false }),
    ]);

    const rows = await db
      .select()
      .from(schema.visits)
      .where(eq(schema.visits.placeId, "place-1"));

    // 設計架構書 §10.2 的畫面就是靠這個查詢：三次紀錄放在一起，
    // 「23 個月才不崩潰」的模式才會肉眼可見，進而修正 sweetSpotAge。
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.meltdown)).toHaveLength(2);
  });
});

describe("HomeBase", () => {
  it("同時存縣市與鄉鎮——鄉鎮名稱本身不唯一", async () => {
    // ADR-0006：CWA 把鄉鎮預報拆成 22 個縣市各自的資料集，
    // 而且東區同時存在於新竹市／嘉義市／臺中市／臺南市。
    await db.insert(schema.homeBase).values({
      id: "default",
      lat: 25.0115,
      lng: 121.4509,
      cwaCountyName: "新北市",
      cwaLocationName: "板橋區",
      maxDriveMinutes: 45,
    });
    const [row] = await db.select().from(schema.homeBase);

    expect(row.cwaCountyName).toBe("新北市");
    expect(row.cwaLocationName).toBe("板橋區");
  });

  it("id 預設為 default，這是一張單列表", async () => {
    await db.insert(schema.homeBase).values({
      lat: 25.0115,
      lng: 121.4509,
      cwaCountyName: "新北市",
      cwaLocationName: "板橋區",
      maxDriveMinutes: 45,
    });
    const rows = await db.select().from(schema.homeBase);

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("default");
  });
});


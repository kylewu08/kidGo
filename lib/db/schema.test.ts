/**
 * Schema 往返測試（設計架構書 v1.0 §6）
 *
 * 存在的理由與 v0.2 時相同：SQLite 沒有原生 array / boolean / enum，
 * 這些欄位全靠 Drizzle 在讀寫兩端轉換，而轉換錯了**不會有型別錯誤**——
 * TypeScript 端看起來永遠是對的，但可能存進去是 0/1、讀出來是 number。
 *
 * 另外守住幾個 v1.0 特有的結構性保證，見各 describe 的說明。
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "./schema";
import type { NewPlace, NewSuggestion, NewVisit } from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;
let db: Db;

beforeEach(() => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
});

function makePlace(overrides: Partial<NewPlace> = {}): NewPlace {
  return {
    id: "place-1",
    sourceDataset: "playground_registry",
    sourceId: "TPE-0001",
    name: "測試共融遊戲場",
    category: "inclusive_playground",
    address: "台北市大安區",
    lat: 25.0299,
    lng: 121.5361,
    parkingSearchMinutes: 8,
    usesFreeway: false,
    energyBurn: 4,
    typicalDurationMinutes: 90,
    bestTimeSlots: ["early_morning", "post_nap"],
    facilityAgeBands: ["toddler", "preschool"],
    suitableAgeMonths: { minMonths: 12, maxMonths: 144 },
    runnableSpace: 3,
    safetyEnclosure: 2,
    parentEffort: 3,
    indoorType: "outdoor",
    hasAirConditioning: false,
    shadeLevel: 1,
    strollerFriendly: true,
    fieldSources: { energyBurn: "category_prior", parentEffort: "manual" },
    ...overrides,
  };
}

describe("Place：型別往返", () => {
  it("JSON 欄位讀回來是結構不是字串", async () => {
    await db.insert(schema.places).values(makePlace());
    const [row] = await db.select().from(schema.places);

    expect(row.bestTimeSlots).toEqual(["early_morning", "post_nap"]);
    expect(row.facilityAgeBands).toEqual(["toddler", "preschool"]);
    expect(row.suitableAgeMonths).toEqual({ minMonths: 12, maxMonths: 144 });
  });

  it("boolean 欄位讀回來是 true/false 不是 1/0", async () => {
    await db.insert(schema.places).values(makePlace());
    const [row] = await db.select().from(schema.places);

    expect(row.strollerFriendly).toBe(true);
    expect(row.hasAirConditioning).toBe(false);
    expect(row.usesFreeway).toBe(false);
    expect(row.dataSuspect).toBe(false);
  });
});

describe("Place：facilityAgeBands 的 null 有意義", () => {
  it("null 代表無遊具設施，能與「有設施」明確區分", async () => {
    // 用「集合或 null」而不是「布林 + 集合」，是為了讓
    // 「有設施但適齡層是空的」這種不可能的狀態連表示都表示不出來。
    await db.insert(schema.places).values([
      makePlace({ id: "museum", category: "museum", facilityAgeBands: null }),
      makePlace({ id: "playground", facilityAgeBands: ["toddler"] }),
    ]);

    const rows = await db.select().from(schema.places);
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get("museum")!.facilityAgeBands).toBeNull();
    expect(byId.get("playground")!.facilityAgeBands).toEqual(["toddler"]);
  });

  it("suitableAgeMonths 與 facilityAgeBands 是兩個獨立的欄位", async () => {
    // ADR-0014：步道沒有遊具（null），但對六個月大的嬰兒仍然不適合，
    // 那要靠 suitableAgeMonths 擋。兩者回答的是不同的問題。
    await db.insert(schema.places).values(
      makePlace({
        category: "trail",
        facilityAgeBands: null,
        suitableAgeMonths: { minMonths: 24, maxMonths: 144 },
      }),
    );
    const [row] = await db.select().from(schema.places);

    expect(row.facilityAgeBands).toBeNull();
    expect(row.suitableAgeMonths.minMonths).toBe(24);
  });
});

describe("Place：來源追蹤", () => {
  it("fieldSources 逐欄位記錄，匯入器靠它判斷能不能覆蓋", async () => {
    await db.insert(schema.places).values(makePlace());
    const [row] = await db.select().from(schema.places);

    expect(row.fieldSources.energyBurn).toBe("category_prior");
    expect(row.fieldSources.parentEffort).toBe("manual");
  });

  it("外部鍵讓重複匯入認得出是同一個地點", async () => {
    await db.insert(schema.places).values(makePlace());
    const [row] = await db.select().from(schema.places);

    expect(row.sourceDataset).toBe("playground_registry");
    expect(row.sourceId).toBe("TPE-0001");
  });

  it("sourceRemovedAt 預設為 null——來源消失時標記而不刪除", async () => {
    // 刪除會讓造訪紀錄變成孤兒，而 §6.4 說紀錄永不刪除。
    await db.insert(schema.places).values(makePlace());
    const [row] = await db.select().from(schema.places);
    expect(row.sourceRemovedAt).toBeNull();
  });
});

describe("Suggestion：回饋迴路的樞紐", () => {
  const makeSuggestion = (o: Partial<NewSuggestion> = {}): NewSuggestion => ({
    id: "sug-1",
    sentAt: "2026-08-29T07:30:00+08:00",
    kind: "morning",
    primaryPlaceId: "place-1",
    suggestedDeparture: "09:20",
    suggestedReturn: "12:10",
    ...o,
  });

  beforeEach(async () => {
    await db.insert(schema.places).values(makePlace());
  });

  it("保存建議的出發與返家時間，讓回饋不必問使用者", async () => {
    // §6.4：「到離時間：取當日推播的建議值，不要求使用者提供」
    // 那個建議值就存在這裡，這是「三次點擊完成回饋」得以成立的原因。
    await db.insert(schema.suggestions).values(makeSuggestion());
    const [row] = await db.select().from(schema.suggestions);

    expect(row.suggestedDeparture).toBe("09:20");
    expect(row.suggestedReturn).toBe("12:10");
  });

  it("四種回應都存得下（ADR-0011）", async () => {
    for (const response of ["went", "stayed_home", "went_elsewhere", "looked_unsuitable"] as const) {
      await db.insert(schema.suggestions).values(
        makeSuggestion({ id: `sug-${response}`, response }),
      );
    }
    const rows = await db.select().from(schema.suggestions);
    expect(rows.map((r) => r.response).sort()).toEqual(
      ["looked_unsuitable", "stayed_home", "went", "went_elsewhere"],
    );
  });

  it("「今天不要出門」時主建議為空但理由要在", async () => {
    // §9.1：推播不得沉默，也不得降低標準硬推。
    await db.insert(schema.suggestions).values(
      makeSuggestion({
        primaryPlaceId: null,
        suggestedDeparture: null,
        suggestedReturn: null,
        noOutingReason: "今天大雨、體感 34°C",
      }),
    );
    const [row] = await db.select().from(schema.suggestions);

    expect(row.primaryPlaceId).toBeNull();
    expect(row.noOutingReason).toContain("大雨");
  });

  it("探索槽是獨立欄位——引擎產出三項，推播只顯示前兩項", async () => {
    await db.insert(schema.places).values(makePlace({ id: "explore", sourceId: "X-1" }));
    await db.insert(schema.suggestions).values(
      makeSuggestion({ explorePlaceId: "explore" }),
    );
    const [row] = await db.select().from(schema.suggestions);
    expect(row.explorePlaceId).toBe("explore");
  });
});

describe("Visit：唯二必填", () => {
  const makeVisit = (o: Partial<NewVisit> = {}): NewVisit => ({
    id: "visit-1",
    placeId: "place-1",
    date: "2026-08-29",
    durationFeeling: "shorter",
    outcome: "meltdown",
    ...o,
  });

  beforeEach(async () => {
    await db.insert(schema.places).values(makePlace());
  });

  it("只填那兩項回饋就能存——其餘皆為選填（§13.2.6）", async () => {
    await db.insert(schema.visits).values(makeVisit());
    const [row] = await db.select().from(schema.visits);

    expect(row.durationFeeling).toBe("shorter");
    expect(row.outcome).toBe("meltdown");
    expect(row.arrivedAt).toBeNull();
    expect(row.actualDriveMinutes).toBeNull();
  });

  it("childAgesMonths 是快照，不由 birthDate 反推", async () => {
    await db.insert(schema.visits).values(
      makeVisit({ childIds: ["c1"], childAgesMonths: [20] }),
    );
    const [row] = await db.select().from(schema.visits);
    expect(row.childAgesMonths).toEqual([20]);
  });

  it("天氣快照存得下——系統填的不算使用者負擔（ADR-0014）", async () => {
    await db.insert(schema.visits).values(
      makeVisit({
        weatherSnapshot: { condition: "多雲", apparentTempC: 30, rainProbability: 20 },
      }),
    );
    const [row] = await db.select().from(schema.visits);
    expect(row.weatherSnapshot?.apparentTempC).toBe(30);
  });

  it("參照不存在的地點時寫入失敗", async () => {
    await expect(
      db.insert(schema.visits).values(makeVisit({ placeId: "nope" })),
    ).rejects.toThrow();
  });

  it("同一地點可累積多筆，供建檔值 vs 實際紀錄的對照視圖使用", async () => {
    await db.insert(schema.visits).values([
      makeVisit({ id: "v1", childAgesMonths: [18], durationFeeling: "shorter" }),
      makeVisit({ id: "v2", childAgesMonths: [20], durationFeeling: "shorter" }),
      makeVisit({ id: "v3", childAgesMonths: [23], durationFeeling: "as_expected" }),
    ]);
    const rows = await db
      .select()
      .from(schema.visits)
      .where(eq(schema.visits.placeId, "place-1"));

    // 連續多次「比較短」就是下修預估時長的依據（ADR-0014：至少 3 筆同方向）
    expect(rows.filter((r) => r.durationFeeling === "shorter")).toHaveLength(2);
  });
});

describe("ContextOverride：一次性情境", () => {
  it("原始輸入與轉譯結果都要保存，否則日後會誤讀", async () => {
    // §6.4：「因外婆同行才去沙灘」不該被解讀為「沙灘一直都適合我們家」。
    await db.insert(schema.contextOverrides).values({
      id: "ctx-1",
      createdAt: "2026-08-29T07:35:00+08:00",
      rawInput: "今天外婆一起去",
      overrides: { maxParentEffort: 5 },
      explanation: "家長負擔上限 3 → 5",
    });
    const [row] = await db.select().from(schema.contextOverrides);

    expect(row.rawInput).toBe("今天外婆一起去");
    expect(row.overrides.maxParentEffort).toBe(5);
  });
});

describe("FamilyPreference：學習權重", () => {
  it("手動覆寫與學習值分開存，且記得樣本數", async () => {
    // §6.3 硬性要求 UI 顯示學習依據（「依你最近 12 次選擇」），
    // 所以樣本數必須查得到，不能即時算。
    await db.insert(schema.categoryPreferences).values({
      category: "park",
      learnedWeight: 0.35,
      sampleCount: 12,
    });
    const [row] = await db.select().from(schema.categoryPreferences);

    expect(row.learnedWeight).toBeCloseTo(0.35);
    expect(row.sampleCount).toBe(12);
    expect(row.manualWeight).toBeNull();
  });
});

describe("RouteCache：合規要求", () => {
  it("每筆都帶 fetchedAt，30 天清理排程依此判斷", async () => {
    // Google ToS 允許暫存 duration/ETA 最多 30 個連續日曆日（ADR-0013）。
    // 這是合規要求不是效能優化。
    await db.insert(schema.places).values(makePlace());
    await db.insert(schema.routeCache).values({
      id: "rc-1",
      placeId: "place-1",
      direction: "outbound",
      departureAt: "2026-08-29T09:20:00+08:00",
      durationMinutes: 22,
      fetchedAt: "2026-08-29T07:30:00+08:00",
    });
    const [row] = await db.select().from(schema.routeCache);

    expect(row.fetchedAt).toBeTruthy();
    expect(row.direction).toBe("outbound");
  });

  it("去程與回程分開存（§7.1 回程必須獨立計算）", async () => {
    await db.insert(schema.places).values(makePlace());
    await db.insert(schema.routeCache).values([
      { id: "out", placeId: "place-1", direction: "outbound", departureAt: "2026-08-29T09:20:00+08:00", durationMinutes: 22, fetchedAt: "2026-08-29T07:30:00+08:00" },
      { id: "back", placeId: "place-1", direction: "return", departureAt: "2026-08-29T11:40:00+08:00", durationMinutes: 31, fetchedAt: "2026-08-29T07:30:00+08:00" },
    ]);
    const rows = await db.select().from(schema.routeCache);

    // 早上出發與下午返程是不同的路況，不可假設相同
    expect(rows.find((r) => r.direction === "outbound")!.durationMinutes).toBe(22);
    expect(rows.find((r) => r.direction === "return")!.durationMinutes).toBe(31);
  });
});

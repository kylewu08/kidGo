import { describe, expect, it } from "vitest";

import {
  COVERAGE_SCENARIOS,
  COVERAGE_TARGET,
  diagnoseCoverage,
  diagnoseScenario,
  importedOnly,
} from "../coverage";
import type { CoverageBaseline } from "../coverage";
import { CATEGORY_PRIORS } from "@/lib/domain/category-priors";
import type { Category, Child, FamilyPreference, Place } from "@/lib/db/schema";

/** 依類別先驗值造一個地點，只覆寫必要欄位。 */
function place(id: string, category: Category, overrides: Partial<Place> = {}): Place {
  const prior = CATEGORY_PRIORS[category];
  return {
    id,
    sourceDataset: "park_facility",
    sourceId: id,
    name: id,
    address: "",
    category,
    lat: 25.02,
    lng: 121.47,
    usesFreeway: false,
    bestTimeSlots: [],
    fieldSources: {},
    dataSuspect: false,
    ...prior,
    ...overrides,
  } as Place;
}

const child: Child = {
  id: "c1",
  name: "小孩",
  birthDate: "2024-12-19",
  napStage: "one_nap",
  wakeTime: "07:00",
  napWindows: [{ start: "13:00", end: "15:00" }],
  bedTime: "20:30",
  mobility: "walks_short",
  attentionSpanMinutes: null,
  notes: null,
};

const baseline: CoverageBaseline = {
  children: [child],
  home: { lat: 25.0118, lng: 121.4628 },
  maxDriveMinutes: 70,
  familyPreference: {
    id: "default",
    outdoorTendency: 0,
    maxParentEffort: 4,
    requiresMeal: false,
  } as FamilyPreference,
  date: new Date("2026-08-30T00:00:00"),
};

const heat = COVERAGE_SCENARIOS.find((s) => s.key === "extreme_heat")!;

describe("停止條件", () => {
  it("三個不同類別、且至少一個室內時達標", () => {
    const result = diagnoseScenario(
      [place("a", "library"), place("b", "museum"), place("c", "parenting_center")],
      baseline,
      heat,
    );
    expect(result.meetsTarget).toBe(true);
    expect(result.gap).toBeNull();
  });

  it("存活數很多但只有兩個類別時不算達標", () => {
    // 這條測試守的是需求補充 01 §B.2 的修正。原始需求寫「存活數 ≥ 3」，
    // 但 2026-08-29 實跑存活 632 個卻只填得滿兩個槽位——
    // §7.3 規定前三名不得為同一類別，量原始數字會量錯東西。
    const many = [
      ...Array.from({ length: 20 }, (_, i) => place(`lib${i}`, "library")),
      ...Array.from({ length: 20 }, (_, i) => place(`mus${i}`, "museum")),
    ];
    const result = diagnoseScenario(many, baseline, heat);
    expect(result.survivors).toBeGreaterThan(COVERAGE_TARGET.minSurvivors);
    expect(result.categories).toHaveLength(2);
    expect(result.meetsTarget).toBe(false);
  });

  it("三個類別但全是戶外時不算達標，備案槽位要室內", () => {
    const outdoorOnly = [
      place("a", "park"),
      place("b", "inclusive_playground"),
      place("c", "trail"),
    ];
    const result = diagnoseScenario(outdoorOnly, baseline, {
      ...heat,
      apparentTempC: 26,
      rainProbability: 10,
    });
    expect(result.weatherProofSurvivors).toBe(0);
    expect(result.meetsTarget).toBe(false);
  });
});

describe("缺口描述", () => {
  it("酷暑下戶外地點被剔除時，指出缺乏冷氣或遮蔭，並建議室內類別", () => {
    // §B.4：缺口描述必須指出缺乏的屬性組合，而非只說「數量不足」。
    const result = diagnoseScenario(
      [place("a", "park"), place("b", "inclusive_playground")],
      baseline,
      heat,
    );
    expect(result.meetsTarget).toBe(false);
    expect(result.dominantRejection?.reason).toBe("heat");
    expect(result.gap?.missing).toContain("冷氣");
    expect(result.gap?.suggest).toContain("museum");
  });

  it("車程過遠的缺口明講那是範圍問題，不建議補類別", () => {
    // 補再多同類別的地點也沒用——這種缺口該調的是車程上限或住家設定。
    const faraway = [place("a", "park", { lat: 23.0, lng: 120.2 })];
    const result = diagnoseScenario(faraway, baseline, heat);
    expect(result.dominantRejection?.reason).toBe("drive_too_long");
    expect(result.gap?.suggest).toEqual([]);
  });

  it("缺口看的是被整批消滅的類別，不是整體最大宗的剔除因子", () => {
    // 2026-08-29 實跑的教訓：整體最大宗永遠是 drive_too_long（全國 616 個
    // 圖書館大多超出車程），而它在每個情境都一樣多——不是情境特有的問題。
    // 情境特有的訊號是「這個情境害死了哪一個類別」。
    const corpus = [
      place("near1", "library"),
      place("near2", "museum"),
      // 共融遊戲場在酷暑下會被 heat 全滅
      place("near3", "inclusive_playground"),
      // 一大批超出車程的地點，讓 drive_too_long 成為整體最大宗
      ...Array.from({ length: 30 }, (_, i) => place(`far${i}`, "park", { lat: 23.0, lng: 120.2 })),
    ];
    const result = diagnoseScenario(corpus, baseline, heat);

    expect(result.rejectionBreakdown.drive_too_long).toBe(30);
    expect(result.wipedOutCategories).toContain("inclusive_playground");
    // 報的是害死共融遊戲場的 heat，不是數量最多的 drive_too_long
    expect(result.dominantRejection?.reason).toBe("heat");
    expect(result.gap?.missing).toContain("冷氣");
  });

  it("沒有室內選項時，缺口優先報室內，因為備案槽位填不了", () => {
    const outdoorOnly = [
      place("a", "park"),
      place("b", "inclusive_playground"),
      place("c", "trail"),
    ];
    const rain = COVERAGE_SCENARIOS.find((s) => s.key === "afternoon_storm")!;
    const result = diagnoseScenario(outdoorOnly, baseline, rain);
    expect(result.weatherProofSurvivors).toBe(0);
    expect(result.gap?.missing).toContain("室內");
  });

  it("達標時沒有缺口描述", () => {
    const result = diagnoseScenario(
      [place("a", "library"), place("b", "museum"), place("c", "parenting_center")],
      baseline,
      heat,
    );
    expect(result.gap).toBeNull();
  });
});

describe("情境", () => {
  it("五個情境都跑得出結果", () => {
    const results = diagnoseCoverage([place("a", "library")], baseline);
    expect(results).toHaveLength(5);
    expect(results.map((r) => r.scenario.key)).toEqual([
      "sunny_morning",
      "afternoon_storm",
      "extreme_heat",
      "long_holiday",
      "tired_parent",
    ]);
  });

  it("家長疲勞情境會剔除家長負擔高的地點", () => {
    const tired = COVERAGE_SCENARIOS.find((s) => s.key === "tired_parent")!;
    // 農場的先驗 parentEffort 是 4，超過上限 2。
    expect(CATEGORY_PRIORS.farm.parentEffort).toBeGreaterThan(tired.maxParentEffort!);
    const result = diagnoseScenario([place("a", "farm")], baseline, tired);
    expect(result.rejectionBreakdown.parent_effort_too_high).toBe(1);
  });

  it("酷暑情境用 38 度而不是需求原稿的 35 度", () => {
    // 情境訂得比實際溫和，最惡劣情境就沒有測到最惡劣的情況。
    // 2026-08-29 板橋實測體感 38°C。
    expect(heat.apparentTempC).toBe(38);
  });
});

describe("診斷只算匯入資料（ADR-0024）", () => {
  /**
   * 手動新增一旦能讓診斷變綠，覆蓋率就失去意義——使用者補幾個洞，
   * 數字好看了，但真正該補的資料來源一個都沒補。
   */
  it("手動新增的地點不列入存活數", () => {
    const imported = place("p1", "park");
    const manual = place("p2", "park", { sourceDataset: "manual" });

    const withManual = diagnoseCoverage([imported, manual], baseline);
    const withoutManual = diagnoseCoverage([imported], baseline);

    expect(withManual.map((r) => r.survivors)).toEqual(
      withoutManual.map((r) => r.survivors),
    );
  });

  it("importedOnly 過濾掉 manual，其餘保留", () => {
    const places = [
      place("a", "library"),
      place("b", "park", { sourceDataset: "manual" }),
      place("c", "parenting_center"),
    ];
    expect(importedOnly(places).map((p) => p.id)).toEqual(["a", "c"]);
  });
});

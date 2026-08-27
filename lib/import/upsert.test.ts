import { describe, expect, it } from "vitest";

import { CATEGORY_PRIORS } from "@/lib/domain/category-priors";

import { planUpsert, type ExistingPlace } from "./upsert";
import type { SourceRecord } from "./types";

function record(observed: SourceRecord["observed"] = {}): SourceRecord {
  return {
    sourceDataset: "park_facility",
    sourceId: "157",
    name: "七虎公園",
    address: "育仁路108號",
    lat: 25.136165,
    lng: 121.50155,
    category: "park",
    observed,
  };
}

function existing(fieldSources: ExistingPlace["fieldSources"]): ExistingPlace {
  return { id: "p1", fieldSources };
}

describe("新增", () => {
  it("沒有來源實值的欄位套類別先驗值", () => {
    const plan = planUpsert(null, record());
    expect(plan.action).toBe("create");
    expect(plan.values.energyBurn).toBe(CATEGORY_PRIORS.park.energyBurn);
    expect(plan.fieldSources.energyBurn).toBe("category_prior");
  });

  it("來源讀到的欄位標記 source_data，不是 category_prior", () => {
    // 標成 category_prior 的話，ADR-0014 的「時長自動修正只動先驗值」
    // 會誤改真實資料。
    const plan = planUpsert(null, record({ runnableSpace: 1 }));
    expect(plan.values.runnableSpace).toBe(1);
    expect(plan.fieldSources.runnableSpace).toBe("source_data");
  });

  it("來源實值覆蓋掉同名的類別先驗值", () => {
    // park 的先驗 runnableSpace 是 3；面積推導說這座只有 1。
    expect(CATEGORY_PRIORS.park.runnableSpace).toBe(3);
    expect(planUpsert(null, record({ runnableSpace: 1 })).values.runnableSpace).toBe(1);
  });
});

describe("重複匯入的保護規則（資料模型草案 §7）", () => {
  it("人手動填過的欄位不被覆蓋", () => {
    const plan = planUpsert(existing({ parentEffort: "manual" }), record());
    expect(plan.values.parentEffort).toBeUndefined();
    expect(plan.protectedFields).toContain("parentEffort");
    expect(plan.fieldSources.parentEffort).toBe("manual");
  });

  it("造訪紀錄修正過的欄位不被覆蓋", () => {
    const plan = planUpsert(
      existing({ typicalDurationMinutes: "visit_corrected" }),
      record({ typicalDurationMinutes: 240 }),
    );
    expect(plan.values.typicalDurationMinutes).toBeUndefined();
    expect(plan.protectedFields).toContain("typicalDurationMinutes");
  });

  it("AI 建議過的欄位不被覆蓋", () => {
    const plan = planUpsert(existing({ shadeLevel: "ai_suggested" }), record());
    expect(plan.protectedFields).toContain("shadeLevel");
  });

  it("先前是類別先驗的欄位可以被覆蓋", () => {
    const plan = planUpsert(existing({ runnableSpace: "category_prior" }), record({ runnableSpace: 2 }));
    expect(plan.values.runnableSpace).toBe(2);
    expect(plan.fieldSources.runnableSpace).toBe("source_data");
  });

  it("先前的來源實值可以被新的來源實值更新", () => {
    // 來源改版後面積變了，應該跟著更新。
    const plan = planUpsert(existing({ runnableSpace: "source_data" }), record({ runnableSpace: 3 }));
    expect(plan.values.runnableSpace).toBe(3);
  });

  it("類別先驗不得覆蓋曾經讀到的來源實值", () => {
    // 來源哪天拿掉了面積欄位，舊的實值雖然可能過時，
    // 仍然比一個查表值準——退回先驗是資訊的淨損失。
    const plan = planUpsert(existing({ runnableSpace: "source_data" }), record());
    expect(plan.values.runnableSpace).toBeUndefined();
    expect(plan.protectedFields).toContain("runnableSpace");
    expect(plan.fieldSources.runnableSpace).toBe("source_data");
  });
});

describe("冪等性", () => {
  it("同樣的來源資料跑兩次，第二次算出來的東西與第一次相同", () => {
    // 這是草案 §7 唯一明文要求測試的性質，因為它壞掉的方式很安靜：
    // 要等到某天發現自己改過的值不見了。
    const incoming = record({ runnableSpace: 2, facilityAgeBands: ["toddler"] });

    const first = planUpsert(null, incoming);
    const afterFirst = existing(first.fieldSources);
    const second = planUpsert(afterFirst, incoming);

    expect(second.values).toEqual(first.values);
    expect(second.fieldSources).toEqual(first.fieldSources);
    expect(second.protectedFields).toEqual([]);
  });

  it("跑第三次仍然相同", () => {
    const incoming = record({ runnableSpace: 2 });
    const first = planUpsert(null, incoming);
    const second = planUpsert(existing(first.fieldSources), incoming);
    const third = planUpsert(existing(second.fieldSources), incoming);
    expect(third.fieldSources).toEqual(first.fieldSources);
    expect(third.values).toEqual(first.values);
  });

  it("人改過一個欄位之後重跑，那個欄位仍然是人的值", () => {
    const incoming = record({ runnableSpace: 2 });
    const first = planUpsert(null, incoming);
    const humanEdited = existing({ ...first.fieldSources, parentEffort: "manual" });

    const second = planUpsert(humanEdited, incoming);
    const third = planUpsert(existing(second.fieldSources), incoming);

    expect(second.protectedFields).toEqual(["parentEffort"]);
    expect(third.protectedFields).toEqual(["parentEffort"]);
    expect(third.fieldSources.parentEffort).toBe("manual");
  });
});

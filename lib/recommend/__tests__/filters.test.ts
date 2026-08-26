/**
 * Stage 1 硬性過濾的規格（設計架構書 v1.0 §7.1）
 *
 * 這個檔案就是「L1 判斷力」那一層的規格書。每個測試名稱都是一句育兒常識，
 * 接手的人讀完就知道系統到底編碼了哪些判斷。
 */

import { describe, expect, it } from "vitest";

import { applyStage1 } from "../filters";
import { THRESHOLDS } from "../thresholds";
import type { Place } from "@/lib/db/schema";
import {
  makeChild,
  makeContext,
  makeFamilyPreference,
  makeForecast,
  makePlace,
} from "./fixtures";

function filterOne(place: Place, context = makeContext()) {
  return applyStage1([place], context)[0];
}

describe("車程與時間", () => {
  it("車程遠超過上限的地點被剔除", () => {
    // 花蓮，直線超過 100 km
    const result = filterOne(makePlace({ lat: 23.99, lng: 121.6 }));
    expect(result.passed).toBe(false);
    expect(result.rejectedBy).toBe("drive_too_long");
  });

  it("粗估時門檻放寬約 20%，避免粗估誤差誤殺", () => {
    // §7.1 明訂的緩衝。ADR-0014：這是整條管線唯一的誤差容忍度。
    const place = makePlace({ lat: 25.19, lng: 121.6 });
    const drive = filterOne(place).drive;

    const justInside = makeContext({ maxDriveMinutes: drive.outboundMinutes });
    const wouldFailWithoutSlack = makeContext({
      maxDriveMinutes: Math.floor(drive.outboundMinutes / THRESHOLDS.coarseDriveSlack) + 1,
    });
    expect(filterOne(place, justInside).rejectedBy).not.toBe("drive_too_long");
    expect(filterOne(place, wouldFailWithoutSlack).rejectedBy).not.toBe("drive_too_long");
  });

  it("精算車程時用實際上限，不再放寬", () => {
    const place = makePlace({ id: "p" });
    const context = makeContext({
      maxDriveMinutes: 20,
      preciseDrive: new Map([["p", { outboundMinutes: 25, returnMinutes: 25 }]]),
    });
    expect(filterOne(place, context).rejectedBy).toBe("drive_too_long");
  });

  it("可用時間必須容納「去程＋停留＋回程」三段", () => {
    // §7.1 明列三段。回程用它自己的值，不是假設等於去程。
    const place = makePlace({ id: "p", typicalDurationMinutes: 120 });
    const context = makeContext({
      availableWindow: { start: "09:00", end: "11:00" },
      preciseDrive: new Map([["p", { outboundMinutes: 20, returnMinutes: 40 }]]),
    });
    // 20 + 120 + 40 = 180 分，但只有 120 分可用
    expect(filterOne(place, context).rejectedBy).toBe("not_enough_time");
  });

  it("回程較長時可能剛好不夠——證明回程有被獨立計算", () => {
    const place = makePlace({ id: "p", typicalDurationMinutes: 60 });
    const window = { start: "09:00", end: "11:00" }; // 120 分

    const symmetric = makeContext({
      availableWindow: window,
      preciseDrive: new Map([["p", { outboundMinutes: 25, returnMinutes: 25 }]]),
    });
    const longerReturn = makeContext({
      availableWindow: window,
      preciseDrive: new Map([["p", { outboundMinutes: 25, returnMinutes: 45 }]]),
    });

    expect(filterOne(place, symmetric).passed).toBe(true); // 25+60+25 = 110
    expect(filterOne(place, longerReturn).rejectedBy).toBe("not_enough_time"); // 130
  });
});

describe("天氣", () => {
  it("降雨機率超過 60% 時，純戶外地點被剔除", () => {
    const result = filterOne(
      makePlace({ indoorType: "outdoor" }),
      makeContext({ weather: makeForecast({ rainProbability: 61 }) }),
    );
    expect(result.rejectedBy).toBe("rain");
  });

  it("降雨機率剛好 60% 時不剔除——門檻是「超過」不是「達到」", () => {
    const result = filterOne(
      makePlace({ indoorType: "outdoor" }),
      makeContext({
        weather: makeForecast({
          rainProbability: THRESHOLDS.rainProbabilityExcludeOutdoor,
        }),
      }),
    );
    expect(result.passed).toBe(true);
  });

  it("同樣的大雨，室內地點不受影響", () => {
    const result = filterOne(
      makePlace({ indoorType: "indoor", category: "museum", facilityAgeBands: null }),
      makeContext({ weather: makeForecast({ rainProbability: 90 }) }),
    );
    expect(result.passed).toBe(true);
  });

  it("體感超過 33°C 且遮蔭不足時，戶外地點被剔除", () => {
    const result = filterOne(
      makePlace({ indoorType: "outdoor", shadeLevel: 1 }),
      makeContext({ weather: makeForecast({ apparentTempC: 34 }) }),
    );
    expect(result.rejectedBy).toBe("heat");
  });

  it("同樣的高溫，遮蔭充足的戶外地點保留", () => {
    const result = filterOne(
      makePlace({ indoorType: "outdoor", shadeLevel: 2 }),
      makeContext({ weather: makeForecast({ apparentTempC: 34 }) }),
    );
    expect(result.passed).toBe(true);
  });

  it("沒有預報資料時不剔除，但會發出警示", () => {
    // 刻意不預設「沒資料就是好天氣」，也不預設「沒資料就不要去」。
    const result = filterOne(
      makePlace({ indoorType: "outdoor" }),
      makeContext({ weather: { slots: [] } }),
    );
    expect(result.passed).toBe(true);
    expect(result.warnings.join()).toContain("沒有天氣預報資料");
  });
});

describe("適齡（§7.1 明訂必須是硬過濾，不得移至評分扣分）", () => {
  it("有遊具但不含小孩年齡層、且無可奔跑空間時被剔除", () => {
    // 家長不會「去了才發現不適合」，而是看到現場只有大型遊具就事前排除。
    const result = filterOne(
      makePlace({ facilityAgeBands: ["school_age"], runnableSpace: 1 }),
    );
    expect(result.rejectedBy).toBe("facility_age_mismatch");
  });

  it("同樣不適齡的遊具，可奔跑空間夠大時存活", () => {
    // §6.2 的核心論證：大型兒童樂園（設施不適齡且無可跑空間）應被剔除，
    // 而美術館（無設施但可跑空間 3）應該存活。
    const result = filterOne(
      makePlace({ facilityAgeBands: ["school_age"], runnableSpace: 3 }),
    );
    expect(result.passed).toBe(true);
  });

  it("完全沒有遊具設施的場館不受這條規則影響", () => {
    // null 代表無設施，不是「有設施但不適齡」。
    const result = filterOne(
      makePlace({
        category: "museum",
        facilityAgeBands: null,
        runnableSpace: 3,
        indoorType: "indoor",
        parentEffort: 1,
      }),
    );
    expect(result.passed).toBe(true);
  });

  it("月齡不在地點適用範圍時被剔除——這與遊具適齡是兩條不同的規則", () => {
    // ADR-0014：步道沒有遊具，但對六個月大的嬰兒仍然不適合。
    const result = filterOne(
      makePlace({
        facilityAgeBands: null,
        runnableSpace: 3,
        suitableAgeMonths: { minMonths: 36, maxMonths: 144 },
      }),
    );
    expect(result.rejectedBy).toBe("age_out_of_range");
  });
});

describe("家長負擔（§7.1 新增）", () => {
  it("超過偏好上限的地點被剔除", () => {
    // §6.2：決定要不要去的是家長。「小孩玩得開心但家長累垮」
    // 與「兩者皆可」是不同的結果，而任何懶人包都不會記錄這件事。
    const result = filterOne(
      makePlace({ parentEffort: 5 }),
      makeContext({ familyPreference: makeFamilyPreference({ maxParentEffort: 3 }) }),
    );
    expect(result.rejectedBy).toBe("parent_effort_too_high");
  });

  it("剛好等於上限時保留", () => {
    const result = filterOne(
      makePlace({ parentEffort: 3 }),
      makeContext({ familyPreference: makeFamilyPreference({ maxParentEffort: 3 }) }),
    );
    expect(result.passed).toBe(true);
  });

  it("沙灘與美術館的差別在這裡顯現", () => {
    // §6.2 的對照組：兩者都是「無設施、可跑空間 3」，
    // 但沙灘的家長負擔是 5、美術館是 1。
    const context = makeContext({
      familyPreference: makeFamilyPreference({ maxParentEffort: 3 }),
    });
    const beach = makePlace({ category: "beach", facilityAgeBands: null, runnableSpace: 3, parentEffort: 5, safetyEnclosure: 1 });
    const museum = makePlace({ category: "museum", facilityAgeBands: null, runnableSpace: 3, parentEffort: 1, indoorType: "indoor", safetyEnclosure: 3 });

    expect(filterOne(beach, context).passed).toBe(false);
    expect(filterOne(museum, context).passed).toBe(true);
  });
});

describe("安全（§7.1 新增）", () => {
  it("幼兒階段且安全封閉性過低時被剔除", () => {
    // 0＝鄰接車道或開放水域。對還在被抱著的小孩，
    // 那不是「要多留意」，是不能去。
    const result = filterOne(
      makePlace({ safetyEnclosure: 0 }),
      makeContext({ children: [makeChild({ mobility: "carried" })] }),
    );
    expect(result.rejectedBy).toBe("unsafe_for_toddler");
  });

  it("同樣的地點，能自己走完全程的小孩不受此限", () => {
    const result = filterOne(
      makePlace({ safetyEnclosure: 0 }),
      makeContext({ children: [makeChild({ mobility: "walks_full" })] }),
    );
    expect(result.passed).toBe(true);
  });

  it("續航短也算幼兒階段", () => {
    const result = filterOne(
      makePlace({ safetyEnclosure: 0 }),
      makeContext({ children: [makeChild({ mobility: "walks_short" })] }),
    );
    expect(result.rejectedBy).toBe("unsafe_for_toddler");
  });
});

describe("推車", () => {
  it("需推車但地點不友善時被剔除", () => {
    const result = filterOne(
      makePlace({ strollerFriendly: false }),
      makeContext({ children: [makeChild({ mobility: "stroller" })] }),
    );
    expect(result.rejectedBy).toBe("stroller_unfriendly");
  });
});

describe("多小孩", () => {
  it("只要有一個小孩不適合，整個地點就被剔除", () => {
    // 與 Stage 2 取最低分同一個道理：只要有一個不適合，整趟就毀了。
    const result = filterOne(
      makePlace({ suitableAgeMonths: { minMonths: 36, maxMonths: 144 } }),
      makeContext({
        children: [
          makeChild({ id: "big", birthDate: "2021-01-01" }),
          makeChild({ id: "small", birthDate: "2024-12-29" }),
        ],
      }),
    );
    expect(result.rejectedBy).toBe("age_out_of_range");
  });
});

describe("一次性情境覆寫（§8）", () => {
  it("覆寫車程上限只影響本次判斷", () => {
    const place = makePlace({ id: "p" });
    const base = makeContext({
      maxDriveMinutes: 45,
      preciseDrive: new Map([["p", { outboundMinutes: 40, returnMinutes: 40 }]]),
    });
    const restricted = { ...base, contextOverride: { maxDriveMinutes: 30 } };

    expect(filterOne(place, base).passed).toBe(true);
    expect(filterOne(place, restricted).rejectedBy).toBe("drive_too_long");
  });

  it("覆寫家長負擔上限（「今天外婆一起去」的情境）", () => {
    const place = makePlace({ parentEffort: 5 });
    const base = makeContext({
      familyPreference: makeFamilyPreference({ maxParentEffort: 3 }),
    });
    const withGrandma = { ...base, contextOverride: { maxParentEffort: 5 as const } };

    expect(filterOne(place, base).passed).toBe(false);
    expect(filterOne(place, withGrandma).passed).toBe(true);
  });

  it("沒有覆寫時一切照常——無法解析的情境不得中斷流程（§8.5）", () => {
    expect(filterOne(makePlace(), makeContext({ contextOverride: undefined })).passed).toBe(true);
  });
});

describe("警示與輸出形狀", () => {
  it("使用粗估車程時明示，不得靜默使用低信心估值（§10.3.5）", () => {
    const result = filterOne(makePlace());
    expect(result.drive.source).toBe("coarse");
    expect(result.warnings.join()).toContain("估算值");
  });

  it("有精算時不發那個警示", () => {
    const context = makeContext({
      preciseDrive: new Map([["place-1", { outboundMinutes: 12, returnMinutes: 15 }]]),
    });
    const result = filterOne(makePlace(), context);
    expect(result.drive.source).toBe("precise");
    expect(result.warnings.join()).not.toContain("估算值");
  });

  it("被使用者標記過資料可疑的地點會提醒（ADR-0011）", () => {
    const result = filterOne(
      makePlace({ dataSuspect: true, dataSuspectReason: "設施不適齡" }),
    );
    expect(result.warnings.join()).toContain("設施不適齡");
  });

  it("被剔除的地點仍留在結果裡，附上原因", () => {
    // 調門檻是長期工作，看得到「什麼被剔除、為什麼」才調得動。
    const results = applyStage1(
      [makePlace({ id: "ok" }), makePlace({ id: "far", lat: 23.99, lng: 121.6 })],
      makeContext(),
    );
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.place.id === "far")?.rejectedBy).toBe("drive_too_long");
  });
});

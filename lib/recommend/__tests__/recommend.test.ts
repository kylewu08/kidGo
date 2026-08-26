/**
 * 三個階段串起來之後的行為，以及 §13.3 點名的必要測試案例。
 *
 * 個別因子的規格在 scoring.test.ts、過濾在 filters.test.ts、
 * 多樣性在 diversity.test.ts。這裡測的是組合出來的性質。
 */

import { describe, expect, it } from "vitest";

import { recommend } from "../index";
import { WEIGHTS } from "../weights";
import {
  SATURDAY_9AM,
  makeCategoryPreference,
  makeChild,
  makeContext,
  makeFamilyPreference,
  makeForecast,
  makePlace,
  makeVisit,
} from "./fixtures";

/** 一組性質不同的地點，讓 Stage 3 有東西可挑 */
function mixedPlaces() {
  return [
    makePlace({ id: "park", category: "park", indoorType: "outdoor", shadeLevel: 2, parentEffort: 2 }),
    makePlace({
      id: "museum", category: "museum", indoorType: "indoor",
      facilityAgeBands: null, runnableSpace: 3, parentEffort: 1,
      hasAirConditioning: true, safetyEnclosure: 3,
    }),
    makePlace({
      id: "library", category: "library", indoorType: "indoor",
      facilityAgeBands: null, runnableSpace: 1, parentEffort: 1,
      hasAirConditioning: true, safetyEnclosure: 3, typicalDurationMinutes: 60,
    }),
  ];
}

describe("§13.3：雨天", () => {
  const rainy = makeContext({ weather: makeForecast({ rainProbability: 80 }) });

  it("戶外全滅", () => {
    const result = recommend(mixedPlaces(), [], rainy);
    expect(result.scored.map((r) => r.place.id)).not.toContain("park");
    expect(result.rejected.find((r) => r.place.id === "park")?.rejectedBy).toBe("rain");
  });

  it("偏好權重歸零（§7.4 防線一）", () => {
    const result = recommend(mixedPlaces(), [], rainy);
    expect(result.preferenceSuppressed).toBe(true);
  });

  it("室內選項以原始分數公平競爭——偏好不能覆蓋硬過濾", () => {
    // 偏好戶外的家庭，在雨天仍應拿到室內的建議，
    // 而且室內地點之間不因偏好而被扭曲。
    const outdoorLover = {
      ...rainy,
      familyPreference: makeFamilyPreference({ outdoorTendency: 2 }),
      categoryPreferences: [
        makeCategoryPreference({ category: "museum", learnedWeight: -0.9, sampleCount: 30 }),
      ],
    };
    const result = recommend(mixedPlaces(), [], outdoorLover);

    expect(result.slots.length).toBeGreaterThan(0);
    // 被長期壓低的 museum 仍然拿得到中性的偏好分數
    const museum = result.scored.find((r) => r.place.id === "museum");
    expect(museum?.scoreBreakdown.familyPreference).toBe(0.5);
  });
});

describe("§13.3：無存活地點時產出「今天不要出門」", () => {
  it("大雨時給出可執行的說明，而不是沉默", () => {
    // §9.1：推播不得沉默，也不得降低標準硬推。
    const result = recommend(
      [makePlace({ indoorType: "outdoor" })],
      [],
      makeContext({ weather: makeForecast({ rainProbability: 90, apparentTempC: 28 }) }),
    );
    expect(result.slots).toEqual([]);
    expect(result.noOutingReason).toMatch(/建議在家/);
    expect(result.noOutingReason).toMatch(/降雨機率 90%/);
  });

  it("時間不夠時的說明與天氣不同", () => {
    const result = recommend(
      [makePlace({ typicalDurationMinutes: 300 })],
      [],
      makeContext({ availableWindow: { start: "09:00", end: "10:00" } }),
    );
    expect(result.noOutingReason).toMatch(/時間不夠/);
  });

  it("有地點時 noOutingReason 為 null", () => {
    expect(recommend(mixedPlaces(), [], makeContext()).noOutingReason).toBeNull();
  });
});

describe("§13.3：多小孩取最低分而非平均", () => {
  const twoChildren = [
    makeChild({ id: "big", name: "老大", birthDate: "2020-08-29" }), // 72 個月
    makeChild({ id: "small", name: "老二", birthDate: "2025-08-29" }), // 12 個月
  ];

  it("總分等於分數最低的那個小孩", () => {
    const [result] = recommend(
      [makePlace({ facilityAgeBands: ["toddler"] })],
      [],
      makeContext({ children: twoChildren }),
    ).scored;
    expect(result.score).toBe(Math.min(...result.perChildScores.map((p) => p.score)));
  });

  it("總分嚴格低於平均——證明沒有偷偷用平均", () => {
    const [result] = recommend(
      [makePlace({ facilityAgeBands: ["toddler"] })],
      [],
      makeContext({ children: twoChildren }),
    ).scored;
    const scores = result.perChildScores.map((p) => p.score);
    const average = scores.reduce((a, b) => a + b, 0) / scores.length;
    expect(scores[0]).not.toBe(scores[1]);
    expect(result.score).toBeLessThan(average);
  });
});

describe("§13.3：連假", () => {
  it("係數正確套用——同一個地點在連假的車程估計更長", () => {
    const far = makePlace({ id: "far", lat: 25.15, lng: 121.62, usesFreeway: true });
    const weekend = recommend([far], [], makeContext({ dayType: "weekend", maxDriveMinutes: 200 }));
    const holiday = recommend([far], [], makeContext({ dayType: "long_weekend", maxDriveMinutes: 200 }));

    expect(holiday.scored[0].drive.outboundMinutes).toBeGreaterThan(
      weekend.scored[0].drive.outboundMinutes * 1.4,
    );
  });

  it("不走國道的地點幾乎不受連假影響（§11.2）", () => {
    const local = makePlace({ id: "local", usesFreeway: false });
    const weekend = recommend([local], [], makeContext({ dayType: "weekend" }));
    const holiday = recommend([local], [], makeContext({ dayType: "long_weekend" }));

    const ratio =
      holiday.scored[0].drive.outboundMinutes / weekend.scored[0].drive.outboundMinutes;
    expect(ratio).toBeLessThan(1.2);
  });

  it("回程獨立計算——精算時去回程可以不同", () => {
    const result = recommend(
      [makePlace({ id: "p" })],
      [],
      makeContext({
        preciseDrive: new Map([["p", { outboundMinutes: 20, returnMinutes: 55 }]]),
      }),
    );
    expect(result.scored[0].drive.outboundMinutes).toBe(20);
    expect(result.scored[0].drive.returnMinutes).toBe(55);
  });
});

describe("§13.3：路況 API 失敗", () => {
  it("完全沒有精算資料時降級為估算，流程不中斷", () => {
    const result = recommend(mixedPlaces(), [], makeContext({ preciseDrive: undefined }));
    expect(result.scored.length).toBeGreaterThan(0);
    expect(result.scored.every((r) => r.drive.source === "coarse")).toBe(true);
  });

  it("信心度有被標記，而且明示在警示裡（§10.3.5）", () => {
    // 不得靜默使用低信心估值。
    const [first] = recommend(mixedPlaces(), [], makeContext()).scored;
    expect(first.drive.source).toBe("coarse");
    expect(first.warnings.join()).toContain("路況資料暫時無法取得");
  });

  it("只有部分地點查得到精算時，其餘各自降級", () => {
    const context = makeContext({
      preciseDrive: new Map([["park", { outboundMinutes: 18, returnMinutes: 22 }]]),
    });
    const byId = new Map(
      recommend(mixedPlaces(), [], context).scored.map((r) => [r.place.id, r]),
    );
    expect(byId.get("park")!.drive.source).toBe("precise");
    expect(byId.get("museum")!.drive.source).toBe("coarse");
  });
});

describe("§13.3：一次性情境（§8）", () => {
  it("覆寫僅影響本次，不寫入家庭偏好", () => {
    const base = makeContext({
      familyPreference: makeFamilyPreference({ maxParentEffort: 2 }),
    });
    const withGrandma = { ...base, contextOverride: { maxParentEffort: 5 as const } };
    const hard = makePlace({ id: "hard", parentEffort: 5 });

    expect(recommend([hard], [], base).scored).toHaveLength(0);
    expect(recommend([hard], [], withGrandma).scored).toHaveLength(1);
    // 原本的 context 沒有被改動
    expect(base.familyPreference.maxParentEffort).toBe(2);
  });

  it("無法解析時（沒有覆寫）流程照常完成", () => {
    // §8.5：不得中斷流程。
    const result = recommend(mixedPlaces(), [], makeContext({ contextOverride: undefined }));
    expect(result.scored.length).toBeGreaterThan(0);
  });
});

describe("§13.3：歷史成效權重不超過 5%", () => {
  it("同一地點的紀錄好壞，最多只能改變 5 分", () => {
    const place = makePlace({ id: "p" });
    const date = "2026-05-01";
    const good = recommend([place], [makeVisit({ id: "g", placeId: "p", date, outcome: "smooth" })], makeContext());
    const bad = recommend([place], [makeVisit({ id: "b", placeId: "p", date, outcome: "meltdown" })], makeContext());

    const delta = good.scored[0].score - bad.scored[0].score;
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThanOrEqual(WEIGHTS.history * 100);
  });
});

describe("候選與已驗證的分流（§7.5、ADR-0011）", () => {
  it("沒去過的地點標為候選，且不給精確返家時間", () => {
    // §7.5：其停留時長僅為估計值。
    const [result] = recommend([makePlace()], [], makeContext()).scored;
    expect(result.status).toBe("candidate");
    expect(result.suggestedReturn).toBeNull();
    expect(result.warnings.join()).toContain("估計值");
  });

  it("去過的地點標為已驗證，並給出返家時間", () => {
    const [result] = recommend(
      [makePlace({ id: "p" })],
      [makeVisit({ placeId: "p" })],
      makeContext(),
    ).scored;
    expect(result.status).toBe("verified");
    expect(result.suggestedReturn).toMatch(/^\d{2}:\d{2}$/);
  });

  it("候選地點的理由回答「這是什麼」，已驗證的回答「為什麼今天」", () => {
    const place = makePlace({ id: "p", facilityAgeBands: ["toddler"] });
    const candidate = recommend([place], [], makeContext()).scored[0];
    const verified = recommend([place], [makeVisit({ placeId: "p" })], makeContext()).scored[0];

    expect(candidate.reasons.join()).toMatch(/遊具標示適合/);
    expect(verified.reasons.join()).toMatch(/回到家|月齡|天氣|天前/);
  });
});

describe("純函式性質（§7.6）", () => {
  it("同樣的輸入永遠得到同樣的輸出", () => {
    const places = mixedPlaces();
    const first = recommend(places, [], makeContext());
    const second = recommend(places, [], makeContext());
    expect(first.scored.map((r) => [r.place.id, r.score])).toEqual(
      second.scored.map((r) => [r.place.id, r.score]),
    );
  });

  it("不修改傳入的資料", () => {
    const places = mixedPlaces();
    const visits = [makeVisit({ placeId: "park" })];
    const placesSnapshot = structuredClone(places);
    const visitsSnapshot = structuredClone(visits);

    recommend(places, visits, makeContext());

    expect(places).toEqual(placesSnapshot);
    expect(visits).toEqual(visitsSnapshot);
  });

  it("時間由 context.timestamp 決定，不是系統時鐘", () => {
    const place = makePlace({ typicalDurationMinutes: 120 });
    const morning = recommend([place], [], makeContext({ timestamp: SATURDAY_9AM }));
    const nearNap = recommend([place], [], makeContext({
      timestamp: new Date(2026, 7, 29, 11, 30),
      availableWindow: { start: "11:30", end: "18:00" },
    }));
    expect(nearNap.scored[0].score).toBeLessThan(morning.scored[0].score);
  });

  it("沒有小孩時直接丟例外", () => {
    expect(() => recommend([makePlace()], [], makeContext({ children: [] }))).toThrow(
      /至少一個 Child/,
    );
  });
});

describe("輸出形狀", () => {
  it("slots 最多三項且各有角色", () => {
    const result = recommend(mixedPlaces(), [], makeContext());
    expect(result.slots.length).toBeLessThanOrEqual(3);
    expect(result.slots.map((s) => s.slot)).toEqual(
      expect.arrayContaining(["primary"]),
    );
  });

  it("scored 依分數由高到低排序", () => {
    const scores = recommend(mixedPlaces(), [], makeContext()).scored.map((r) => r.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it("分數落在 0 到 100 之間", () => {
    for (const r of recommend(mixedPlaces(), [], makeContext()).scored) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it("scoreBreakdown 解釋得了旁邊那個總分", () => {
    const [r] = recommend(mixedPlaces(), [], makeContext()).scored;
    const rebuilt =
      Object.entries(WEIGHTS).reduce(
        (sum, [factor, w]) => sum + w * r.scoreBreakdown[factor as keyof typeof WEIGHTS],
        0,
      ) * 100;
    expect(rebuilt).toBeCloseTo(r.score, 10);
  });
});

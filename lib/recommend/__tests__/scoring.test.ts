/**
 * Stage 2 七個評分因子的規格（設計架構書 v1.0 §7.2）
 */

import { describe, expect, it } from "vitest";

import { __testing } from "../scoring";
import { buildTimeline } from "../timeline";
import { SCORING } from "../weights";
import type { DriveEstimate } from "../types";
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

const {
  scoreSchedule,
  scoreAge,
  scoreWeather,
  scoreFamilyPreference,
  scoreFreshness,
  scoreDrive,
  scoreHistory,
} = __testing;

const drive = (o: Partial<DriveEstimate> = {}): DriveEstimate => ({
  outboundMinutes: 15,
  returnMinutes: 15,
  source: "coarse",
  baselineMinutes: 15,
  ...o,
});

function timelineFrom(start: string, place = makePlace(), d = drive()) {
  return buildTimeline(place, SATURDAY_9AM, { start, end: "18:00" }, d);
}

// ---------------------------------------------------------------------------

describe("作息契合度（25%）", () => {
  it("時段吻合又不撞午睡時拿滿分", () => {
    const place = makePlace({ bestTimeSlots: ["morning"] });
    expect(scoreSchedule(place, makeChild(), timelineFrom("09:00", place), SATURDAY_9AM)).toBe(1);
  });

  it("行程撞到午睡時，午睡那一半歸零", () => {
    // 11:00 出發 → 11:15 到 → 12:45 離開 → 13:00 到家，撞上 12:30–14:30
    const place = makePlace({ bestTimeSlots: ["morning"] });
    expect(
      scoreSchedule(place, makeChild(), timelineFrom("11:00", place), SATURDAY_9AM),
    ).toBe(SCORING.schedule.slotMatchShare);
  });

  it("午睡判斷用回程車程算出的到家時間", () => {
    // §7.1：「能否在午睡前返家」依賴的是回程。
    const place = makePlace({ bestTimeSlots: ["morning"], typicalDurationMinutes: 120 });
    const child = makeChild();
    const shortReturn = timelineFrom("09:00", place, drive({ returnMinutes: 15 }));
    const longReturn = timelineFrom("09:00", place, drive({ returnMinutes: 90 }));

    // 09:00 + 15 + 120 + 15 = 11:30 → 不撞
    // 09:00 + 15 + 120 + 90 = 13:05 → 撞上 12:30 開始的午睡
    expect(scoreSchedule(place, child, shortReturn, SATURDAY_9AM)).toBe(1);
    expect(scoreSchedule(place, child, longReturn, SATURDAY_9AM)).toBeLessThan(1);
  });

  it("已無午睡的小孩不受午睡窗影響", () => {
    const place = makePlace({ bestTimeSlots: ["morning"] });
    const noNap = makeChild({ napStage: "no_nap", napWindows: [] });
    expect(scoreSchedule(place, noNap, timelineFrom("11:00", place), SATURDAY_9AM)).toBe(1);
  });

  it("剛過時段邊界時線性遞減，不是瞬間歸零", () => {
    const place = makePlace({ bestTimeSlots: ["morning"] });
    const noNap = makeChild({ napWindows: [] });
    const inside = scoreSchedule(place, noNap, timelineFrom("11:29", place), SATURDAY_9AM);
    const outside = scoreSchedule(place, noNap, timelineFrom("11:31", place), SATURDAY_9AM);
    expect(inside - outside).toBeLessThan(0.05);
    expect(outside).toBeGreaterThan(0);
  });

  it("沒填適合時段時給中性分數", () => {
    const place = makePlace({ bestTimeSlots: [] });
    const score = scoreSchedule(place, makeChild(), timelineFrom("09:00", place), SATURDAY_9AM);
    expect(score).toBe(
      SCORING.schedule.slotMatchShare * SCORING.schedule.unknownSlotsScore +
        SCORING.schedule.napFitShare,
    );
  });
});

// ---------------------------------------------------------------------------

describe("年齡契合度（20%）", () => {
  const child = makeChild();

  it("遊具涵蓋小孩年齡層時滿分", () => {
    expect(scoreAge(makePlace({ facilityAgeBands: ["toddler"] }), child, 20)).toBe(1);
  });

  it("無遊具但可奔跑空間大時給高分——§7.2 的補償規則", () => {
    // 這一格就是 §6.2 的美術館：沒有遊具、放電低，但對 20 個月幼兒是好選擇。
    const museum = makePlace({ facilityAgeBands: null, runnableSpace: 3 });
    expect(scoreAge(museum, child, 20)).toBe(SCORING.age.runnableCompensation);
  });

  it("無遊具且可跑空間也不足時分數低", () => {
    const library = makePlace({ facilityAgeBands: null, runnableSpace: 1 });
    expect(scoreAge(library, child, 20)).toBe(SCORING.age.noFacilityNoSpace);
  });

  it("可奔跑空間的補償分數高於沒有補償", () => {
    const withSpace = makePlace({ facilityAgeBands: null, runnableSpace: 3 });
    const without = makePlace({ facilityAgeBands: null, runnableSpace: 1 });
    expect(scoreAge(withSpace, child, 20)).toBeGreaterThan(scoreAge(without, child, 20));
  });

  it("年齡層邊界正確——12 個月是學步兒不是嬰兒", () => {
    const toddlerOnly = makePlace({ facilityAgeBands: ["toddler"] });
    expect(scoreAge(toddlerOnly, child, 11)).toBe(SCORING.age.facilityMismatch);
    expect(scoreAge(toddlerOnly, child, 12)).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("天氣適配度（15%）", () => {
  const weatherOf = (place = makePlace(), forecast = makeForecast()) =>
    scoreWeather(place, timelineFrom("09:00", place), forecast);

  it("天氣好時戶外分數高於室內", () => {
    const nice = makeForecast({ rainProbability: 5, apparentTempC: 24 });
    expect(weatherOf(makePlace({ indoorType: "outdoor" }), nice)).toBeGreaterThan(
      weatherOf(makePlace({ indoorType: "indoor" }), nice),
    );
  });

  it("下雨時室內分數高於戶外", () => {
    const rainy = makeForecast({ rainProbability: 55 });
    expect(weatherOf(makePlace({ indoorType: "indoor" }), rainy)).toBeGreaterThan(
      weatherOf(makePlace({ indoorType: "outdoor" }), rainy),
    );
  });

  it("高溫時有冷氣的室內地點加分", () => {
    const hot = makeForecast({ apparentTempC: 34 });
    const withAc = makePlace({ indoorType: "indoor", hasAirConditioning: true });
    const withoutAc = makePlace({ indoorType: "indoor", hasAirConditioning: false });
    expect(weatherOf(withAc, hot)).toBeGreaterThan(weatherOf(withoutAc, hot));
  });

  it("高溫時遮蔭多的戶外地點分數高於遮蔭少的", () => {
    const hot = makeForecast({ apparentTempC: 34 });
    expect(
      weatherOf(makePlace({ indoorType: "outdoor", shadeLevel: 3 }), hot),
    ).toBeGreaterThan(weatherOf(makePlace({ indoorType: "outdoor", shadeLevel: 0 }), hot));
  });

  it("遮蔭補償高溫但不補償下雨——樹蔭擋不住雨", () => {
    const rainy = makeForecast({ rainProbability: 55 });
    expect(weatherOf(makePlace({ indoorType: "outdoor", shadeLevel: 3 }), rainy)).toBe(
      weatherOf(makePlace({ indoorType: "outdoor", shadeLevel: 0 }), rainy),
    );
  });

  it("沒有預報資料時給中性分數，不假裝天氣很好", () => {
    expect(weatherOf(makePlace(), { slots: [] })).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------

describe("家庭偏好（15%）", () => {
  it("類別權重高的地點分數較高", () => {
    const place = makePlace({ category: "park" });
    const liked = makeContext({
      categoryPreferences: [
        makeCategoryPreference({ category: "park", learnedWeight: 0.8, sampleCount: 12 }),
      ],
    });
    const neutral = makeContext();
    expect(scoreFamilyPreference(place, liked, false)).toBeGreaterThan(
      scoreFamilyPreference(place, neutral, false),
    );
  });

  it("樣本數不足時不套用學習權重（§6.3）", () => {
    // 少於 8 筆的學習值是雜訊，不是偏好。
    const place = makePlace({ category: "park" });
    const tooFew = makeContext({
      categoryPreferences: [
        makeCategoryPreference({ category: "park", learnedWeight: 0.9, sampleCount: 3 }),
      ],
    });
    expect(scoreFamilyPreference(place, tooFew, false)).toBe(
      scoreFamilyPreference(place, makeContext(), false),
    );
  });

  it("手動覆寫優先於學習值，且不受樣本數限制（§6.3）", () => {
    // 你必須能在半年後說「這條學錯了」然後改掉它。
    const place = makePlace({ category: "park" });
    const overridden = makeContext({
      categoryPreferences: [
        makeCategoryPreference({
          category: "park",
          learnedWeight: -0.9,
          manualWeight: 0.9,
          sampleCount: 2,
        }),
      ],
    });
    expect(scoreFamilyPreference(place, overridden, false)).toBeGreaterThan(0.5);
  });

  it("戶外傾向影響戶外與室內地點的相對分數", () => {
    const outdoorFamily = makeContext({
      familyPreference: makeFamilyPreference({ outdoorTendency: 2 }),
    });
    const outdoor = makePlace({ indoorType: "outdoor" });
    const indoor = makePlace({ indoorType: "indoor" });
    expect(scoreFamilyPreference(outdoor, outdoorFamily, false)).toBeGreaterThan(
      scoreFamilyPreference(indoor, outdoorFamily, false),
    );
  });

  it("被抑制時一律回傳中性分數（§7.4 防線一）", () => {
    // 偏好只能調整排序，永遠不能覆蓋硬過濾。
    const place = makePlace({ category: "park" });
    const liked = makeContext({
      categoryPreferences: [
        makeCategoryPreference({ category: "park", learnedWeight: 0.9, sampleCount: 20 }),
      ],
    });
    expect(scoreFamilyPreference(place, liked, true)).toBe(
      SCORING.familyPreference.neutralScore,
    );
  });
});

// ---------------------------------------------------------------------------

describe("新鮮度（10%）", () => {
  const freshness = (dates: string[]) =>
    scoreFreshness(
      makePlace(),
      dates.map((date, i) => makeVisit({ id: `v${i}`, date })),
      SATURDAY_9AM,
      14,
    );

  it("從來沒去過的地點拿滿分", () => {
    expect(freshness([])).toBe(1);
  });

  it("兩天前才去過的地點被大幅降權", () => {
    expect(freshness(["2026-08-27"])).toBeLessThan(0.1);
  });

  it("距上次造訪越久分數越高", () => {
    expect(freshness(["2026-08-27"])).toBeLessThan(freshness(["2026-07-27"]));
    expect(freshness(["2026-07-27"])).toBeLessThan(freshness(["2026-03-27"]));
  });

  it("多次造訪時以最近的那次為準", () => {
    expect(freshness(["2025-01-01", "2026-08-27", "2026-01-01"])).toBeCloseTo(
      freshness(["2026-08-27"]),
      5,
    );
  });
});

// ---------------------------------------------------------------------------

describe("車程成本（10%）與壅塞懲罰", () => {
  it("30 分鐘內差異不大", () => {
    const near = scoreDrive(drive({ outboundMinutes: 5, returnMinutes: 5 }));
    const boundary = scoreDrive(drive({ outboundMinutes: 30, returnMinutes: 30 }));
    expect(near - boundary).toBeLessThan(0.15);
  });

  it("超過 30 分鐘後急降", () => {
    const at30 = scoreDrive(drive({ outboundMinutes: 30, returnMinutes: 30 }));
    const at70 = scoreDrive(drive({ outboundMinutes: 70, returnMinutes: 70 }));
    expect(at70).toBeLessThan(0.2);
    expect(at30 - at70).toBeGreaterThan(0.5);
  });

  it("去回程取平均——兩段都要坐在車上", () => {
    const symmetric = scoreDrive(drive({ outboundMinutes: 30, returnMinutes: 30 }));
    const asymmetric = scoreDrive(drive({ outboundMinutes: 20, returnMinutes: 40 }));
    expect(asymmetric).toBeCloseTo(symmetric, 10);
  });

  it("壅塞時額外扣分，而且是超線性的（§7.2）", () => {
    // 在國道塞 40 分鐘與在一般道路開 40 分鐘，對小孩是完全不同的事。
    const base = drive({ source: "precise", baselineMinutes: 20 });
    const mild = scoreDrive({ ...base, outboundMinutes: 30, returnMinutes: 30 }); // 1.5x
    const severe = scoreDrive({ ...base, outboundMinutes: 40, returnMinutes: 40 }); // 2.0x

    const mildPenalty = scoreDrive(drive({ outboundMinutes: 30, returnMinutes: 30 })) - mild;
    const severePenalty = scoreDrive(drive({ outboundMinutes: 40, returnMinutes: 40 })) - severe;

    expect(mildPenalty).toBeGreaterThan(0);
    // 比值加倍時，懲罰要增加得比兩倍更多
    expect(severePenalty).toBeGreaterThan(mildPenalty * 2);
  });

  it("輕微壅塞不觸發懲罰", () => {
    const base = drive({ source: "precise", baselineMinutes: 20, outboundMinutes: 24, returnMinutes: 24 });
    expect(scoreDrive(base)).toBeCloseTo(
      scoreDrive(drive({ outboundMinutes: 24, returnMinutes: 24 })),
      10,
    );
  });

  it("粗估時不算壅塞——粗估的去回程就是基準值本身", () => {
    const coarse = drive({ source: "coarse", baselineMinutes: 20, outboundMinutes: 40, returnMinutes: 40 });
    expect(scoreDrive(coarse)).toBeCloseTo(
      scoreDrive(drive({ outboundMinutes: 40, returnMinutes: 40 })),
      10,
    );
  });
});

// ---------------------------------------------------------------------------

describe("歷史成效（5%）", () => {
  const history = (outcomes: ("smooth" | "ok" | "meltdown")[]) =>
    scoreHistory(
      makePlace(),
      outcomes.map((outcome, i) => makeVisit({ id: `v${i}`, outcome })),
    );

  it("沒有紀錄時給中性偏正的分數", () => {
    // 匯入之後全部都是新的，給 0 會讓所有地點一起沉底。
    expect(history([])).toBe(SCORING.history.noVisitsScore);
  });

  it("順利的紀錄拿高分，崩潰拿低分", () => {
    expect(history(["smooth"])).toBeGreaterThan(history(["ok"]));
    expect(history(["ok"])).toBeGreaterThan(history(["meltdown"]));
  });

  it("崩潰次數越多分數越低", () => {
    expect(history(["meltdown", "meltdown", "smooth"])).toBeLessThan(
      history(["meltdown", "smooth", "smooth"]),
    );
  });
});

/**
 * Stage 2 六個評分因子的規格（設計架構書 §6.3）
 *
 * 每個因子單獨測。整體加權與多小孩取最低分在 recommend.test.ts。
 */

import { describe, expect, it } from "vitest";

import { __testing, totalScore } from "../scoring";
import { buildTimeline } from "../timeline";
import { SCORING, WEIGHTS } from "../weights";
import type { ScoreBreakdown } from "../types";
import {
  SATURDAY_9AM,
  makeChild,
  makeForecast,
  makePlace,
  makeVisit,
} from "./fixtures";

const {
  scoreSchedule,
  scoreAge,
  scoreWeather,
  scoreFreshness,
  scoreDrive,
  scoreHistory,
} = __testing;

// ---------------------------------------------------------------------------

describe("作息契合度（30%）", () => {
  /** 09:00 出發、車程 15、停留 120 → 11:30 到家。不撞 12:30 的午睡。 */
  function timelineFrom(windowStart: string, place = makePlace()) {
    return buildTimeline(place, SATURDAY_9AM, {
      start: windowStart,
      end: "18:00",
    });
  }

  it("現在的時段在 bestTimeSlots 裡、又不撞午睡時拿滿分", () => {
    const place = makePlace({ bestTimeSlots: ["morning"] });
    const score = scoreSchedule(place, makeChild(), timelineFrom("09:00", place), SATURDAY_9AM);
    expect(score).toBe(1);
  });

  it("現在的時段不在 bestTimeSlots 裡時，只拿到午睡那一半的分數", () => {
    const place = makePlace({ bestTimeSlots: ["late_afternoon"] });
    const score = scoreSchedule(place, makeChild(), timelineFrom("09:00", place), SATURDAY_9AM);
    expect(score).toBe(SCORING.schedule.napFitShare);
  });

  it("行程與午睡窗重疊時，午睡那一半直接歸零", () => {
    // 11:00 出發 → 11:15 到 → 13:15 離開 → 13:30 到家，撞上 12:30–14:30 的午睡。
    const place = makePlace({ bestTimeSlots: ["morning"] });
    const score = scoreSchedule(place, makeChild(), timelineFrom("11:00", place), SATURDAY_9AM);
    expect(score).toBe(SCORING.schedule.slotMatchShare);
  });

  it("午睡衝突不是部分扣分而是歸零——午睡被打斷的下午，後面全會走樣", () => {
    expect(SCORING.schedule.napConflictScore).toBe(0);
  });

  it("已經不睡午覺的小孩不受午睡窗影響", () => {
    const place = makePlace({ bestTimeSlots: ["morning"] });
    const noNapChild = makeChild({ napStage: "no_nap", napWindows: [] });
    const score = scoreSchedule(place, noNapChild, timelineFrom("11:00", place), SATURDAY_9AM);
    expect(score).toBe(1);
  });

  it("剛過時段邊界時分數線性遞減，不是瞬間歸零", () => {
    // morning 到 11:30 結束，柔化寬度 30 分 → 11:45 出發拿一半的時段分數。
    const place = makePlace({ bestTimeSlots: ["morning"] });
    const justInside = scoreSchedule(place, makeChild({ napWindows: [] }), timelineFrom("11:29", place), SATURDAY_9AM);
    const justOutside = scoreSchedule(place, makeChild({ napWindows: [] }), timelineFrom("11:31", place), SATURDAY_9AM);

    // 差兩分鐘不該差掉整整一半的作息分數
    expect(justInside - justOutside).toBeLessThan(0.05);
    expect(justOutside).toBeGreaterThan(0);
  });

  it("離時段邊界越遠分數越低，超過柔化寬度後歸零", () => {
    const place = makePlace({ bestTimeSlots: ["morning"] });
    const noNap = makeChild({ napWindows: [] });
    const at1145 = scoreSchedule(place, noNap, timelineFrom("11:45", place), SATURDAY_9AM);
    const at1200 = scoreSchedule(place, noNap, timelineFrom("12:00", place), SATURDAY_9AM);
    const at1300 = scoreSchedule(place, noNap, timelineFrom("13:00", place), SATURDAY_9AM);

    // 11:45 是邊界後 15 分，柔化寬度 30 分 → 時段分數剩一半
    expect(at1145).toBeCloseTo(
      SCORING.schedule.slotMatchShare * 0.5 + SCORING.schedule.napFitShare,
      5,
    );
    expect(at1200).toBeLessThan(at1145);
    expect(at1300).toBe(SCORING.schedule.napFitShare); // 完全落空
  });

  it("地點填多個時段時，貼近其中任何一個都算數", () => {
    const twoSlots = makePlace({ bestTimeSlots: ["early_morning", "post_nap"] });
    const noNap = makeChild({ napWindows: [] });
    // 15:00 落在 post_nap（14:30–16:30）內
    const score = scoreSchedule(twoSlots, noNap, timelineFrom("15:00", twoSlots), SATURDAY_9AM);
    expect(score).toBe(1);
  });

  it("地點還沒填 bestTimeSlots 時給中性分數，新建檔的地點不會永遠排不上來", () => {
    const place = makePlace({ bestTimeSlots: [] });
    const score = scoreSchedule(place, makeChild(), timelineFrom("09:00", place), SATURDAY_9AM);
    expect(score).toBe(
      SCORING.schedule.slotMatchShare * SCORING.schedule.unknownSlotsScore +
        SCORING.schedule.napFitShare,
    );
  });
});

// ---------------------------------------------------------------------------

describe("年齡契合度（25%）", () => {
  const child = makeChild(); // 22 個月

  it("落在 sweetSpotAge 內拿滿分", () => {
    const place = makePlace({ sweetSpotAge: { minMonths: 18, maxMonths: 48 } });
    expect(scoreAge(place, child, SATURDAY_9AM)).toBe(1);
  });

  it("只落在 ageRange、離 sweetSpotAge 越遠分數越低", () => {
    const near = makePlace({
      ageRange: { minMonths: 6, maxMonths: 96 },
      sweetSpotAge: { minMonths: 26, maxMonths: 48 },
    });
    const far = makePlace({
      ageRange: { minMonths: 6, maxMonths: 96 },
      sweetSpotAge: { minMonths: 60, maxMonths: 90 },
    });
    expect(scoreAge(near, child, SATURDAY_9AM)).toBeGreaterThan(
      scoreAge(far, child, SATURDAY_9AM),
    );
  });

  it("剛好在 ageRange 邊緣時拿到最低的 atRangeEdge 分數", () => {
    // 小孩 22 個月，ageRange 下限也是 22，sweet spot 從 60 開始 → 位於邊緣。
    const place = makePlace({
      ageRange: { minMonths: 22, maxMonths: 96 },
      sweetSpotAge: { minMonths: 60, maxMonths: 90 },
    });
    expect(scoreAge(place, child, SATURDAY_9AM)).toBeCloseTo(
      SCORING.age.atRangeEdge,
      5,
    );
  });

  it("地點還沒填 sweetSpotAge 時給中性分數——AI 不得填這個欄位，空著代表還沒判斷過", () => {
    const place = makePlace({ sweetSpotAge: null });
    expect(scoreAge(place, child, SATURDAY_9AM)).toBe(SCORING.age.unknownSweetSpot);
  });

  it("完全在 ageRange 之外時得零分，不依賴 Stage 1 先過濾掉", () => {
    // 評分必須能獨立測試（§8.3），不能假設前一關已經擋掉。
    const place = makePlace({ ageRange: { minMonths: 36, maxMonths: 96 } });
    expect(scoreAge(place, child, SATURDAY_9AM)).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("天氣適配度（20%）", () => {
  function weatherScore(
    place = makePlace(),
    forecast = makeForecast(),
  ) {
    const timeline = buildTimeline(place, SATURDAY_9AM, {
      start: "09:00",
      end: "18:00",
    });
    return scoreWeather(place, timeline, forecast);
  }

  it("天氣好時戶外地點的分數高於室內地點——晴天戶外加分", () => {
    const nice = makeForecast({ rainProbability: 5, apparentTempC: 24 });
    expect(weatherScore(makePlace({ indoor: "outdoor" }), nice)).toBeGreaterThan(
      weatherScore(makePlace({ indoor: "indoor" }), nice),
    );
  });

  it("下雨時室內地點的分數高於戶外地點", () => {
    const rainy = makeForecast({ rainProbability: 55 });
    expect(weatherScore(makePlace({ indoor: "indoor" }), rainy)).toBeGreaterThan(
      weatherScore(makePlace({ indoor: "outdoor" }), rainy),
    );
  });

  it("室內地點的分數不隨降雨機率變動", () => {
    const indoor = makePlace({ indoor: "indoor" });
    expect(weatherScore(indoor, makeForecast({ rainProbability: 10 }))).toBe(
      weatherScore(indoor, makeForecast({ rainProbability: 90 })),
    );
  });

  it("高溫時遮蔽多的地點分數高於遮蔽少的", () => {
    const hot = makeForecast({ apparentTempC: 34 });
    expect(
      weatherScore(makePlace({ indoor: "outdoor", shadeLevel: 3 }), hot),
    ).toBeGreaterThan(
      weatherScore(makePlace({ indoor: "outdoor", shadeLevel: 0 }), hot),
    );
  });

  it("遮蔽補償高溫，但不補償下雨——樹蔭擋不住雨", () => {
    const rainy = makeForecast({ rainProbability: 55 });
    expect(weatherScore(makePlace({ indoor: "outdoor", shadeLevel: 3 }), rainy)).toBe(
      weatherScore(makePlace({ indoor: "outdoor", shadeLevel: 0 }), rainy),
    );
  });

  it("太冷也會扣分，不是只有太熱才扣", () => {
    const cold = makeForecast({ apparentTempC: 10 });
    const mild = makeForecast({ apparentTempC: 24 });
    expect(weatherScore(makePlace({ indoor: "outdoor" }), cold)).toBeLessThan(
      weatherScore(makePlace({ indoor: "outdoor" }), mild),
    );
  });

  it("又下雨又太熱時只扣最重的那一項，不疊加成雙重懲罰", () => {
    const place = makePlace({ indoor: "outdoor", shadeLevel: 0 });
    const both = weatherScore(place, makeForecast({ rainProbability: 55, apparentTempC: 34 }));
    const rainOnly = weatherScore(place, makeForecast({ rainProbability: 55, apparentTempC: 24 }));
    const heatOnly = weatherScore(place, makeForecast({ rainProbability: 5, apparentTempC: 34 }));
    expect(both).toBeCloseTo(Math.min(rainOnly, heatOnly), 5);
  });

  it("沒有預報資料時給中性分數，不假裝天氣很好", () => {
    expect(weatherScore(makePlace(), { slots: [] })).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------

describe("新鮮度（10%）", () => {
  const excludeRecentDays = 14;

  function freshness(visitDates: string[]) {
    const visits = visitDates.map((date, i) =>
      makeVisit({ id: `v${i}`, date }),
    );
    return scoreFreshness(makePlace(), visits, SATURDAY_9AM, excludeRecentDays);
  }

  it("從來沒去過的地點拿滿分", () => {
    expect(freshness([])).toBe(1);
  });

  it("兩天前才去過的地點被大幅降權", () => {
    // 設計架構書 §6.3：excludeRecentDays 內大幅降權。
    expect(freshness(["2026-08-20"])).toBeLessThan(0.1);
  });

  it("距上次造訪越久分數越高", () => {
    expect(freshness(["2026-08-20"])).toBeLessThan(freshness(["2026-07-20"]));
    expect(freshness(["2026-07-20"])).toBeLessThan(freshness(["2026-03-20"]));
  });

  it("剛過 excludeRecentDays 的地點仍明顯低於從沒去過的地點", () => {
    const justPast = freshness(["2026-08-08"]); // 14 天前
    expect(justPast).toBeCloseTo(SCORING.freshness.recentVisitCeiling, 2);
    expect(justPast).toBeLessThan(1);
  });

  it("多次造訪時以最近的那次為準", () => {
    const recentAmongMany = freshness(["2025-01-01", "2026-08-20", "2026-01-01"]);
    expect(recentAmongMany).toBeCloseTo(freshness(["2026-08-20"]), 5);
  });

  it("只計算這個地點的紀錄，別的地點去過不影響", () => {
    const otherPlace = [makeVisit({ id: "other", placeId: "somewhere-else", date: "2026-08-21" })];
    expect(
      scoreFreshness(makePlace({ id: "park" }), otherPlace, SATURDAY_9AM, excludeRecentDays),
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("車程成本（10%）", () => {
  it("30 分鐘以內的車程差異不大", () => {
    const near = scoreDrive(makePlace({ driveMinutes: 5 }));
    const boundary = scoreDrive(makePlace({ driveMinutes: 30 }));
    expect(near - boundary).toBeLessThan(0.15);
  });

  it("超過 30 分鐘後分數急降", () => {
    const at30 = scoreDrive(makePlace({ driveMinutes: 30 }));
    const at50 = scoreDrive(makePlace({ driveMinutes: 50 }));
    const at70 = scoreDrive(makePlace({ driveMinutes: 70 }));
    // 30→50 的落差要明顯大於 10→30 的落差
    expect(at30 - at50).toBeGreaterThan(
      scoreDrive(makePlace({ driveMinutes: 10 })) - at30,
    );
    expect(at70).toBeLessThan(0.2);
  });

  it("車程越長分數單調遞減", () => {
    const scores = [0, 10, 20, 30, 40, 60, 90].map((m) =>
      scoreDrive(makePlace({ driveMinutes: m })),
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });
});

// ---------------------------------------------------------------------------

describe("歷史成效（5%）", () => {
  function history(visits: Parameters<typeof makeVisit>[0][]) {
    return scoreHistory(
      makePlace({ id: "park" }),
      visits.map((v, i) => makeVisit({ id: `v${i}`, placeId: "park", ...v })),
    );
  }

  it("沒有紀錄時給中性偏正的分數，新建檔的地點不會被埋掉", () => {
    expect(history([])).toBe(SCORING.history.noVisitsScore);
  });

  it("outcome 越高分數越高", () => {
    expect(history([{ outcome: 5 }])).toBeGreaterThan(history([{ outcome: 2 }]));
  });

  it("崩潰過的紀錄會拉低分數——meltdown 是最誠實的訊號", () => {
    expect(history([{ outcome: 4, meltdown: true }])).toBeLessThan(
      history([{ outcome: 4, meltdown: false }]),
    );
  });

  it("崩潰率越高扣得越多", () => {
    const oneOfThree = history([
      { outcome: 4, meltdown: true },
      { outcome: 4, meltdown: false },
      { outcome: 4, meltdown: false },
    ]);
    const threeOfThree = history([
      { outcome: 4, meltdown: true },
      { outcome: 4, meltdown: true },
      { outcome: 4, meltdown: true },
    ]);
    expect(threeOfThree).toBeLessThan(oneOfThree);
  });

  it("只計算這個地點的紀錄", () => {
    const elsewhere = [makeVisit({ id: "x", placeId: "elsewhere", outcome: 1, meltdown: true })];
    expect(scoreHistory(makePlace({ id: "park" }), elsewhere)).toBe(
      SCORING.history.noVisitsScore,
    );
  });
});

// ---------------------------------------------------------------------------

describe("加權總分", () => {
  const neutral: ScoreBreakdown = {
    schedule: 0.5,
    age: 0.5,
    weather: 0.5,
    freshness: 0.5,
    drive: 0.5,
    history: 0.5,
  };

  it("六個因子全滿是 100 分，全零是 0 分", () => {
    const all = (v: number): ScoreBreakdown => ({
      schedule: v, age: v, weather: v, freshness: v, drive: v, history: v,
    });
    expect(totalScore(all(1))).toBeCloseTo(100, 10);
    expect(totalScore(all(0))).toBeCloseTo(0, 10);
  });

  it("歷史成效從 0 到 1 最多只能改變 5 分——這是 §2 刻意壓低的權重", () => {
    // 設計架構書 §13 點名要求的測試。三筆紀錄算不出可信平均值，
    // 過度加權只會產生雜訊。紀錄筆數少於 20 筆前不得調高。
    const low = totalScore({ ...neutral, history: 0 });
    const high = totalScore({ ...neutral, history: 1 });
    expect(high - low).toBeCloseTo(5, 10);
    expect(high - low).toBeLessThanOrEqual(5);
  });

  it("作息契合度是影響最大的單一因子", () => {
    const deltas = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).map(
      (factor) =>
        totalScore({ ...neutral, [factor]: 1 }) -
        totalScore({ ...neutral, [factor]: 0 }),
    );
    const scheduleDelta =
      totalScore({ ...neutral, schedule: 1 }) -
      totalScore({ ...neutral, schedule: 0 });
    expect(scheduleDelta).toBe(Math.max(...deltas));
  });
});

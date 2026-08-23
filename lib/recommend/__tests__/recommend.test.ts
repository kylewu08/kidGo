/**
 * Stage 1 + Stage 2 串起來之後的行為（設計架構書 §6、§8.3）
 *
 * 個別因子的規格在 scoring.test.ts，這裡測的是組合出來的性質：
 * 排序、多小孩取最低分，以及 §8.3 要求的純函式性質。
 */

import { describe, expect, it } from "vitest";

import { recommend } from "../index";
import {
  SATURDAY_9AM,
  makeChild,
  makeContext,
  makeForecast,
  makePlace,
  makeVisit,
} from "./fixtures";

describe("排序與過濾", () => {
  it("結果依分數由高到低排序", () => {
    const places = [
      makePlace({ id: "far", driveMinutes: 40 }),
      makePlace({ id: "near", driveMinutes: 5 }),
      makePlace({ id: "mid", driveMinutes: 20 }),
    ];
    const result = recommend(places, [], makeContext());
    expect(result.map((r) => r.place.id)).toEqual(["near", "mid", "far"]);
  });

  it("Stage 1 剔除的地點完全不出現在結果裡", () => {
    const places = [
      makePlace({ id: "ok" }),
      makePlace({ id: "too-far", driveMinutes: 999 }),
    ];
    const result = recommend(places, [], makeContext());
    expect(result.map((r) => r.place.id)).toEqual(["ok"]);
  });

  it("Stage 1 的警示會帶到評分結果上", () => {
    const result = recommend([makePlace({ needsReservation: true })], [], makeContext());
    expect(result[0].warnings.join()).toContain("需要預約");
  });

  it("所有地點都被剔除時回傳空陣列，不是丟例外", () => {
    // UI 需要能顯示「今天沒有適合的地點」，那是一個正常結果不是錯誤。
    const result = recommend(
      [makePlace({ driveMinutes: 999 })],
      [],
      makeContext(),
    );
    expect(result).toEqual([]);
  });

  it("分數落在 0 到 100 之間", () => {
    const result = recommend([makePlace()], [], makeContext());
    expect(result[0].score).toBeGreaterThanOrEqual(0);
    expect(result[0].score).toBeLessThanOrEqual(100);
  });
});

describe("多小孩：取最低分而非平均", () => {
  /** 老大 5 歲（超出 sweet spot），老二 22 個月（正中 sweet spot） */
  const twoChildren = [
    makeChild({ id: "big", birthDate: "2021-08-22" }),
    makeChild({ id: "small", birthDate: "2024-10-22" }),
  ];

  it("地點的總分等於分數最低的那個小孩的分數", () => {
    // 設計架構書 §6.3：只要有一個不適合，整趟就毀了。這是刻意的保守設計。
    const [result] = recommend(
      [makePlace({ sweetSpotAge: { minMonths: 18, maxMonths: 30 } })],
      [],
      makeContext({ children: twoChildren }),
    );

    const lowest = Math.min(...result.perChildScores.map((p) => p.score));
    expect(result.score).toBe(lowest);
  });

  it("總分嚴格低於兩個小孩的平均——證明沒有偷偷用平均", () => {
    const [result] = recommend(
      [makePlace({ sweetSpotAge: { minMonths: 18, maxMonths: 30 } })],
      [],
      makeContext({ children: twoChildren }),
    );

    const scores = result.perChildScores.map((p) => p.score);
    const average = scores.reduce((a, b) => a + b, 0) / scores.length;
    expect(scores[0]).not.toBe(scores[1]); // 前提：兩個小孩分數確實不同
    expect(result.score).toBeLessThan(average);
  });

  it("scoreBreakdown 來自分數最低的那個小孩，解釋得了旁邊的總分", () => {
    // breakdown 是除錯用的（§6.5）。若它取自別的小孩，
    // 開發模式下看到的六個數字就無法還原出顯示的總分，那比不顯示還糟。
    const [result] = recommend(
      [makePlace({ sweetSpotAge: { minMonths: 18, maxMonths: 30 } })],
      [],
      makeContext({ children: twoChildren }),
    );

    const weights = { schedule: 0.3, age: 0.25, weather: 0.2, freshness: 0.1, drive: 0.1, history: 0.05 };
    const rebuilt =
      Object.entries(weights).reduce(
        (sum, [factor, w]) =>
          sum + w * result.scoreBreakdown[factor as keyof typeof weights],
        0,
      ) * 100;
    expect(rebuilt).toBeCloseTo(result.score, 10);
  });

  it("每個小孩都拿到自己的一份分數", () => {
    const [result] = recommend([makePlace()], [], makeContext({ children: twoChildren }));
    expect(result.perChildScores.map((p) => p.childId).sort()).toEqual(["big", "small"]);
  });
});

describe("紀錄的影響", () => {
  it("最近去過的地點排在同等條件的新地點後面", () => {
    // 設計架構書 §6.3 的新鮮度因子。
    const places = [
      makePlace({ id: "just-went" }),
      makePlace({ id: "never-been" }),
    ];
    const visits = [makeVisit({ placeId: "just-went", date: "2026-08-20" })];

    const result = recommend(places, visits, makeContext());
    expect(result[0].place.id).toBe("never-been");
  });

  it("excludeRecentDays 可以調整「最近」的定義", () => {
    const places = [makePlace({ id: "a" })];
    const visits = [makeVisit({ placeId: "a", date: "2026-07-23" })]; // 30 天前

    const strict = recommend(places, visits, makeContext({ excludeRecentDays: 60 }));
    const lenient = recommend(places, visits, makeContext({ excludeRecentDays: 7 }));
    expect(strict[0].score).toBeLessThan(lenient[0].score);
  });

  it("歷史紀錄再差，也翻不了盤超過 5 分", () => {
    // 設計架構書 §2：歷史成效刻意只給 5%，避免三筆紀錄產生的雜訊主導排序。
    // 這裡用同一個地點的兩種紀錄比較，把新鮮度的影響固定住。
    const place = makePlace({ id: "a" });
    const sameDate = "2026-05-01";

    const great = recommend([place], [
      makeVisit({ id: "g", placeId: "a", date: sameDate, outcome: 5, meltdown: false }),
    ], makeContext());
    const awful = recommend([place], [
      makeVisit({ id: "b", placeId: "a", date: sameDate, outcome: 1, meltdown: true }),
    ], makeContext());

    expect(great[0].score - awful[0].score).toBeLessThanOrEqual(5);
    expect(great[0].score).toBeGreaterThan(awful[0].score);
  });
});

describe("純函式性質（§8.3）", () => {
  it("同樣的輸入永遠得到同樣的輸出", () => {
    const places = [makePlace({ id: "a" }), makePlace({ id: "b", driveMinutes: 25 })];
    const visits = [makeVisit({ placeId: "a" })];
    const first = recommend(places, visits, makeContext());
    const second = recommend(places, visits, makeContext());

    expect(first.map((r) => [r.place.id, r.score])).toEqual(
      second.map((r) => [r.place.id, r.score]),
    );
  });

  it("不修改傳入的 places 與 visits", () => {
    const places = [makePlace({ id: "a" })];
    const visits = [makeVisit({ placeId: "a" })];
    const placesSnapshot = structuredClone(places);
    const visitsSnapshot = structuredClone(visits);

    recommend(places, visits, makeContext());

    expect(places).toEqual(placesSnapshot);
    expect(visits).toEqual(visitsSnapshot);
  });

  it("時間由 context.timestamp 決定，不是由系統時鐘決定", () => {
    // 若函式內部偷偷呼叫 new Date()，這個測試會在午睡窗那一項失守。
    const place = makePlace({ typicalDurationMin: 120 });
    const morning = recommend([place], [], makeContext({
      timestamp: SATURDAY_9AM,
      availableWindow: { start: "09:00", end: "18:00" },
    }));
    const nearNap = recommend([place], [], makeContext({
      timestamp: new Date(2026, 7, 22, 11, 30),
      availableWindow: { start: "11:30", end: "18:00" },
    }));

    // 11:30 出發會撞上 12:30 的午睡，09:00 出發不會。
    expect(nearNap[0].score).toBeLessThan(morning[0].score);
  });

  it("沒有傳入任何小孩時直接丟例外，不安靜地回傳可疑結果", () => {
    expect(() => recommend([makePlace()], [], makeContext({ children: [] }))).toThrow(
      /至少一個 Child/,
    );
  });
});

describe("一個貼近真實的情境", () => {
  it("下大雨的週六早上，室內遊樂場排在公園前面", () => {
    const places = [
      makePlace({
        id: "park",
        name: "公園",
        indoor: "outdoor",
        bestTimeSlots: ["morning"],
      }),
      makePlace({
        id: "indoor-playground",
        name: "室內遊樂場",
        category: "indoor_playground",
        indoor: "indoor",
        bestTimeSlots: ["morning"],
        driveMinutes: 20,
      }),
    ];

    const result = recommend(places, [], makeContext({
      weather: makeForecast({ rainProbability: 80, condition: "陰時多雲短暫陣雨" }),
    }));

    // 公園被 Stage 1 直接剔除（降雨 > 60% 且純戶外），連評分都不用。
    expect(result.map((r) => r.place.id)).toEqual(["indoor-playground"]);
  });

  it("天氣好的週六早上，公園排在室內遊樂場前面", () => {
    const places = [
      makePlace({ id: "park", indoor: "outdoor", bestTimeSlots: ["morning"], shadeLevel: 2 }),
      makePlace({
        id: "indoor-playground",
        indoor: "indoor",
        bestTimeSlots: ["morning"],
        driveMinutes: 15,
      }),
    ];

    const result = recommend(places, [], makeContext({
      weather: makeForecast({ rainProbability: 10, apparentTempC: 26 }),
    }));

    expect(result[0].place.id).toBe("park");
  });
});

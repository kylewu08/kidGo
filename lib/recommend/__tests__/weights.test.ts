/**
 * 權重本身的不變條件。
 *
 * 這個檔案守的不是某一次計算的正確性，而是**調參過程的安全帶**。
 * 調權重是本專案的長期核心工作（設計架構書 P7），這些測試確保
 * 調的過程中不會不小心破壞掉幾個刻意的設計決定。
 */

import { describe, expect, it } from "vitest";

import { SCORING, WEIGHTS } from "../weights";

describe("WEIGHTS", () => {
  it("六個因子的權重總和為 1，否則總分不再是 0–100", () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("每個權重都是正數——把某個因子設成 0 應該是刪掉它，不是留一個死因子", () => {
    for (const [factor, weight] of Object.entries(WEIGHTS)) {
      expect(weight, `WEIGHTS.${factor}`).toBeGreaterThan(0);
    }
  });

  it("歷史成效權重不得超過 5%", () => {
    // 設計架構書 §2：三筆紀錄算不出可信平均值，過度加權只會產生雜訊。
    // 紀錄真正的價值是讓開發者發現靜態欄位填錯了，不是自動調整排序。
    //
    // 若你正因為這個測試失敗而讀到這裡：請先確認 Visit 已累積超過 20 筆，
    // 然後改的不只是這個數字，還要更新 §2 與這則註解。
    expect(WEIGHTS.history).toBeLessThanOrEqual(0.05);
  });

  it("作息契合度是權重最高的因子——這是本產品和一般旅遊 App 的分界", () => {
    const max = Math.max(...Object.values(WEIGHTS));
    expect(WEIGHTS.schedule).toBe(max);
  });
});

describe("SCORING", () => {
  it("作息的兩個子項加起來是 1，否則作息因子拿不到滿分", () => {
    expect(
      SCORING.schedule.slotMatchShare + SCORING.schedule.napFitShare,
    ).toBeCloseTo(1, 10);
  });

  it("所有 0–1 區間的分數常數都確實落在 0–1", () => {
    const bounded: Record<string, number> = {
      "schedule.napConflictScore": SCORING.schedule.napConflictScore,
      "schedule.unknownSlotsScore": SCORING.schedule.unknownSlotsScore,
      "age.inSweetSpot": SCORING.age.inSweetSpot,
      "age.atRangeEdge": SCORING.age.atRangeEdge,
      "age.unknownSweetSpot": SCORING.age.unknownSweetSpot,
      "weather.maxShadeCompensation": SCORING.weather.maxShadeCompensation,
      "weather.sunnyOutdoorBonus": SCORING.weather.sunnyOutdoorBonus,
      "freshness.recentVisitCeiling": SCORING.freshness.recentVisitCeiling,
      "drive.scoreAtFreeBoundary": SCORING.drive.scoreAtFreeBoundary,
      "history.noVisitsScore": SCORING.history.noVisitsScore,
      "history.meltdownPenalty": SCORING.history.meltdownPenalty,
      ...Object.fromEntries(
        Object.entries(SCORING.weather.exposure).map(([k, v]) => [
          `weather.exposure.${k}`,
          v,
        ]),
      ),
    };
    for (const [name, value] of Object.entries(bounded)) {
      expect(value, name).toBeGreaterThanOrEqual(0);
      expect(value, name).toBeLessThanOrEqual(1);
    }
  });

  it("落在 sweetSpot 的分數高於落在 ageRange 邊緣的分數", () => {
    expect(SCORING.age.inSweetSpot).toBeGreaterThan(SCORING.age.atRangeEdge);
  });

  it("暴露程度依 indoor < covered_outdoor < mixed < outdoor 遞增", () => {
    const e = SCORING.weather.exposure;
    expect(e.indoor).toBeLessThan(e.covered_outdoor);
    expect(e.covered_outdoor).toBeLessThan(e.mixed);
    expect(e.mixed).toBeLessThan(e.outdoor);
  });

  it("遮蔽不能完全抵銷高溫——樹蔭再多，35 度就是 35 度", () => {
    expect(SCORING.weather.maxShadeCompensation).toBeLessThan(1);
  });
});

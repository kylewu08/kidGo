/**
 * 警示文案的規格。
 *
 * 這些測試守的是「警示要講對事情」。警示講錯不會讓任何測試變紅，
 * 也不會讓推薦排序改變——它只會讓使用者在錯誤的資訊下做決定，
 * 而那是這個產品唯一的資產（誠實）受損。
 */

import { describe, expect, it } from "vitest";

import { recommend } from "../index";
import type { WeatherForecast } from "../types";
import { makeContext, makePlace, SATURDAY_9AM } from "./fixtures";

/** 逐時段指定降雨機率，用來構造「雨只下在某幾個時段」的情境。 */
function forecastByHour(
  rainByHour: Record<number, number>,
  apparentTempC = 26,
): WeatherForecast {
  return {
    slots: [0, 3, 6, 9, 12, 15, 18, 21].map((hour) => ({
      startsAt: new Date(
        SATURDAY_9AM.getFullYear(),
        SATURDAY_9AM.getMonth(),
        SATURDAY_9AM.getDate(),
        hour,
      ),
      rainProbability: rainByHour[hour] ?? 0,
      apparentTempC,
      condition: "多雲",
    })),
  };
}

const warningsFor = (weather: WeatherForecast, place = makePlace()) => {
  const result = recommend([place], [], makeContext({ weather }));
  expect(result.slots.length).toBeGreaterThan(0);
  return result.slots[0].warnings;
};

describe("降雨警示", () => {
  /**
   * 這是 2026-09-01 實際觀察到的錯誤：主建議是純戶外公園、16:18 才到家，
   * 卻**完全沒有降雨警示**，而待得比較短的備案與探索槽都有。
   *
   * 原因是警示原本從「離開地點之後」往後看三小時——待得越久，
   * 那個往後看的區間越晚，反而錯過了行程期間的那一格。
   * **待得越久、警示越少**，正好反過來。
   */
  it("行程期間會下雨就警示，即使回家之後放晴", () => {
    // 09:00 出發、90 分鐘停留 → 大約 12:00 前到家，落在 09 與 12 兩格。
    // 雨只下在那兩格，15 點之後放晴。
    //
    // 50% 是刻意選的：**警示門檻 40，硬過濾門檻 60**（thresholds.ts）。
    // 兩者之間有一段「會提醒但不剔除」的帶，這個測試就跑在那裡面——
    // 用 70 的話戶外地點會先被 Stage 1 剔除，根本產不出警示。
    const weather = forecastByHour({ 9: 50, 12: 50, 15: 0, 18: 0 });
    expect(warningsFor(weather).some((w) => w.includes("降雨機率"))).toBe(true);
  });

  it("行程期間不下雨就不警示，即使晚上會下", () => {
    const weather = forecastByHour({ 9: 0, 12: 0, 15: 80, 18: 80 });
    expect(warningsFor(weather).some((w) => w.includes("降雨機率"))).toBe(false);
  });

  it("低於門檻不警示——台灣夏天的預報常態性偏高，逢雨必報等於沒報", () => {
    const weather = forecastByHour({ 9: 30, 12: 30 });
    expect(warningsFor(weather).some((w) => w.includes("降雨機率"))).toBe(false);
  });

  it("文案講的是「這趟期間」，不是某個時刻之後", () => {
    const weather = forecastByHour({ 9: 50, 12: 50 });
    const warning = warningsFor(weather).find((w) => w.includes("降雨機率"));
    expect(warning).toContain("這趟期間");
    expect(warning).not.toContain("之後");
  });

  /** 室內地點淋不到雨，但行程仍含去回程，所以照樣提醒 */
  it("室內地點也會收到降雨警示——去回程仍在戶外", () => {
    const weather = forecastByHour({ 9: 70, 12: 70 });
    const indoor = makePlace({ indoorType: "indoor", hasAirConditioning: true });
    expect(warningsFor(weather, indoor).some((w) => w.includes("降雨機率"))).toBe(true);
  });
});

describe("高溫警示", () => {
  it("行程期間體感過高就提醒補水", () => {
    const weather = forecastByHour({ 9: 0, 12: 0 }, 34);
    expect(warningsFor(weather).some((w) => w.includes("記得補水"))).toBe(true);
  });

  /** 室內不曬，提醒補水只是雜訊 */
  it("室內地點不提醒補水", () => {
    const weather = forecastByHour({ 9: 0, 12: 0 }, 34);
    const indoor = makePlace({ indoorType: "indoor", hasAirConditioning: true });
    expect(warningsFor(weather, indoor).some((w) => w.includes("記得補水"))).toBe(false);
  });
});

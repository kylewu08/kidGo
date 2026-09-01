/**
 * 當日意圖的規格（ADR-0026）。
 *
 * 這些測試守的是三件在日後最容易被「優化」掉的事：
 * 它是加分不是過濾、它不受偏好抑制影響、它只對本次有效。
 */

import { describe, expect, it } from "vitest";

import { recommend } from "../index";
import { SCORING } from "../weights";
import { makeContext, makeForecast, makePlace } from "./fixtures";

const park = makePlace({ id: "park", category: "park", indoorType: "outdoor" });
const library = makePlace({
  id: "lib",
  category: "library",
  indoorType: "indoor",
  hasAirConditioning: true,
  shadeLevel: 3,
  runnableSpace: 1,
  parentEffort: 1,
  facilityAgeBands: null,
});

const scoreOf = (id: string, intent?: "air_conditioned" | "run_around") => {
  const result = recommend(
    [park, library],
    [],
    makeContext(intent ? { contextOverride: { dayIntent: intent } } : {}),
  );
  return result.scored.find((r) => r.place.id === id)?.score ?? 0;
};

describe("加分而不是過濾", () => {
  it("沒選意圖時不加任何分", () => {
    expect(scoreOf("park")).toBe(scoreOf("park", undefined));
  });

  it("選了「想讓他跑一跑」，公園加分、圖書館不加", () => {
    expect(scoreOf("park", "run_around")).toBeCloseTo(
      scoreOf("park") + SCORING.dayIntent.bonus,
      5,
    );
    expect(scoreOf("lib", "run_around")).toBeCloseTo(scoreOf("lib"), 5);
  });

  /**
   * 最重要的一條：意圖不該把系統逼進死路。
   * 選了「想跑一跑」，圖書館仍然存活、仍然可被推薦——
   * 只是排在後面。硬過濾的話雨天會直接變成「今天不要出門」。
   */
  it("沒被選中的類別仍然存活，不會被剔除", () => {
    const result = recommend(
      [park, library],
      [],
      makeContext({ contextOverride: { dayIntent: "run_around" } }),
    );
    expect(result.scored.map((r) => r.place.id).sort()).toEqual(["lib", "park"]);
  });
});

describe("不受 §7.4 偏好抑制影響", () => {
  /**
   * ⚠️ 這一條最容易被日後「優化」掉。§7.4 的抑制是為了不讓**學來的**偏好
   * 在雨天壓死室內選項；當日意圖是使用者看著今天的天氣自己按的，
   * 把它一起歸零等於「我知道你選了什麼，但我不理你」。
   */
  it("受限情境（降雨 40%）下仍然加分", () => {
    const rainy = makeForecast({ rainProbability: 40, apparentTempC: 28 });

    const withIntent = recommend(
      [park, library],
      [],
      makeContext({ weather: rainy, contextOverride: { dayIntent: "air_conditioned" } }),
    );
    const without = recommend([park, library], [], makeContext({ weather: rainy }));

    expect(withIntent.preferenceSuppressed).toBe(true);

    const libWith = withIntent.scored.find((r) => r.place.id === "lib")!.score;
    const libWithout = without.scored.find((r) => r.place.id === "lib")!.score;
    expect(libWith - libWithout).toBeCloseTo(SCORING.dayIntent.bonus, 5);
  });
});

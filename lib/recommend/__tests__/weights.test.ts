/**
 * 權重與門檻的不變條件。
 *
 * 這個檔案守的不是某一次計算的正確性，而是**調參過程的安全帶**。
 * 調權重是本專案的長期核心工作（P7），這些測試確保調的過程中
 * 不會不小心破壞掉幾個刻意的設計決定。
 */

import { describe, expect, it } from "vitest";

import { THRESHOLDS } from "../thresholds";
import { DIVERSITY, SCORING, WEIGHTS } from "../weights";

describe("WEIGHTS（§7.2）", () => {
  it("七個因子的權重總和為 1，否則總分不再是 0–100", () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("權重與規格表逐格相符", () => {
    expect(WEIGHTS.schedule).toBe(0.25);
    expect(WEIGHTS.age).toBe(0.2);
    expect(WEIGHTS.weather).toBe(0.15);
    expect(WEIGHTS.familyPreference).toBe(0.15);
    expect(WEIGHTS.freshness).toBe(0.1);
    expect(WEIGHTS.drive).toBe(0.1);
    expect(WEIGHTS.history).toBe(0.05);
  });

  it("歷史成效不得超過 5%", () => {
    // §3：少量紀錄算不出可信平均值，過度加權只會產生雜訊。
    // 紀錄真正的價值是讓使用者發現靜態欄位填錯了，不是自動調整排序。
    expect(WEIGHTS.history).toBeLessThanOrEqual(0.05);
  });

  it("作息契合度仍是權重最高的單一因子", () => {
    expect(WEIGHTS.schedule).toBe(Math.max(...Object.values(WEIGHTS)));
  });

  it("每個權重都是正數——設成 0 應該是刪掉它，不是留一個死因子", () => {
    for (const [k, v] of Object.entries(WEIGHTS)) expect(v, k).toBeGreaterThan(0);
  });
});

describe("SCORING", () => {
  it("作息的兩個子項加起來是 1", () => {
    expect(
      SCORING.schedule.slotMatchShare + SCORING.schedule.napFitShare,
    ).toBeCloseTo(1, 10);
  });

  it("午睡衝突是歸零不是部分扣分", () => {
    // 午睡被打斷的那個下午，後面所有事情都會走樣。
    expect(SCORING.schedule.napConflictScore).toBe(0);
  });

  it("可奔跑空間的補償分數高於「無設施也不能跑」", () => {
    // §7.2「可奔跑空間可補償無適齡設施」——美術館之所以是好選擇的原因。
    expect(SCORING.age.runnableCompensation).toBeGreaterThan(
      SCORING.age.noFacilityNoSpace,
    );
  });

  it("遮蔭不能完全抵銷高溫——樹蔭再多，35 度就是 35 度", () => {
    expect(SCORING.weather.maxShadeCompensation).toBeLessThan(1);
  });

  it("暴露程度依 indoor < covered_outdoor < mixed < outdoor 遞增", () => {
    const e = SCORING.weather.exposure;
    expect(e.indoor).toBeLessThan(e.covered_outdoor);
    expect(e.covered_outdoor).toBeLessThan(e.mixed);
    expect(e.mixed).toBeLessThan(e.outdoor);
  });

  it("壅塞懲罰是超線性的（§7.2）", () => {
    // 在國道塞 40 分鐘與在一般道路開 40 分鐘，對小孩是完全不同的事。
    expect(SCORING.drive.congestionExponent).toBeGreaterThan(1);
  });

  it("壅塞懲罰只在明顯壅塞後才生效", () => {
    expect(SCORING.drive.congestionOnsetRatio).toBeGreaterThan(1);
  });

  it("樣本數門檻存在，不足時不套用學習權重（§6.3）", () => {
    expect(SCORING.familyPreference.minSampleCount).toBeGreaterThanOrEqual(8);
  });

  it("崩潰的分數遠低於順利", () => {
    const o = SCORING.history.outcomeScore;
    expect(o.meltdown).toBeLessThan(o.ok);
    expect(o.ok).toBeLessThan(o.smooth);
  });
});

describe("THRESHOLDS（§7.1）", () => {
  it("降雨門檻是 60% 而非 50%", () => {
    // 台灣午後雷陣雨預報常態性偏高，訂太低會在夏天把戶外選項清空。
    expect(THRESHOLDS.rainProbabilityExcludeOutdoor).toBe(60);
  });

  it("高溫門檻是體感 33°C", () => {
    expect(THRESHOLDS.apparentTempExcludeOutdoor).toBe(33);
  });

  it("粗篩門檻放寬約 20%，且這是唯一的誤差緩衝（ADR-0014）", () => {
    expect(THRESHOLDS.coarseDriveSlack).toBeCloseTo(1.2, 5);
  });

  it("幼兒階段包含「需抱」與「續航短」", () => {
    expect([...THRESHOLDS.toddlerMobilities].sort()).toEqual(
      ["carried", "walks_short"].sort(),
    );
  });
});

describe("DIVERSITY（§7.3）", () => {
  it("輸出固定三項", () => {
    expect(DIVERSITY.slotCount).toBe(3);
  });

  it("探索槽有分數下限，但不會高到讓它退化成第三名", () => {
    expect(DIVERSITY.exploreMinScoreRatio).toBeGreaterThan(0.3);
    expect(DIVERSITY.exploreMinScoreRatio).toBeLessThan(0.9);
  });
});

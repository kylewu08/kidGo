/**
 * Stage 1 硬性過濾的規格（設計架構書 §6.2）
 *
 * 這個檔案就是「L1 判斷力」那一層的規格書。每個測試名稱都是一句育兒常識，
 * 接手的人讀完就知道系統到底編碼了哪些判斷。
 */

import { describe, expect, it } from "vitest";

import { applyStage1 } from "../filters";
import { THRESHOLDS } from "../thresholds";
import { makeChild, makeContext, makeForecast, makePlace } from "./fixtures";

/** 取單一地點的過濾結果，讓斷言貼近測試名稱 */
function filterOne(
  place: ReturnType<typeof makePlace>,
  context = makeContext(),
) {
  return applyStage1([place], context)[0];
}

describe("Stage 1：車程與時間", () => {
  it("車程超過上限的地點被剔除", () => {
    const result = filterOne(
      makePlace({ driveMinutes: 46 }),
      makeContext({ maxDriveMinutes: 45 }),
    );
    expect(result.passed).toBe(false);
    expect(result.rejectedBy).toBe("drive_too_long");
  });

  it("車程剛好等於上限的地點保留", () => {
    const result = filterOne(
      makePlace({ driveMinutes: 45, typicalDurationMin: 30 }),
      makeContext({ maxDriveMinutes: 45, availableWindow: { start: "09:00", end: "18:00" } }),
    );
    expect(result.passed).toBe(true);
  });

  it("可用時間不足以來回車程加上六成典型停留時，地點被剔除", () => {
    // 車程 30 分來回 60 分，典型停留 120 分的六成是 72 分，共需 132 分。
    // 可用時間只有 120 分（09:00–11:00）。
    const result = filterOne(
      makePlace({ driveMinutes: 30, typicalDurationMin: 120 }),
      makeContext({ availableWindow: { start: "09:00", end: "11:00" } }),
    );
    expect(result.passed).toBe(false);
    expect(result.rejectedBy).toBe("not_enough_time");
  });

  it("同樣的地點在時間充裕時就保留，證明剔除的是時間而不是地點本身", () => {
    const result = filterOne(
      makePlace({ driveMinutes: 30, typicalDurationMin: 120 }),
      makeContext({ availableWindow: { start: "09:00", end: "13:00" } }),
    );
    expect(result.passed).toBe(true);
  });
});

describe("Stage 1：天氣", () => {
  it("降雨機率超過 60% 時，純戶外地點被剔除", () => {
    const result = filterOne(
      makePlace({ indoor: "outdoor" }),
      makeContext({ weather: makeForecast({ rainProbability: 61 }) }),
    );
    expect(result.passed).toBe(false);
    expect(result.rejectedBy).toBe("rain");
  });

  it("降雨機率剛好 60% 時不剔除——門檻是「超過」不是「達到」", () => {
    const result = filterOne(
      makePlace({ indoor: "outdoor" }),
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
      makePlace({ indoor: "indoor" }),
      makeContext({ weather: makeForecast({ rainProbability: 90 }) }),
    );
    expect(result.passed).toBe(true);
  });

  it("同樣的大雨，半戶外地點不被硬性剔除，只在評分時扣分", () => {
    // 設計架構書 §6.2 的規則字面上只針對 indoor === "outdoor"，
    // covered_outdoor 與 mixed 有退路，交給 Stage 2 處理。
    for (const indoor of ["covered_outdoor", "mixed"] as const) {
      const result = filterOne(
        makePlace({ indoor }),
        makeContext({ weather: makeForecast({ rainProbability: 90 }) }),
      );
      expect(result.passed).toBe(true);
    }
  });

  it("體感溫度超過 33°C 且幾乎沒有遮蔽時，戶外地點被剔除", () => {
    const result = filterOne(
      makePlace({ indoor: "outdoor", shadeLevel: 1 }),
      makeContext({ weather: makeForecast({ apparentTempC: 34 }) }),
    );
    expect(result.passed).toBe(false);
    expect(result.rejectedBy).toBe("heat");
  });

  it("同樣的高溫，遮蔽充足的戶外地點保留", () => {
    const result = filterOne(
      makePlace({ indoor: "outdoor", shadeLevel: 2 }),
      makeContext({ weather: makeForecast({ apparentTempC: 34 }) }),
    );
    expect(result.passed).toBe(true);
  });

  it("預報只看出遊那段時間，不看整天", () => {
    // 09:00 出發，車程 15 分，停留 120 分，15 分回程 → 12:30 到家。
    // 把 15:00 之後的時段改成暴雨，不應影響上午的判斷。
    const forecast = makeForecast();
    for (const slot of forecast.slots) {
      if (slot.startsAt.getHours() >= 15) slot.rainProbability = 95;
    }
    const result = filterOne(makePlace(), makeContext({ weather: forecast }));
    expect(result.passed).toBe(true);
  });

  it("沒有預報資料時不剔除戶外地點，但會發出警示", () => {
    // 不預設「沒資料就是好天氣」，也不預設「沒資料就不要去」。
    const result = filterOne(
      makePlace({ indoor: "outdoor" }),
      makeContext({ weather: { slots: [] } }),
    );
    expect(result.passed).toBe(true);
    expect(result.warnings.join()).toContain("沒有天氣預報資料");
  });
});

describe("Stage 1：小孩", () => {
  it("小孩月齡低於地點下限時被剔除", () => {
    const result = filterOne(
      makePlace({ ageRange: { minMonths: 36, maxMonths: 96 } }),
      makeContext({ children: [makeChild()] }), // 22 個月
    );
    expect(result.passed).toBe(false);
    expect(result.rejectedBy).toBe("age_out_of_range");
  });

  it("小孩月齡高於地點上限時被剔除", () => {
    const result = filterOne(
      makePlace({ ageRange: { minMonths: 6, maxMonths: 18 } }),
      makeContext({ children: [makeChild()] }), // 22 個月
    );
    expect(result.passed).toBe(false);
    expect(result.rejectedBy).toBe("age_out_of_range");
  });

  it("使用推車但地點不友善推車時被剔除", () => {
    const result = filterOne(
      makePlace({ strollerFriendly: false }),
      makeContext({ children: [makeChild({ mobility: "stroller" })] }),
    );
    expect(result.passed).toBe(false);
    expect(result.rejectedBy).toBe("stroller_unfriendly");
  });

  it("同樣不友善推車的地點，小孩能自己走就沒問題", () => {
    const result = filterOne(
      makePlace({ strollerFriendly: false }),
      makeContext({ children: [makeChild({ mobility: "walks_full" })] }),
    );
    expect(result.passed).toBe(true);
  });

  it("多個小孩時只要有一個不適合，整個地點就被剔除", () => {
    // 與 Stage 2 取最低分同一個道理：只要有一個不適合，整趟就毀了。
    const result = filterOne(
      makePlace({ ageRange: { minMonths: 24, maxMonths: 96 } }),
      makeContext({
        children: [
          makeChild({ id: "big", birthDate: "2021-01-01" }), // 遠超過 24 個月
          makeChild({ id: "small", birthDate: "2024-10-22" }), // 22 個月，不到門檻
        ],
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.rejectedBy).toBe("age_out_of_range");
  });
});

describe("Stage 1：警示（不剔除）", () => {
  it("需要預約的地點會被標記警示，但不剔除", () => {
    const result = filterOne(makePlace({ needsReservation: true }));
    expect(result.passed).toBe(true);
    expect(result.warnings.join()).toContain("需要預約");
  });

  it("帶推車或抱著的小孩遇到沒有尿布台的地點會被提醒", () => {
    const result = filterOne(
      makePlace({ hasChangingTable: false }),
      makeContext({ children: [makeChild({ mobility: "stroller" })] }),
    );
    expect(result.passed).toBe(true);
    expect(result.warnings.join()).toContain("尿布台");
  });
});

describe("Stage 1：輸出形狀", () => {
  it("被剔除的地點仍留在結果裡，附上原因——否則門檻值就成了沒有回饋的黑箱", () => {
    const results = applyStage1(
      [makePlace({ id: "ok" }), makePlace({ id: "far", driveMinutes: 999 })],
      makeContext(),
    );
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.place.id === "far")?.rejectedBy).toBe(
      "drive_too_long",
    );
  });
});

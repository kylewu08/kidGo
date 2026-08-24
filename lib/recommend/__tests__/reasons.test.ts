/**
 * 理由與警示的規格（設計架構書 §6.5）
 *
 * 這一組測試守的是 AI 邊界最重要的那條線：**理由由規則產生，不是生成出來的。**
 *
 * 一個推薦如果附上一條系統其實沒有考慮過的理由，那就是憑空捏造的說服力。
 * 使用者會依照那條理由做決定——帶著一歲半的小孩開四十分鐘車出門——而它是假的。
 *
 * 所以測的方式是：給定一組 scoreBreakdown，斷言「該說什麼」與「不該說什麼」。
 */

import { describe, expect, it } from "vitest";

import { recommend } from "../index";
import { explain, REASON_THRESHOLDS } from "../reasons";
import { buildTimeline } from "../timeline";
import type { ScoreBreakdown } from "../types";
import {
  makeChild,
  makeContext,
  makeForecast,
  makePlace,
  makeVisit,
} from "./fixtures";

/** 六個因子都不到門檻，測試只調高它關心的那一個 */
const dull: ScoreBreakdown = {
  schedule: 0.3, age: 0.3, weather: 0.3, freshness: 0.3, drive: 0.3, history: 0.3,
};

function explainWith(
  breakdown: Partial<ScoreBreakdown>,
  overrides: {
    place?: Parameters<typeof makePlace>[0];
    child?: Parameters<typeof makeChild>[0];
    context?: Parameters<typeof makeContext>[0];
    visits?: ReturnType<typeof makeVisit>[];
  } = {},
) {
  const place = makePlace(overrides.place);
  const weakestChild = makeChild(overrides.child);
  const context = makeContext({ children: [weakestChild], ...overrides.context });
  return explain({
    place,
    breakdown: { ...dull, ...breakdown },
    weakestChild,
    context,
    timeline: buildTimeline(place, context.timestamp, context.availableWindow),
    driveMinutes: place.driveMinutes,
    visits: overrides.visits ?? [],
  });
}

describe("理由只在分數夠高時出現", () => {
  it("六個因子都平庸時不產生任何理由", () => {
    // 這條是其他測試的地基：確認理由不是無條件冒出來的。
    expect(explainWith({}).reasons).toEqual([]);
  });

  it("作息分數高時說出幾點到家、接得上午睡", () => {
    const { reasons } = explainWith({ schedule: 1 });
    expect(reasons.join()).toMatch(/接得上午睡/);
    expect(reasons.join()).toMatch(/\d{2}:\d{2} 前回到家/);
  });

  it("不睡午覺的小孩不會被說「接得上午睡」", () => {
    const { reasons } = explainWith(
      { schedule: 1 },
      { child: { napStage: "no_nap", napWindows: [] } },
    );
    expect(reasons.join()).not.toMatch(/午睡/);
    expect(reasons.join()).toMatch(/回到家/);
  });

  it("年齡滿分時提到小孩的名字", () => {
    const { reasons } = explainWith({ age: 1 }, { child: { name: "小寶" } });
    expect(reasons.join()).toContain("小寶");
  });

  it("年齡只是部分吻合時不提年齡——部分吻合不值得拿出來講", () => {
    const { reasons } = explainWith({ age: REASON_THRESHOLDS.age - 0.01 });
    expect(reasons.join()).not.toMatch(/月齡/);
  });

  it("天氣好時，室內與戶外說的是不同的話", () => {
    expect(explainWith({ weather: 0.9 }, { place: { indoor: "outdoor" } }).reasons.join())
      .toMatch(/天氣適合出門/);
    expect(explainWith({ weather: 0.9 }, { place: { indoor: "indoor" } }).reasons.join())
      .toMatch(/不受天氣影響/);
  });

  it("沒去過時說「還沒去過」，去過但很久了則說出天數", () => {
    expect(explainWith({ freshness: 1 }).reasons.join()).toMatch(/還沒去過/);

    const { reasons } = explainWith(
      { freshness: 1 },
      { visits: [makeVisit({ placeId: "park", date: "2026-06-01" })] },
    );
    // 2026-06-01 到 2026-08-22 是 82 天
    expect(reasons.join()).toMatch(/82 天前/);
  });

  it("車程分數高時說出實際分鐘數", () => {
    const { reasons } = explainWith({ drive: 1 }, { place: { driveMinutes: 12 } });
    expect(reasons.join()).toMatch(/車程只要 12 分/);
  });
});

describe("理由的數量", () => {
  it("最多三條——六條理由等於沒有理由", () => {
    const { reasons } = explainWith({
      schedule: 1, age: 1, weather: 1, freshness: 1, drive: 1, history: 1,
    });
    expect(reasons).toHaveLength(REASON_THRESHOLDS.maxReasons);
  });

  it("截斷時留下的是優先序最高的幾條，作息排第一", () => {
    const { reasons } = explainWith({
      schedule: 1, age: 1, weather: 1, freshness: 1, drive: 1, history: 1,
    });
    expect(reasons[0]).toMatch(/回到家/);
  });
});

describe("警示", () => {
  it("撞到午睡時明說——這是 ADR-0004 的條件", () => {
    // 撞午睡的地點被扣 15 分但仍留在清單裡。既然它會出現，
    // 就必須說出原因，否則使用者看到一個排名偏後的地點卻不知道為什麼，
    // 那比直接剔除還糟。
    const { warnings } = explainWith(
      {},
      { context: { availableWindow: { start: "11:00", end: "18:00" } } },
    );
    expect(warnings.join()).toMatch(/撞到.*午睡/);
    expect(warnings.join()).toMatch(/12:30 開始/);
  });

  it("不撞午睡時不發這個警示", () => {
    const { warnings } = explainWith({});
    expect(warnings.join()).not.toMatch(/撞到/);
  });

  it("離開後可能下雨時說出時間與機率", () => {
    const forecast = makeForecast({ rainProbability: 10 });
    for (const slot of forecast.slots) {
      if (slot.startsAt.getHours() >= 12) slot.rainProbability = 70;
    }
    const { warnings } = explainWith({}, { context: { weather: forecast } });
    expect(warnings.join()).toMatch(/降雨機率 70%/);
  });

  it("天氣好時不發降雨警示", () => {
    const { warnings } = explainWith({}, { context: { weather: makeForecast({ rainProbability: 10 }) } });
    expect(warnings.join()).not.toMatch(/降雨/);
  });

  it("體感溫度偏高時提醒補水，但室內地點不提", () => {
    const hot = makeForecast({ apparentTempC: 33 });
    expect(explainWith({}, { context: { weather: hot }, place: { indoor: "outdoor", shadeLevel: 3 } }).warnings.join())
      .toMatch(/補水/);
    expect(explainWith({}, { context: { weather: hot }, place: { indoor: "indoor" } }).warnings.join())
      .not.toMatch(/補水/);
  });
});

describe("接進 recommend() 之後", () => {
  it("推薦結果帶著理由、警示與建議出發／返家時間", () => {
    const [result] = recommend([makePlace()], [], makeContext());

    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.suggestedDeparture).toMatch(/^\d{2}:\d{2}$/);
    expect(result.suggestedReturn).toMatch(/^\d{2}:\d{2}$/);
  });

  it("Stage 1 的警示與評分階段的警示合併在同一份清單裡", () => {
    // 使用者不需要知道它們來自不同階段。
    const [result] = recommend(
      [makePlace({ needsReservation: true })],
      [],
      makeContext({ availableWindow: { start: "11:00", end: "18:00" } }),
    );
    expect(result.warnings.join()).toMatch(/需要預約/); // Stage 1
    expect(result.warnings.join()).toMatch(/午睡/); // 評分階段
  });

  it("多小孩時，理由講的是分數最低的那個小孩", () => {
    // 若理由講老大而分數扣在老二身上，使用者會看到前後矛盾的說明。
    const [result] = recommend(
      [makePlace({ sweetSpotAge: { minMonths: 18, maxMonths: 30 } })],
      [],
      makeContext({
        children: [
          makeChild({ id: "big", name: "老大", birthDate: "2021-08-22" }),
          makeChild({ id: "small", name: "老二", birthDate: "2024-10-22" }),
        ],
      }),
    );

    const lowest = result.perChildScores.reduce((a, b) => (a.score < b.score ? a : b));
    expect(lowest.childId).toBe("big");
    // 老大不在 sweet spot，所以不會有「月齡正好適合」；
    // 若理由誤用老二，就會冒出那句話。
    expect(result.reasons.join()).not.toMatch(/月齡正好適合/);
  });
});

/**
 * Stage 3 多樣性與防同溫層的規格（設計架構書 v1.0 §7.3、§7.4）
 *
 * §7.4 是整份規格裡最容易被「優化」掉的一段，所以這組測試存在的目的
 * 不只是驗證行為，也是把那個設計意圖釘在程式碼旁邊。
 */

import { describe, expect, it } from "vitest";

import { applyStage3 } from "../diversity";
import type { Recommendation } from "../types";
import { makeCategoryPreference, makeContext, makePlace } from "./fixtures";

/** 只給 applyStage3 用得到的欄位，其餘用不到就不填 */
function rec(
  id: string,
  score: number,
  overrides: Partial<Recommendation["place"]> = {},
): Recommendation {
  return {
    place: makePlace({ id, ...overrides }),
    slot: null,
    score,
    scoreBreakdown: {} as Recommendation["scoreBreakdown"],
    perChildScores: [],
    drive: { outboundMinutes: 15, returnMinutes: 15, source: "coarse", baselineMinutes: 15 },
    reasons: [],
    warnings: [],
    suggestedDeparture: "09:00",
    suggestedReturn: null,
    status: "candidate",
    timeline: {} as Recommendation["timeline"],
  };
}

describe("三個槽位（§7.3）", () => {
  it("最高分的成為主建議", () => {
    const slots = applyStage3(
      [rec("a", 90), rec("b", 80, { category: "museum" })],
      makeContext(),
    );
    expect(slots[0].place.id).toBe("a");
    expect(slots[0].slot).toBe("primary");
  });

  it("備案優先取室內選項，供天氣突變", () => {
    const slots = applyStage3(
      [
        rec("outdoor-high", 90, { category: "park", indoorType: "outdoor" }),
        rec("outdoor-mid", 85, { category: "beach", indoorType: "outdoor" }),
        rec("indoor-low", 70, { category: "museum", indoorType: "indoor" }),
      ],
      makeContext(),
    );
    const backup = slots.find((s) => s.slot === "backup");
    // 儘管 outdoor-mid 分數較高，備案仍取室內的 indoor-low
    expect(backup?.place.id).toBe("indoor-low");
  });

  it("有頂戶外也算天氣備案", () => {
    const slots = applyStage3(
      [
        rec("a", 90, { category: "park", indoorType: "outdoor" }),
        rec("b", 70, { category: "museum", indoorType: "covered_outdoor" }),
      ],
      makeContext(),
    );
    expect(slots.find((s) => s.slot === "backup")?.place.id).toBe("b");
  });

  it("完全沒有室內選項時退而取次高分——備案的存在比它是不是室內重要", () => {
    const slots = applyStage3(
      [
        rec("a", 90, { category: "park", indoorType: "outdoor" }),
        rec("b", 80, { category: "beach", indoorType: "outdoor" }),
      ],
      makeContext(),
    );
    expect(slots.find((s) => s.slot === "backup")?.place.id).toBe("b");
  });

  it("前三名不得為同一類別", () => {
    const slots = applyStage3(
      [
        rec("a", 90, { category: "park" }),
        rec("b", 88, { category: "park" }),
        rec("c", 86, { category: "park" }),
        rec("d", 84, { category: "museum", indoorType: "indoor" }),
        rec("e", 82, { category: "library", indoorType: "indoor" }),
      ],
      makeContext(),
    );
    const categories = slots.map((s) => s.place.category);
    expect(new Set(categories).size).toBe(categories.length);
  });

  it("候選不足三個時不硬湊", () => {
    const slots = applyStage3([rec("a", 90)], makeContext());
    expect(slots).toHaveLength(1);
  });

  it("空輸入回傳空陣列", () => {
    expect(applyStage3([], makeContext())).toEqual([]);
  });
});

describe("防同溫層：探索槽（§7.4 防線二）", () => {
  it("探索槽優先給偏好權重最低的類別，而不是單純最新鮮的", () => {
    // 這個差別很重要：選最新鮮只會在你已經偏好的類別裡輪流，
    // 同溫層不會被打破。
    const context = makeContext({
      categoryPreferences: [
        makeCategoryPreference({ category: "park", learnedWeight: 0.8, sampleCount: 20 }),
        makeCategoryPreference({ category: "library", learnedWeight: -0.6, sampleCount: 20 }),
        makeCategoryPreference({ category: "farm", learnedWeight: 0.3, sampleCount: 20 }),
      ],
    });
    const slots = applyStage3(
      [
        rec("park", 90, { category: "park", indoorType: "outdoor" }),
        rec("museum", 85, { category: "museum", indoorType: "indoor" }),
        rec("farm", 80, { category: "farm", indoorType: "mixed" }),
        rec("library", 78, { category: "library", indoorType: "indoor" }),
      ],
      context,
    );

    // farm 分數較高，但 library 的偏好權重更低，所以探索槽給 library
    expect(slots.find((s) => s.slot === "explore")?.place.id).toBe("library");
  });

  it("探索槽不會挑分數過低的地點", () => {
    const context = makeContext({
      categoryPreferences: [
        makeCategoryPreference({ category: "library", learnedWeight: -0.9, sampleCount: 20 }),
      ],
    });
    const slots = applyStage3(
      [
        rec("park", 90, { category: "park", indoorType: "outdoor" }),
        rec("museum", 85, { category: "museum", indoorType: "indoor" }),
        rec("library", 10, { category: "library", indoorType: "indoor" }),
      ],
      context,
    );
    // library 的偏好最低但分數只有 10，低於門檻
    expect(slots.find((s) => s.slot === "explore")?.place.id).not.toBe("library");
  });

  it("探索槽不因該類別長期未被採納而消失（§7.4 明文要求）", () => {
    // 「探索槽偶爾會推出使用者明知不會去的地點，短期看似推薦品質下降。
    //   這是保險費，不是缺陷——實作時不得為了『提升推薦精準度』而移除。」
    const neverChosen = makeContext({
      categoryPreferences: [
        makeCategoryPreference({ category: "library", learnedWeight: -1, sampleCount: 50 }),
      ],
    });
    const slots = applyStage3(
      [
        rec("park", 90, { category: "park", indoorType: "outdoor" }),
        rec("museum", 85, { category: "museum", indoorType: "indoor" }),
        rec("library", 70, { category: "library", indoorType: "indoor" }),
      ],
      neverChosen,
    );
    expect(slots.find((s) => s.slot === "explore")).toBeDefined();
    expect(slots.find((s) => s.slot === "explore")?.place.id).toBe("library");
  });

  it("沒有任何偏好資料時仍然產出探索槽", () => {
    const slots = applyStage3(
      [
        rec("a", 90, { category: "park", indoorType: "outdoor" }),
        rec("b", 85, { category: "museum", indoorType: "indoor" }),
        rec("c", 80, { category: "library", indoorType: "indoor" }),
      ],
      makeContext(),
    );
    expect(slots.filter((s) => s.slot === "explore")).toHaveLength(1);
  });
});

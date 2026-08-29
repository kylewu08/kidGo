import { describe, expect, it } from "vitest";

import { selectPrecisionShortlist } from "../precision";
import { THRESHOLDS } from "../thresholds";
import type { Recommendation } from "../types";
import type { IndoorType, Place } from "@/lib/db/schema";

function rec(name: string, score: number, indoorType: IndoorType): Recommendation {
  return {
    place: { id: name, name, indoorType } as Place,
    score,
  } as Recommendation;
}

/** 由高到低排序的評分結果 */
function outdoorRun(count: number, from = 90): Recommendation[] {
  return Array.from({ length: count }, (_, i) => rec(`戶外${i}`, from - i, "outdoor"));
}

describe("精算名單", () => {
  it("取前 8 名", () => {
    const shortlist = selectPrecisionShortlist(outdoorRun(20));
    expect(shortlist).toHaveLength(THRESHOLDS.precisionShortlistSize);
    expect(shortlist[0].place.name).toBe("戶外0");
  });

  it("候選不足 8 個時全部取用", () => {
    expect(selectPrecisionShortlist(outdoorRun(3))).toHaveLength(3);
  });

  it("前 8 名全是戶外時，補進名單外分數最高的室內選項", () => {
    // 沒有這條，晴天的前 8 名會全是戶外，於是 §7.3 的備案
    // 永遠只有估算車程——而備案存在的理由正是天氣突變。
    const scored = [...outdoorRun(10), rec("圖書館", 70, "indoor")];
    const shortlist = selectPrecisionShortlist(scored);
    expect(shortlist.map((r) => r.place.name)).toContain("圖書館");
    expect(shortlist).toHaveLength(THRESHOLDS.precisionShortlistSize);
  });

  it("換掉的是名單內分數最低的戶外選項，犧牲最小的那一個", () => {
    const scored = [...outdoorRun(10), rec("圖書館", 70, "indoor")];
    const shortlist = selectPrecisionShortlist(scored);
    // 原本第 8 名是「戶外7」（分數 83），它被換掉；前七名不動。
    expect(shortlist.map((r) => r.place.name)).not.toContain("戶外7");
    expect(shortlist.map((r) => r.place.name).slice(0, 7)).toEqual([
      "戶外0", "戶外1", "戶外2", "戶外3", "戶外4", "戶外5", "戶外6",
    ]);
  });

  it("前 8 名已經有室內選項時原樣返回", () => {
    const scored = [rec("圖書館", 95, "indoor"), ...outdoorRun(12)];
    expect(selectPrecisionShortlist(scored).map((r) => r.place.name)).toEqual([
      "圖書館", "戶外0", "戶外1", "戶外2", "戶外3", "戶外4", "戶外5", "戶外6",
    ]);
  });

  it("有頂戶外也算數，它同樣應付得了天氣突變", () => {
    const scored = [...outdoorRun(10), rec("有頂廣場", 70, "covered_outdoor")];
    expect(selectPrecisionShortlist(scored).map((r) => r.place.name)).toContain("有頂廣場");
  });

  it("完全沒有室內選項時不強求，照樣回傳前 8 名", () => {
    // 資料庫裡一個室內地點都沒有的那個階段（2026-08-29 之前）就是這樣。
    expect(selectPrecisionShortlist(outdoorRun(12))).toHaveLength(8);
  });

  it("回傳結果仍依分數由高到低排序", () => {
    const scored = [...outdoorRun(10), rec("圖書館", 70, "indoor")];
    const scores = selectPrecisionShortlist(scored).map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});

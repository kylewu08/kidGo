import { describe, expect, it } from "vitest";

import { diagnoseProximity, PROXIMITY_TARGET } from "../proximity";
import { HOME, makePlace } from "./fixtures";

/**
 * 往北移 km 公里。1 度緯度約 111 公里。
 * 幾何估計含繞路係數與找車位時間，所以「幾公里」與「幾分鐘」不是線性對應，
 * 測試只依賴「越遠分鐘數越大」這個單調性。
 */
function placeAt(km: number, category: Parameters<typeof makePlace>[0] extends undefined ? never : NonNullable<Parameters<typeof makePlace>[0]>["category"], id: string) {
  return makePlace({ id, category, lat: HOME.lat + km / 111, lng: HOME.lng });
}

describe("住家周邊供給診斷", () => {
  it("超過車程上限的地點不算進該距離帶", () => {
    const places = [placeAt(1, "park", "near"), placeAt(60, "park", "far")];
    const d = diagnoseProximity(places, HOME, 45);
    expect(d.withinFamilyLimit.total).toBe(1);
  });

  it("每個類別只有一個候選時，即使類別數達標也不算達標", () => {
    // 三個類別、各一個——類別數看起來是 3，但每一格都永遠是同一個地點
    const places = [
      placeAt(1, "park", "p1"),
      placeAt(2, "library", "l1"),
      placeAt(3, "museum", "m1"),
    ];
    const d = diagnoseProximity(places, HOME, 45);

    expect(d.withinFamilyLimit.categoryCount).toBe(3);
    expect(d.withinFamilyLimit.meetsTarget).toBe(false);
    expect(d.singletons.sort()).toEqual(["library", "museum", "park"]);
  });

  it("每個類別都有兩個以上候選時才算達標", () => {
    const places = [
      placeAt(1, "park", "p1"), placeAt(2, "park", "p2"),
      placeAt(3, "library", "l1"), placeAt(4, "library", "l2"),
      placeAt(5, "museum", "m1"), placeAt(6, "museum", "m2"),
    ];
    const d = diagnoseProximity(places, HOME, 45);

    expect(d.withinFamilyLimit.meetsTarget).toBe(true);
    expect(d.singletons).toEqual([]);
  });

  it("類別數不足時不算達標，即使每個類別都輪替得動", () => {
    const places = [
      placeAt(1, "park", "p1"), placeAt(2, "park", "p2"),
      placeAt(3, "library", "l1"), placeAt(4, "library", "l2"),
    ];
    const d = diagnoseProximity(places, HOME, 45);

    expect(d.withinFamilyLimit.categoryCount).toBe(2);
    expect(d.withinFamilyLimit.meetsTarget).toBe(false);
  });

  it("距離帶是累積的，遠的那一帶包含近的那一帶", () => {
    const places = [placeAt(1, "park", "p1"), placeAt(15, "park", "p2")];
    const d = diagnoseProximity(places, HOME, 45);

    const counts = d.bands.map((b) => b.total);
    // 單調不遞減
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    }
    expect(counts.at(-1)).toBe(2);
  });

  it("類別依候選數由多到少排序，缺口一眼看得到", () => {
    const places = [
      placeAt(1, "park", "p1"), placeAt(2, "park", "p2"), placeAt(3, "park", "p3"),
      placeAt(4, "library", "l1"),
    ];
    const d = diagnoseProximity(places, HOME, 45);

    expect(d.withinFamilyLimit.categories.map((c) => c.category)).toEqual([
      "park",
      "library",
    ]);
  });

  it("半徑內一個地點都沒有時不會炸，回傳空的診斷", () => {
    const d = diagnoseProximity([placeAt(80, "park", "p1")], HOME, 20);
    expect(d.withinFamilyLimit.total).toBe(0);
    expect(d.withinFamilyLimit.meetsTarget).toBe(false);
    expect(d.singletons).toEqual([]);
  });

  it("輪替門檻是 2 而不是 1——只有一個候選就換不了", () => {
    expect(PROXIMITY_TARGET.minPerCategory).toBe(2);
  });
});

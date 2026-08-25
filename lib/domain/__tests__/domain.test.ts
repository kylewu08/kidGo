/**
 * 領域參數的規格（設計架構書 v1.0 §11）
 *
 * §11 說這些數值是**領域判斷，實作者不應自行推導或更改**。
 * 這組測試守的就是那句話——它把規格表格的值釘住，
 * 有人「順手調一下」時會壞給他看。
 */

import { describe, expect, it } from "vitest";

import { AGE_BAND_MONTHS, ageBandOf, facilityCoversAge } from "../age-bands";
import { CATEGORY_PRIORS, ALL_CATEGORIES } from "../category-priors";
import { DAY_TYPE_COEFFICIENTS, driveCoefficient } from "../day-type";
import {
  DRIVE_ESTIMATE,
  baselineDriveMinutes,
  coarseDriveMinutes,
  haversineKm,
  inferUsesFreeway,
} from "../drive-estimate";

describe("年齡層", () => {
  it("四個年齡層連續涵蓋且不重疊", () => {
    const bands = ["infant", "toddler", "preschool", "school_age"] as const;
    for (let i = 1; i < bands.length; i++) {
      expect(AGE_BAND_MONTHS[bands[i]].min).toBe(AGE_BAND_MONTHS[bands[i - 1]].max);
    }
  });

  it("邊界月齡歸屬正確（前閉後開）", () => {
    expect(ageBandOf(11)).toBe("infant");
    expect(ageBandOf(12)).toBe("toddler");
    expect(ageBandOf(35)).toBe("toddler");
    expect(ageBandOf(36)).toBe("preschool");
    expect(ageBandOf(72)).toBe("school_age");
  });

  it("無遊具設施（null）不算涵蓋任何年齡", () => {
    // 但這不代表地點不適合——§7.1 要「且無可奔跑空間可替代」才剔除。
    expect(facilityCoversAge(null, 20)).toBe(false);
  });

  it("有遊具時依年齡層判定", () => {
    expect(facilityCoversAge(["toddler"], 20)).toBe(true);
    expect(facilityCoversAge(["toddler"], 50)).toBe(false);
  });
});

describe("日型係數（§11.2）", () => {
  it("連假走國道是 2.0——這正是接即時路況的理由", () => {
    expect(DAY_TYPE_COEFFICIENTS.long_weekend.freeway).toBe(2.0);
  });

  it("不走國道的地點幾乎不受連假影響", () => {
    // §11.2 明講這是成本優化的關鍵：真正需要精算的通常只有少數幾個。
    expect(DAY_TYPE_COEFFICIENTS.long_weekend.local).toBe(1.2);
    expect(driveCoefficient("long_weekend", false)).toBeLessThan(
      driveCoefficient("long_weekend", true),
    );
  });

  it("平日兩者皆為 1.0", () => {
    expect(driveCoefficient("weekday", true)).toBe(1.0);
    expect(driveCoefficient("weekday", false)).toBe(1.0);
  });

  it("壅塞程度依 平日 < 週末 < 國定假日 < 連假 遞增（走國道）", () => {
    const order = ["weekday", "weekend", "public_holiday", "long_weekend"] as const;
    for (let i = 1; i < order.length; i++) {
      expect(DAY_TYPE_COEFFICIENTS[order[i]].freeway).toBeGreaterThan(
        DAY_TYPE_COEFFICIENTS[order[i - 1]].freeway,
      );
    }
  });
});

describe("幾何車程估計（ADR-0013、ADR-0014）", () => {
  const banqiao = { lat: 25.01154, lng: 121.450888 };

  it("直線距離算得對", () => {
    // 板橋到宜蘭市約 41 km（ADR-0009 用這個數字論證半徑）
    const yilan = { lat: 24.7592, lng: 121.7537 };
    expect(haversineKm(banqiao, yilan)).toBeGreaterThan(35);
    expect(haversineKm(banqiao, yilan)).toBeLessThan(48);
  });

  it("同一點距離為零", () => {
    expect(haversineKm(banqiao, banqiao)).toBeCloseTo(0, 6);
  });

  it("基準車程含找車位時間", () => {
    const place = { ...banqiao, parkingSearchMinutes: 10 };
    expect(baselineDriveMinutes(banqiao, place)).toBe(10);
  });

  it("距離越遠車程越長", () => {
    const near = { lat: 25.03, lng: 121.47, parkingSearchMinutes: 5 };
    const far = { lat: 25.15, lng: 121.55, parkingSearchMinutes: 5 };
    expect(baselineDriveMinutes(banqiao, far)).toBeGreaterThan(
      baselineDriveMinutes(banqiao, near),
    );
  });

  it("粗篩估計會乘上日型係數", () => {
    const place = { lat: 25.15, lng: 121.6, parkingSearchMinutes: 5, usesFreeway: true };
    const weekday = coarseDriveMinutes(banqiao, place, "weekday");
    const holiday = coarseDriveMinutes(banqiao, place, "long_weekend");
    expect(holiday).toBeGreaterThan(weekday * 1.8);
  });

  it("國道判定用純距離門檻", () => {
    expect(inferUsesFreeway(DRIVE_ESTIMATE.freewayDistanceKm - 1)).toBe(false);
    expect(inferUsesFreeway(DRIVE_ESTIMATE.freewayDistanceKm + 1)).toBe(true);
  });

  it("估計不刻意偏移——繞路係數與速度都是合理的實際值", () => {
    // ADR-0014 修正了 ADR-0013 的「刻意低估」指引：
    // 緩衝只放在粗篩門檻那一個參數上，不散在估計公式裡。
    expect(DRIVE_ESTIMATE.detourFactor).toBeGreaterThan(1);
    expect(DRIVE_ESTIMATE.detourFactor).toBeLessThan(1.6);
    expect(DRIVE_ESTIMATE.averageSpeedKmh).toBeGreaterThan(20);
    expect(DRIVE_ESTIMATE.averageSpeedKmh).toBeLessThan(60);
  });
});

describe("類別先驗值（§11.1）", () => {
  it("涵蓋規格表列的十一個類別", () => {
    expect(ALL_CATEGORIES).toHaveLength(11);
  });

  it("美術館與沙灘在「無設施、可跑空間 3」下仍然完全不同", () => {
    // §6.2 用這組對照說明為什麼需要「家長負擔」與「安全封閉性」。
    const museum = CATEGORY_PRIORS.museum;
    const beach = CATEGORY_PRIORS.beach;

    expect(museum.facilityAgeBands).toBeNull();
    expect(beach.facilityAgeBands).toBeNull();
    expect(museum.runnableSpace).toBe(3);
    expect(beach.runnableSpace).toBe(3);

    // 差別全在這三格
    expect(museum.parentEffort).toBe(1);
    expect(beach.parentEffort).toBe(5);
    expect(museum.hasAirConditioning).toBe(true);
    expect(beach.hasAirConditioning).toBe(false);
    expect(museum.safetyEnclosure).toBe(3);
    expect(beach.safetyEnclosure).toBe(1);
  });

  it("無遊具設施的類別用 null 而非空陣列", () => {
    // 空陣列會與「有設施但不知道適齡層」混淆，null 才明確代表無設施。
    for (const c of ["museum", "library", "farm", "trail", "beach"] as const) {
      expect(CATEGORY_PRIORS[c].facilityAgeBands).toBeNull();
    }
  });

  it("室內類別都有冷氣，戶外類別都沒有", () => {
    for (const c of ALL_CATEGORIES) {
      const p = CATEGORY_PRIORS[c];
      if (p.indoorType === "indoor") expect(p.hasAirConditioning, c).toBe(true);
      if (p.indoorType === "outdoor") expect(p.hasAirConditioning, c).toBe(false);
    }
  });

  it("所有先驗值都在合法範圍內", () => {
    for (const c of ALL_CATEGORIES) {
      const p = CATEGORY_PRIORS[c];
      expect(p.energyBurn, c).toBeGreaterThanOrEqual(1);
      expect(p.energyBurn, c).toBeLessThanOrEqual(5);
      expect(p.parentEffort, c).toBeGreaterThanOrEqual(1);
      expect(p.parentEffort, c).toBeLessThanOrEqual(5);
      expect(p.runnableSpace, c).toBeGreaterThanOrEqual(0);
      expect(p.runnableSpace, c).toBeLessThanOrEqual(3);
      expect(p.safetyEnclosure, c).toBeGreaterThanOrEqual(0);
      expect(p.safetyEnclosure, c).toBeLessThanOrEqual(3);
      expect(p.typicalDurationMinutes, c).toBeGreaterThan(0);
      expect(p.suitableAgeMonths.minMonths, c).toBeLessThan(
        p.suitableAgeMonths.maxMonths,
      );
      if (p.facilityAgeBands !== null) {
        expect(p.facilityAgeBands.length, c).toBeGreaterThan(0);
      }
    }
  });
});

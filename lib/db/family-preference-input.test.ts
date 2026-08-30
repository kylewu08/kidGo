/**
 * 家庭偏好初始三題的規格。
 *
 * 家長負擔上限是**硬過濾條件**（§7.1），填錯會直接砍掉候選而且沒有任何
 * 跡象——推薦照樣出得來，只是少了一整批地點。所以範圍要擋死。
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_FAMILY_PREFERENCE,
  validateFamilyPreferenceInput,
  type RawFamilyPreferenceInput,
} from "./family-preference-input";

const valid: RawFamilyPreferenceInput = {
  outdoorTendency: "1",
  maxParentEffort: "3",
  requiresMeal: "on",
};

const check = (overrides: Partial<RawFamilyPreferenceInput> = {}) =>
  validateFamilyPreferenceInput({ ...valid, ...overrides });

describe("合法輸入", () => {
  it("通過並把字串轉成數字", () => {
    const result = check();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outdoorTendency).toBe(1);
    expect(result.value.maxParentEffort).toBe(3);
    expect(result.value.requiresMeal).toBe(true);
  });

  it("戶外傾向接受兩端與中間", () => {
    for (const v of ["-2", "-1", "0", "1", "2"]) {
      expect(check({ outdoorTendency: v }).ok).toBe(true);
    }
  });

  it("家長負擔上限接受 1 到 5", () => {
    for (const v of ["1", "2", "3", "4", "5"]) {
      expect(check({ maxParentEffort: v }).ok).toBe(true);
    }
  });
});

describe("用餐", () => {
  /** 未勾選的 checkbox 不會出現在 FormData 裡，缺值是 false 不是錯誤。 */
  it("缺值視為否，不算驗證失敗", () => {
    const result = check({ requiresMeal: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.requiresMeal).toBe(false);
  });

  it("只認 on 與 true，其餘一律為否", () => {
    for (const v of ["off", "false", "0", "隨便"]) {
      const result = check({ requiresMeal: v });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.requiresMeal).toBe(false);
    }
  });
});

describe("擋掉會靜默砍掉候選的值", () => {
  it("家長負擔上限超出 1–5 就拒絕", () => {
    expect(check({ maxParentEffort: "0" }).ok).toBe(false);
    expect(check({ maxParentEffort: "6" }).ok).toBe(false);
  });

  it("家長負擔上限不接受小數", () => {
    expect(check({ maxParentEffort: "2.5" }).ok).toBe(false);
  });

  it("家長負擔上限不接受非數字", () => {
    expect(check({ maxParentEffort: "" }).ok).toBe(false);
    expect(check({ maxParentEffort: "三" }).ok).toBe(false);
  });

  it("戶外傾向超出 −2…+2 就拒絕", () => {
    expect(check({ outdoorTendency: "-3" }).ok).toBe(false);
    expect(check({ outdoorTendency: "3" }).ok).toBe(false);
  });

  it("戶外傾向不接受小數", () => {
    expect(check({ outdoorTendency: "0.5" }).ok).toBe(false);
  });
});

describe("預設值", () => {
  /**
   * 驗收標準一：僅輸入住家地址與小孩生日就要能拿到三個推薦。
   * 預設值一旦收緊，這三題就從「可選」變成「不答就少一批候選」。
   */
  it("本身是合法的輸入", () => {
    const result = validateFamilyPreferenceInput({
      outdoorTendency: String(DEFAULT_FAMILY_PREFERENCE.outdoorTendency),
      maxParentEffort: String(DEFAULT_FAMILY_PREFERENCE.maxParentEffort),
      requiresMeal: DEFAULT_FAMILY_PREFERENCE.requiresMeal ? "on" : "",
    });
    expect(result.ok).toBe(true);
  });

  it("戶外傾向中立，不預設偏好室內或戶外", () => {
    expect(DEFAULT_FAMILY_PREFERENCE.outdoorTendency).toBe(0);
  });

  it("家長負擔上限寬鬆，不在使用者不知情時過濾", () => {
    expect(DEFAULT_FAMILY_PREFERENCE.maxParentEffort).toBeGreaterThanOrEqual(4);
  });
});

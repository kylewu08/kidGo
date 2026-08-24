/**
 * 出發點輸入驗證的規格。
 *
 * 這些測試守的不是「壞人打不進來」——這是單人本機工具，沒有攻擊者。
 * 守的是「填錯了會被擋下來」，因為錯的設定產生的錯誤天氣，
 * 看起來永遠是合理的。
 */

import { describe, expect, it } from "vitest";

import { validateHomeBaseInput, type RawHomeBaseInput } from "./home-base-input";

const valid: RawHomeBaseInput = {
  cwaCountyName: "新北市",
  cwaLocationName: "板橋區",
  lat: "25.01154",
  lng: "121.450888",
  maxDriveMinutes: "45",
};

const check = (overrides: Partial<RawHomeBaseInput> = {}) =>
  validateHomeBaseInput({ ...valid, ...overrides });

describe("合法輸入", () => {
  it("通過並把字串轉成數字", () => {
    const result = check();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lat).toBe(25.01154);
    expect(result.value.maxDriveMinutes).toBe(45);
    expect(result.value.cwaCountyName).toBe("新北市");
  });

  it("重複的鄉鎮名稱配上正確的縣市時通過", () => {
    // 東區同時存在於新竹市／嘉義市／臺中市／臺南市。
    for (const county of ["新竹市", "嘉義市", "臺中市", "臺南市"]) {
      expect(check({ cwaCountyName: county, cwaLocationName: "東區" }).ok, county).toBe(true);
    }
  });
});

describe("縣市與鄉鎮必須成對正確", () => {
  it("鄉鎮不屬於該縣市時被擋下，並說出是哪裡不對", () => {
    // 這是這個表單最容易出錯又最難察覺的情況：兩個下拉選單各自看起來都對。
    const result = check({ cwaCountyName: "宜蘭縣", cwaLocationName: "板橋區" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe("宜蘭縣沒有「板橋區」");
  });

  it("重複的鄉鎮名稱配上錯誤的縣市時被擋下", () => {
    expect(check({ cwaCountyName: "新北市", cwaLocationName: "東區" }).ok).toBe(false);
  });

  it("不認得的縣市被擋下", () => {
    expect(check({ cwaCountyName: "火星省" }).ok).toBe(false);
  });

  it("空值被擋下", () => {
    expect(check({ cwaCountyName: "", cwaLocationName: "" }).ok).toBe(false);
  });
});

describe("座標", () => {
  it("非數字被擋下", () => {
    expect(check({ lat: "abc" }).ok).toBe(false);
    expect(check({ lng: "" }).ok).toBe(false);
  });

  it("緯度經度填反時被擋下", () => {
    // 121 不是合法的緯度。這個錯誤很常見而且症狀很隱晦——
    // 天氣照樣抓得到（縣市鄉鎮是對的），但車程會算到地球另一邊。
    const result = check({ lat: "121.450888", lng: "25.01154" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("填反");
  });

  it("臺灣以外的座標被擋下", () => {
    expect(check({ lat: "35.6762", lng: "139.6503" }).ok).toBe(false); // 東京
  });

  it("離島座標通過", () => {
    // 澎湖與金門都在範圍內，別把範圍縮得只剩本島。
    expect(check({ cwaCountyName: "澎湖縣", cwaLocationName: "馬公市", lat: "23.5655", lng: "119.5793" }).ok).toBe(true);
    expect(check({ cwaCountyName: "金門縣", cwaLocationName: "金城鎮", lat: "24.4159", lng: "118.3171" }).ok).toBe(true);
  });
});

describe("車程上限", () => {
  it("零與負數被擋下", () => {
    expect(check({ maxDriveMinutes: "0" }).ok).toBe(false);
    expect(check({ maxDriveMinutes: "-10" }).ok).toBe(false);
  });

  it("小數被擋下——分鐘數不該有小數點", () => {
    expect(check({ maxDriveMinutes: "45.5" }).ok).toBe(false);
  });

  it("非數字被擋下", () => {
    expect(check({ maxDriveMinutes: "" }).ok).toBe(false);
    expect(check({ maxDriveMinutes: "很久" }).ok).toBe(false);
  });
});

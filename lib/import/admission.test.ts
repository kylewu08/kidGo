import { describe, expect, it } from "vitest";

import { admit, CATEGORIES_ADMITTED_ON_THEIR_OWN } from "./admission";
import type { SourceRecord } from "./types";

function record(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    sourceDataset: "tourism_spot",
    sourceId: "x-1",
    name: "某個地方",
    address: "某處",
    lat: 25,
    lng: 121.5,
    category: "park",
    observed: {},
    ...overrides,
  };
}

describe("入場測試（ADR-0019）", () => {
  it("只有名稱與座標的地點被擋下來", () => {
    // 觀光景點資料集裡的廟宇、古厝、牌坊都長這樣：Google Maps 全都有。
    expect(admit(record({ category: "museum" })).admitted).toBe(false);
  });

  it("帶有停留時長的地點放行，因為那是 §6.2 的「實際能撐多久」", () => {
    // 和平島地質公園在觀光景點資料集裡的 VisitDuration: 240。
    const verdict = admit(record({ observed: { typicalDurationMinutes: 240 } }));
    expect(verdict).toEqual({
      admitted: true,
      via: "observed_fields",
      fields: ["typicalDurationMinutes"],
    });
  });

  it("親子館即使沒有任何額外欄位也放行", () => {
    // 全國親子館名冊只有縣市/區域/名稱/地址/電話，但「0-6 歲專用室內免費」
    // 這件事本身就是 Google 查不到的資訊。
    const verdict = admit(record({ category: "parenting_center" }));
    expect(verdict).toEqual({
      admitted: true,
      via: "category",
      category: "parenting_center",
    });
  });

  it("共融遊戲場即使沒有任何額外欄位也放行", () => {
    expect(admit(record({ category: "inclusive_playground" })).admitted).toBe(true);
  });

  it("一般公園沒有額外欄位時不放行，即使它是公園", () => {
    // 臺北 815 筆公園裡有 381 筆是綠地與廣場，只有名稱座標。
    expect(admit(record({ category: "park" })).admitted).toBe(false);
  });

  it("facilityAgeBands 為 null 仍算讀到了欄位，因為「確認無遊具」是資訊", () => {
    const verdict = admit(record({ observed: { facilityAgeBands: null } }));
    expect(verdict.admitted).toBe(true);
  });

  it("欄位存在但值為 undefined 時不算讀到", () => {
    const verdict = admit(record({ observed: { typicalDurationMinutes: undefined } }));
    expect(verdict.admitted).toBe(false);
  });

  it("放行時會記下是哪些欄位讓它進來的，以便日後稽核", () => {
    const verdict = admit(
      record({ observed: { runnableSpace: 3, facilityAgeBands: ["toddler"] } }),
    );
    expect(verdict).toMatchObject({
      via: "observed_fields",
      fields: ["runnableSpace", "facilityAgeBands"],
    });
  });

  it("類別豁免清單維持只有兩項", () => {
    // 這個測試守的是 ADR-0019 的一條約束而不是一段程式碼：
    // 清單一旦開始成長，入場測試就名存實亡了。要加第三項請先改 ADR。
    expect(CATEGORIES_ADMITTED_ON_THEIR_OWN).toEqual([
      "parenting_center",
      "inclusive_playground",
    ]);
  });
});

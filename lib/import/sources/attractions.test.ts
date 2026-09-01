/**
 * 觀光景點 adapter 的規格（ADR-0027）。
 *
 * 這個 adapter 的價值不在它收了什麼，在它**擋掉了什麼**——
 * 6189 筆裡只有博物館該進來，其餘全是「只有名稱與座標」的地點，
 * 而那種地點會擠掉真正有資料的地點（ADR-0019）。
 */

import { describe, expect, it } from "vitest";

import { toSourceRecords, type AttractionFile } from "./attractions";

const entry = (over: Record<string, unknown> = {}) => ({
  AttractionID: "A-1",
  AttractionName: "某某博物館",
  PositionLat: 25.03,
  PositionLon: 121.5,
  PostalAddress: { City: "臺北市", Town: "中正區", StreetAddress: "某某路1號" },
  ...over,
});

const parse = (entries: Record<string, unknown>[]) =>
  toSourceRecords({ Attractions: entries } as AttractionFile);

describe("只收博物館", () => {
  it("名稱含博物館就收", () => {
    expect(parse([entry()])).toHaveLength(1);
  });

  it("美術館、科教館、紀念館也收", () => {
    const names = ["市立美術館", "兒童科教館", "某某紀念館", "某某文物館"];
    expect(parse(names.map((n) => entry({ AttractionName: n })))).toHaveLength(4);
  });

  /**
   * 這是整個 adapter 存在的理由。步道、瀑布、老街只帶名稱與座標，
   * 放進來會擠掉真正有資料的地點——Stage 2 只精算前 8 名。
   */
  it("步道、瀑布、老街、溫泉一律不收", () => {
    const names = ["跑馬古道", "猴洞坑瀑布", "陽翟老街", "礁溪溫泉廣場", "五虎山"];
    expect(parse(names.map((n) => entry({ AttractionName: n })))).toHaveLength(0);
  });
});

describe("範圍限北部四縣市（ADR-0019）", () => {
  it("臺北、新北、桃園、基隆都收", () => {
    const cities = ["臺北市", "新北市", "桃園市", "基隆市"];
    const records = parse(
      cities.map((City, i) =>
        entry({ AttractionID: `A-${i}`, PostalAddress: { City, StreetAddress: "路1號" } }),
      ),
    );
    expect(records).toHaveLength(4);
  });

  it("其他縣市不收", () => {
    const cities = ["宜蘭縣", "新竹市", "臺中市", "高雄市"];
    expect(
      parse(cities.map((City) => entry({ PostalAddress: { City, StreetAddress: "路1號" } }))),
    ).toHaveLength(0);
  });

  it("「台北市」的異體字也認得", () => {
    expect(parse([entry({ PostalAddress: { City: "台北市" } })])).toHaveLength(1);
  });
});

describe("VisitDuration 是來源實值", () => {
  /** 全國只有 2% 有值，但有值的會蓋掉類別先驗並標成 source_data */
  it("有值時進 observed", () => {
    const [r] = parse([entry({ VisitDuration: "60" })]);
    expect(r.observed.typicalDurationMinutes).toBe(60);
  });

  it("沒值時不進 observed，留給類別先驗", () => {
    const [r] = parse([entry({ VisitDuration: null })]);
    expect(r.observed.typicalDurationMinutes).toBeUndefined();
  });

  /**
   * 來源是人填的。0 分鐘的停留會讓時間軸崩掉，
   * 而且**不會有任何錯誤訊息**——只會讓「幾點到家」變成出發時間。
   */
  it("0 或離譜的值當作沒填", () => {
    for (const v of ["0", "5", "9999", "abc", ""]) {
      const [r] = parse([entry({ VisitDuration: v })]);
      expect(r.observed.typicalDurationMinutes).toBeUndefined();
    }
  });
});

describe("缺資料的列直接跳過", () => {
  it("沒有座標就跳過——沒座標算不出車程，Stage 1 無從過濾", () => {
    expect(parse([entry({ PositionLat: null, PositionLon: null })])).toHaveLength(0);
  });

  it("沒有 ID 就跳過——那是外部唯一鍵的一半", () => {
    expect(parse([entry({ AttractionID: "" })])).toHaveLength(0);
  });
});

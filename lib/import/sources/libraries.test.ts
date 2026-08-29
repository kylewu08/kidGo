import { describe, expect, it } from "vitest";

import { admit } from "../admission";
import { sourceIdOf, toSourceRecords, type LibraryCountyGroup } from "./libraries";

const groups: LibraryCountyGroup[] = [
  {
    縣市: "基隆市",
    圖書館資訊: [
      {
        Name: "基隆市公共圖書館總館",
        Area: "中正區",
        Address: "基隆市中正區信一路181號",
        Longitude: 121.7442,
        Latitude: 25.1313,
      },
    ],
  },
  {
    縣市: "臺北市",
    圖書館資訊: [
      { Name: "總館", Area: "大安區", Address: "臺北市大安區建國南路二段125號", Longitude: 121.5372, Latitude: 25.0263 },
      { Name: "", Area: "中山區", Address: "沒有名稱的那一筆" },
    ],
  },
];

describe("圖書館 adapter", () => {
  it("攤平縣市分組，每一間圖書館一筆", () => {
    expect(toSourceRecords(groups).map((r) => r.name)).toEqual([
      "基隆市公共圖書館總館",
      "總館",
    ]);
  });

  it("座標直接帶出來，不需要 geocoding", () => {
    const [keelung] = toSourceRecords(groups);
    expect(keelung).toMatchObject({ lat: 25.1313, lng: 121.7442, category: "library" });
  });

  it("合成的主鍵包含縣市與行政區", () => {
    // 「總館」「中正分館」這類名稱在不同縣市會重複，
    // 只用館名會讓兩間不同的圖書館互相覆蓋。
    expect(sourceIdOf("臺北市", { Name: "總館", Area: "大安區" })).toBe("臺北市-大安區-總館");
    expect(sourceIdOf("基隆市", { Name: "總館", Area: "中正區" })).not.toBe(
      sourceIdOf("臺北市", { Name: "總館", Area: "大安區" }),
    );
  });

  it("沒有館名的資料被略過", () => {
    expect(toSourceRecords(groups)).toHaveLength(2);
  });

  it("圖書館靠類別通過入場測試，因為來源沒有任何決策欄位", () => {
    const verdict = admit(toSourceRecords(groups)[0]);
    expect(verdict).toEqual({ admitted: true, via: "category", category: "library" });
  });

  it("不依縣市篩選——半徑是查詢時的條件", () => {
    // ADR-0019 的四縣市講的是為哪些縣市寫 adapter，
    // 不是在全國資料集裡再切一刀（ADR-0017）。
    expect(toSourceRecords(groups).map((r) => r.sourceId)).toEqual([
      "基隆市-中正區-基隆市公共圖書館總館",
      "臺北市-大安區-總館",
    ]);
  });
});

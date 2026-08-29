import { describe, expect, it } from "vitest";

import { admit } from "../admission";
import { sourceIdOf, toSourceRecords } from "./parenting-centers";

const csv = [
  "項次,縣市,區域,親子館(托育資源中心)名稱,地址,電話,成立時間",
  "1,新北市,汐止區,汐止忠厚公共托育中心,新北市汐止區樟樹一路137巷26號2樓,02-26413300,100.09.30",
  "2,基隆市,中正區,基隆市中正托育資源中心(基隆祖孫館),基隆市中正區調和街3號2樓,02-24632626,105.01.01",
  "3,新北市,三重區,,新北市三重區重新路五段511號2樓,02-29953933,100.11.30",
].join("\n");

describe("親子館 adapter", () => {
  it("解析出名稱與地址", () => {
    const records = toSourceRecords(csv);
    expect(records.map((r) => r.name)).toEqual([
      "汐止忠厚公共托育中心",
      "基隆市中正托育資源中心(基隆祖孫館)",
    ]);
  });

  it("座標留空，等 TGOS 批次比對補上", () => {
    expect(toSourceRecords(csv)[0]).toMatchObject({ lat: null, lng: null });
  });

  it("主鍵用縣市加區域加名稱，不用會位移的項次", () => {
    expect(sourceIdOf("新北市", "汐止區", "汐止忠厚公共托育中心")).toBe(
      "新北市-汐止區-汐止忠厚公共托育中心",
    );
  });

  it("沒有名稱的列被略過", () => {
    expect(toSourceRecords(csv)).toHaveLength(2);
  });

  it("靠類別豁免通過入場測試，因為來源沒有任何決策欄位", () => {
    expect(admit(toSourceRecords(csv)[0])).toEqual({
      admitted: true,
      via: "category",
      category: "parenting_center",
    });
  });
});

/**
 * 地圖連結的規格（ADR-0011 修訂四）。
 *
 * 這些測試守的是「開到正確的那一個」。同名地點在資料庫裡真實存在
 * （福星公園、新興公園、公館公園、中興公園各兩個），只靠名稱一定會開錯，
 * 而開錯的症狀是使用者看了照片覺得不適合——**汙染的是資料品質訊號**。
 */

import { describe, expect, it } from "vitest";

import { mapsUrl } from "./maps-link";

const place = (over: Partial<{ name: string; lat: number; lng: number }> = {}) => ({
  name: "華江八號公園",
  lat: 25.019876,
  lng: 121.462345,
  ...over,
});

describe("地圖連結", () => {
  it("同時帶名稱與座標", () => {
    const url = mapsUrl(place());
    expect(url).toContain(encodeURIComponent("華江八號公園"));
    expect(url).toContain("25.019876,121.462345");
  });

  /** 只有座標會掉一個大頭針、看不到照片，而照片正是這個連結的目的 */
  it("名稱在搜尋路徑上，不是只給座標", () => {
    expect(mapsUrl(place())).toMatch(/\/maps\/search\/[^/]+\/@/);
  });

  /** 同名地點靠座標分辨——這是四組真實存在的重複名稱的解法 */
  it("同名但不同座標會產生不同連結", () => {
    const a = mapsUrl(place({ name: "福星公園", lat: 25.09, lng: 121.52 }));
    const b = mapsUrl(place({ name: "福星公園", lat: 25.04, lng: 121.5 }));
    expect(a).not.toBe(b);
  });

  it("名稱裡的斜線被編碼，不會被讀成路徑結構", () => {
    const url = mapsUrl(place({ name: "公園/廣場" }));
    expect(url).not.toContain("公園/廣場");
    expect(url).toContain("%2F");
    // 路徑上只能有一個 /@ 分隔點
    expect(url.match(/\/@/g)).toHaveLength(1);
  });

  it("空白與括號也編碼", () => {
    const url = mapsUrl(place({ name: "住六(公一)公園" }));
    expect(url).toContain(encodeURIComponent("住六(公一)公園"));
  });

  it("座標固定小數位，不會出現科學記號或超長尾數", () => {
    const url = mapsUrl(place({ lat: 25.1, lng: 121.5 }));
    expect(url).toContain("25.100000,121.500000");
  });
});

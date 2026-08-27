import { describe, expect, it } from "vitest";

import { parseResources, pickResource, ResourceNotFoundError } from "./catalog";

/** 148726「桃園市公園」的真實 metadata 形狀：一個編號掛兩份語意不同的 CSV。 */
const taoyuanParks = {
  success: true,
  result: {
    title: "桃園市公園",
    distribution: [
      {
        resourceFormat: "CSV",
        resourceDescription: "埤塘公園",
        resourceDownloadUrl: "https://opendata.tycg.gov.tw/…/eff0b4d8/download",
      },
      {
        resourceFormat: "CSV",
        resourceDescription: "特色遊戲場",
        resourceDownloadUrl: "https://opendata.tycg.gov.tw/…/cc8663dc/download",
      },
    ],
  },
};

describe("資料集資源解析", () => {
  it("解析出格式、名稱與下載網址", () => {
    expect(parseResources(taoyuanParks)).toEqual([
      { format: "CSV", description: "埤塘公園", downloadUrl: expect.stringContaining("eff0b4d8") },
      { format: "CSV", description: "特色遊戲場", downloadUrl: expect.stringContaining("cc8663dc") },
    ]);
  });

  it("沒有下載網址的資源被略過", () => {
    const resources = parseResources({
      result: { distribution: [{ resourceFormat: "CSV", resourceDescription: "壞掉的" }] },
    });
    expect(resources).toEqual([]);
  });

  it("metadata 結構不如預期時回傳空陣列而不是丟錯", () => {
    expect(parseResources(null)).toEqual([]);
    expect(parseResources({})).toEqual([]);
  });
});

describe("挑選資源（docs/資料來源盤點.md 的實測教訓）", () => {
  const resources = parseResources(taoyuanParks);

  it("依名稱挑出正確的那一份", () => {
    expect(pickResource(resources, "148726", "特色遊戲場").downloadUrl).toContain("cc8663dc");
  });

  it("有多份資源卻沒指定名稱時丟錯，不默默取第一份", () => {
    // 默默取第一份會拿到埤塘公園（10 筆）而不是特色遊戲場（45 筆），
    // 而且錯得很像對的——這正是要用測試守住的那種失敗。
    expect(() => pickResource(resources, "148726")).toThrow(ResourceNotFoundError);
  });

  it("只有一份資源時允許不指定名稱", () => {
    const single = parseResources({
      result: {
        distribution: [
          { resourceFormat: "CSV", resourceDescription: "新北市公園", resourceDownloadUrl: "https://x/y" },
        ],
      },
    });
    expect(pickResource(single, "124566").downloadUrl).toBe("https://x/y");
  });

  it("指定的名稱不存在時，錯誤訊息列出目前有哪些資源", () => {
    // 資料集改版時資源會被改名，錯誤訊息要讓人一眼看出該改成什麼。
    expect(() => pickResource(resources, "148726", "兒童遊戲場")).toThrow(/埤塘公園[\s\S]*特色遊戲場/);
  });
});

import { describe, expect, it } from "vitest";

import { mergeGeocodeTables, parseTgosResult } from "./geocode";

const header = "id,Address,Response_Address,Response_X,Response_Y";

describe("TGOS 結果檔", () => {
  it("解析出地址對應的座標", () => {
    const table = parseTgosResult(
      `${header}\n1,新北市板橋區漢生東路258號2樓,新北市板橋區漢生東路258號,121.4628,25.0118`,
    );
    expect(table.lookup("新北市板橋區漢生東路258號2樓")).toEqual({ lat: 25.0118, lng: 121.4628 });
  });

  it("X 與 Y 顛倒時自動修正", () => {
    // EPSG:4326 之下 X 應為經度，但這件事拿到第一份真實結果檔之前無法確認。
    // 顛倒的症狀很難看出來——臺灣的經緯度都是正數，反過來仍像座標，
    // 只是落在阿拉伯半島。
    const table = parseTgosResult(`${header}\n1,某地址,某地址,25.0118,121.4628`);
    expect(table.lookup("某地址")).toEqual({ lat: 25.0118, lng: 121.4628 });
  });

  it("落在臺灣範圍外的座標視為比對失敗，不硬塞", () => {
    const table = parseTgosResult(`${header}\n1,某地址,,0,0`);
    expect(table.lookup("某地址")).toBeNull();
    expect(table.unmatched).toEqual(["某地址"]);
  });

  it("TGOS 比對不到時座標欄是空的，記入 unmatched", () => {
    const table = parseTgosResult(`${header}\n1,查不到的地址,,,`);
    expect(table.unmatched).toEqual(["查不到的地址"]);
    expect(table.entries.size).toBe(0);
  });

  it("比對用的是我們送出去的地址，不是 TGOS 回傳的正規化地址", () => {
    // 送出去的是「…258號2樓」，TGOS 回「…258號」。
    // 用回傳值當 key 的話，匯入器拿原始地址就查不到了。
    const table = parseTgosResult(
      `${header}\n1,新北市板橋區漢生東路258號2樓,新北市板橋區漢生東路258號,121.4628,25.0118`,
    );
    expect(table.lookup("新北市板橋區漢生東路258號2樓")).not.toBeNull();
    expect(table.lookup("新北市板橋區漢生東路258號")).toBeNull();
  });

  it("地址裡的空白不影響比對", () => {
    const table = parseTgosResult(`${header}\n1,新北市 板橋區 漢生東路258號,,121.4628,25.0118`);
    expect(table.lookup("新北市板橋區漢生東路258號")).not.toBeNull();
  });
});

describe("合併多份結果檔", () => {
  it("兩份檔案的地址都查得到", () => {
    const a = parseTgosResult(`${header}\n1,甲地址,,121.5,25.0`);
    const b = parseTgosResult(`${header}\n1,乙地址,,121.6,25.1`);
    const merged = mergeGeocodeTables([a, b]);
    expect(merged.entries.size).toBe(2);
    expect(merged.lookup("甲地址")).not.toBeNull();
    expect(merged.lookup("乙地址")).not.toBeNull();
  });

  it("後面的檔案覆蓋前面的同名地址", () => {
    const a = parseTgosResult(`${header}\n1,甲地址,,121.5,25.0`);
    const b = parseTgosResult(`${header}\n1,甲地址,,121.6,25.1`);
    expect(mergeGeocodeTables([a, b]).lookup("甲地址")).toEqual({ lat: 25.1, lng: 121.6 });
  });

  it("在別份檔案裡查到的地址，不再算比對失敗", () => {
    // 重跑一次批次比對來補齊漏網的地址時就是這個情況。
    const first = parseTgosResult(`${header}\n1,甲地址,,,`);
    const retry = parseTgosResult(`${header}\n1,甲地址,,121.5,25.0`);
    expect(mergeGeocodeTables([first, retry]).unmatched).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import { base64UrlToBytes } from "./base64url";

describe("base64UrlToBytes", () => {
  it("解出原本的位元組", () => {
    // "Hi!" 的 base64 是 "SGkh"
    expect([...base64UrlToBytes("SGkh")]).toEqual([72, 105, 33]);
  });

  it("補回被去掉的 = ——base64url 沒有補位字元", () => {
    // "Hi" 的標準 base64 是 "SGk="，base64url 形式沒有那個 =
    expect([...base64UrlToBytes("SGk")]).toEqual([72, 105]);
  });

  it("把 - 與 _ 換回 + 與 /，否則金鑰會解成錯的位元組", () => {
    expect([...base64UrlToBytes("-_8")]).toEqual([251, 255]);
  });

  it("VAPID 公鑰長度是 65 位元組（未壓縮的 P-256 公鑰）", () => {
    // 87 個字元的 base64url 正好對應 65 位元組——長度不對時
    // subscribe() 會丟 InvalidAccessError，而那個訊息指不到金鑰本身
    const key = "B" + "A".repeat(86);

    expect(base64UrlToBytes(key)).toHaveLength(65);
  });
});

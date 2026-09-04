import { describe, expect, it } from "vitest";

import { parseSubscription, subscriptionId } from "./subscription";

const valid = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  keys: { p256dh: "BM9...", auth: "k1..." },
};

describe("parseSubscription", () => {
  it("形狀正確時原樣回傳", () => {
    expect(parseSubscription(valid)).toEqual(valid);
  });

  it("只取需要的三個欄位，多餘的欄位不會被存進資料庫", () => {
    const parsed = parseSubscription({ ...valid, expirationTime: null, extra: "x" });

    expect(parsed).toEqual(valid);
  });

  it("endpoint 不是 https 時拒絕——伺服器會直接打這個位址", () => {
    expect(parseSubscription({ ...valid, endpoint: "http://evil.example/x" })).toBeNull();
    expect(parseSubscription({ ...valid, endpoint: "file:///etc/passwd" })).toBeNull();
  });

  it("缺少加密金鑰時拒絕，不存半套訂閱", () => {
    expect(parseSubscription({ endpoint: valid.endpoint })).toBeNull();
    expect(
      parseSubscription({ endpoint: valid.endpoint, keys: { p256dh: "BM9..." } }),
    ).toBeNull();
  });

  it("不是物件時回 null 而不是丟例外", () => {
    expect(parseSubscription(null)).toBeNull();
    expect(parseSubscription("https://fcm.googleapis.com/fcm/send/abc")).toBeNull();
    expect(parseSubscription(undefined)).toBeNull();
  });
});

describe("subscriptionId", () => {
  it("同一個 endpoint 得到同一個 id——重新訂閱會覆蓋而不是新增一列", () => {
    expect(subscriptionId(valid.endpoint)).toBe(subscriptionId(valid.endpoint));
  });

  it("不同 endpoint 得到不同 id", () => {
    expect(subscriptionId(valid.endpoint)).not.toBe(
      subscriptionId("https://fcm.googleapis.com/fcm/send/zzz999"),
    );
  });
});

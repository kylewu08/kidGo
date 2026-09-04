import { describe, expect, it } from "vitest";

import { readVapidConfig } from "./vapid";

describe("readVapidConfig", () => {
  it("兩把金鑰都有時回傳設定", () => {
    const config = readVapidConfig({
      VAPID_PUBLIC_KEY: "pub",
      VAPID_PRIVATE_KEY: "priv",
      VAPID_SUBJECT: "mailto:someone@example.com",
    });

    expect(config).toEqual({
      publicKey: "pub",
      privateKey: "priv",
      subject: "mailto:someone@example.com",
    });
  });

  it("只設了公鑰時回傳 null，不是半套設定", () => {
    expect(readVapidConfig({ VAPID_PUBLIC_KEY: "pub" })).toBeNull();
  });

  it("完全沒設時回傳 null，而不是丟例外", () => {
    expect(readVapidConfig({})).toBeNull();
  });

  it("金鑰是空白字串時視同沒設", () => {
    expect(
      readVapidConfig({ VAPID_PUBLIC_KEY: "  ", VAPID_PRIVATE_KEY: "priv" }),
    ).toBeNull();
  });

  it("沒設 subject 時退回站台位址，不讓 web-push 因缺欄位而丟錯", () => {
    const config = readVapidConfig({
      VAPID_PUBLIC_KEY: "pub",
      VAPID_PRIVATE_KEY: "priv",
    });

    expect(config?.subject).toMatch(/^https:\/\//);
  });
});

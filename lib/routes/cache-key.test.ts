/**
 * 分桶規則的規格。
 *
 * 這些測試守的是帳單與正確性：桶切錯了不會有任何錯誤訊息，
 * 只會讓快取永遠不命中（錢），或讓車程悄悄變成別的時段的值（錯）。
 */

import { describe, expect, it } from "vitest";

import {
  departureBucket,
  isExpired,
  routeCacheId,
  ROUTE_CACHE_MAX_AGE_DAYS,
} from "./cache-key";

describe("出發時刻分桶", () => {
  it("同一小時內的不同分秒落在同一個桶", () => {
    const a = departureBucket(new Date("2026-09-05T09:05:00"));
    const b = departureBucket(new Date("2026-09-05T09:35:59"));
    expect(a).toBe(b);
  });

  it("跨小時是不同的桶——9 點與 11 點的路況不一樣", () => {
    const a = departureBucket(new Date("2026-09-05T09:00:00"));
    const b = departureBucket(new Date("2026-09-05T11:00:00"));
    expect(a).not.toBe(b);
  });

  /** 跨日重用看似省錢，實際上是拿別天的路況充當今天的。 */
  it("不同日期的同一時刻是不同的桶", () => {
    const sat = departureBucket(new Date("2026-09-05T09:00:00"));
    const wed = departureBucket(new Date("2026-09-09T09:00:00"));
    expect(sat).not.toBe(wed);
  });

  it("月與日補零，字串長度固定", () => {
    expect(departureBucket(new Date("2026-01-02T03:00:00"))).toBe("2026-01-02T03");
  });
});

describe("快取鍵", () => {
  it("去程與回程是兩筆，不會互相覆蓋", () => {
    const bucket = departureBucket(new Date("2026-09-05T09:00:00"));
    expect(routeCacheId("p1", "outbound", bucket)).not.toBe(
      routeCacheId("p1", "return", bucket),
    );
  });

  it("不同地點不會共用同一筆", () => {
    const bucket = departureBucket(new Date("2026-09-05T09:00:00"));
    expect(routeCacheId("p1", "outbound", bucket)).not.toBe(
      routeCacheId("p2", "outbound", bucket),
    );
  });
});

describe("30 天上限（ADR-0013）", () => {
  const now = new Date("2026-09-05T09:00:00");

  it("剛存的沒過期", () => {
    expect(isExpired(new Date("2026-09-05T08:00:00"), now)).toBe(false);
  });

  it("29 天前的還在期限內", () => {
    const d = new Date(now.getTime() - 29 * 24 * 3600_000);
    expect(isExpired(d, now)).toBe(false);
  });

  it("31 天前的過期", () => {
    const d = new Date(now.getTime() - 31 * 24 * 3600_000);
    expect(isExpired(d, now)).toBe(true);
  });

  it("上限就是 ADR-0013 寫的 30 天，不是隨手挑的數字", () => {
    expect(ROUTE_CACHE_MAX_AGE_DAYS).toBe(30);
  });
});

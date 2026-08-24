/**
 * Route Matrix 回應解析的規格（ADR-0005）
 *
 * ⚠️ **與 lib/weather 的測試不同，這裡的資料是照官方文件規格手寫的，
 * 不是真實 API 回應。** 撰寫當下還沒有 Google Cloud 金鑰。
 *
 * 這是一個已知的弱點：手寫的 payload 測的是我對規格的理解，不是對方實際的行為。
 * **拿到金鑰後應該實際打一次，把真實回應存成 fixture 取代這裡的常數**，
 * 就像 lib/weather/__tests__/banqiao-sample.json 那樣。
 */

import { describe, expect, it } from "vitest";

import { parseRouteMatrix, type RouteDestination } from "../matrix";

const destinations: RouteDestination[] = [
  { id: "park", lat: 25.0299, lng: 121.5361 },
  { id: "museum", lat: 25.0975, lng: 121.5487 },
  { id: "farm", lat: 24.9, lng: 121.2 },
];

describe("解析 Route Matrix 回應", () => {
  it("把每個元素依 destinationIndex 對回 placeId", () => {
    const result = parseRouteMatrix(
      [
        { originIndex: 0, destinationIndex: 0, duration: "900s", condition: "ROUTE_EXISTS" },
        { originIndex: 0, destinationIndex: 1, duration: "1500s", condition: "ROUTE_EXISTS" },
      ],
      destinations,
    );

    expect(result.get("park")).toBe(15);
    expect(result.get("museum")).toBe(25);
  });

  it("回應順序與請求順序不同時仍然對得起來", () => {
    // Route Matrix 邊算邊回傳，順序不保證。靠 index 對應而不是位置，
    // 這條測試就是把「不可以依賴順序」這件事釘住。
    const result = parseRouteMatrix(
      [
        { destinationIndex: 2, duration: "3600s", condition: "ROUTE_EXISTS" },
        { destinationIndex: 0, duration: "900s", condition: "ROUTE_EXISTS" },
        { destinationIndex: 1, duration: "1500s", condition: "ROUTE_EXISTS" },
      ],
      destinations,
    );

    expect(result.get("park")).toBe(15);
    expect(result.get("museum")).toBe(25);
    expect(result.get("farm")).toBe(60);
  });

  it("秒數換算成分鐘並四捨五入", () => {
    const result = parseRouteMatrix(
      [
        { destinationIndex: 0, duration: "1000s", condition: "ROUTE_EXISTS" }, // 16.67 分
        { destinationIndex: 1, duration: "1010s", condition: "ROUTE_EXISTS" }, // 16.83 分
      ],
      destinations,
    );

    expect(result.get("park")).toBe(17);
    expect(result.get("museum")).toBe(17);
  });

  it("算不出路線的地點不放進結果，讓呼叫端退回基準值", () => {
    // 缺席代表「用 Place.driveMinutes」。這是 ADR-0005 的後備機制，
    // 不是錯誤處理——沒網路或算不出來時使用者仍然要拿得到建議。
    const result = parseRouteMatrix(
      [
        { destinationIndex: 0, duration: "900s", condition: "ROUTE_EXISTS" },
        { destinationIndex: 1, condition: "ROUTE_NOT_FOUND" },
      ],
      destinations,
    );

    expect(result.get("park")).toBe(15);
    expect(result.has("museum")).toBe(false);
  });

  it("有錯誤狀態的元素被跳過", () => {
    const result = parseRouteMatrix(
      [
        { destinationIndex: 0, condition: "ROUTE_EXISTS", duration: "900s" },
        { destinationIndex: 1, status: { code: 3, message: "invalid" } },
      ],
      destinations,
    );

    expect(result.size).toBe(1);
  });

  it("duration 缺失或格式不對時跳過，不當成 0 分鐘", () => {
    // 0 分鐘會讓這個地點在車程評分拿滿分並輕鬆通過 Stage 1——
    // 一個「解析失敗」變成「強力推薦」是最糟的失敗模式。
    const result = parseRouteMatrix(
      [
        { destinationIndex: 0, condition: "ROUTE_EXISTS" },
        { destinationIndex: 1, condition: "ROUTE_EXISTS", duration: "abc" },
      ],
      destinations,
    );

    expect(result.size).toBe(0);
  });

  it("destinationIndex 超出範圍時跳過，不會爆掉", () => {
    const result = parseRouteMatrix(
      [{ destinationIndex: 99, duration: "900s", condition: "ROUTE_EXISTS" }],
      destinations,
    );

    expect(result.size).toBe(0);
  });

  it("空回應得到空的 Map，全部退回基準值", () => {
    expect(parseRouteMatrix([], destinations).size).toBe(0);
  });
});

/**
 * Route Matrix 回應解析的規格（ADR-0005）
 *
 * 主要路徑吃的是 2026-08-24 從 Google Routes API 真實抓回來的回應
 * （route-matrix-sample.json，起點板橋區，四個台北近郊地點）。
 *
 * 錯誤與邊界情境仍是手寫的：那些狀況（ROUTE_NOT_FOUND、duration 格式錯誤、
 * index 超出範圍）沒辦法穩定地從真實 API 誘發出來。分界清楚寫在各個 describe。
 */

import { describe, expect, it } from "vitest";

import { parseRouteMatrix, type RouteDestination } from "../matrix";
import sample from "./route-matrix-sample.json";

/** 對應擷取 fixture 時送出的目的地順序 */
const realDestinations: RouteDestination[] = [
  { id: "daan-park", lat: 25.0299, lng: 121.5361 },
  { id: "taipei-kids", lat: 25.0955, lng: 121.5148 },
  { id: "yangmingshan", lat: 25.1553, lng: 121.5453 },
  { id: "bitan", lat: 24.9573, lng: 121.5378 },
];

const destinations: RouteDestination[] = [
  { id: "park", lat: 25.0299, lng: 121.5361 },
  { id: "museum", lat: 25.0975, lng: 121.5487 },
  { id: "farm", lat: 24.9, lng: 121.2 },
];

describe("解析真實回應", () => {
  it("把每個元素依 destinationIndex 對回 placeId", () => {
    const result = parseRouteMatrix(sample, realDestinations);

    // 真實值：1076s / 978s / 2584s / 1383s
    expect(result.get("daan-park")).toBe(18);
    expect(result.get("taipei-kids")).toBe(16);
    expect(result.get("yangmingshan")).toBe(43);
    expect(result.get("bitan")).toBe(23);
  });

  it("回應順序與請求順序不同時仍然對得起來", () => {
    // 這不是假設性的防禦。擷取這份 fixture 時，送出的目的地順序是 0,1,2,3，
    // Google 回來的順序是 1,3,0,2——Route Matrix 邊算邊回傳，順序不保證。
    expect(sample.map((e) => e.destinationIndex)).toEqual([1, 3, 0, 2]);

    const result = parseRouteMatrix(sample, realDestinations);
    expect(result.get("daan-park")).toBe(18); // destinationIndex 0，卻排在回應第三個
  });

  it("每一筆都算得出路線，四個目的地全都在結果裡", () => {
    expect(parseRouteMatrix(sample, realDestinations).size).toBe(4);
  });
});

describe("解析（手寫情境）", () => {

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

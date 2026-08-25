/**
 * 幾何車程估計（ADR-0013、ADR-0014）
 *
 * 匯入階段不呼叫 Google，所以基準車程由座標即時導出。
 *
 * **這不是離線後備，是每次決策的主力**：§7.1 的粗篩對「全部地點」使用它，
 * 精算只碰存活的前 8 名。所以它處理絕大多數的地點，
 * 而且它算錯的地點 Google 根本沒機會看到——會在粗篩被無聲剔除。
 *
 * **估計求準，不刻意偏移**（ADR-0014）。誤差容忍度集中在粗篩門檻那一個參數，
 * 不散在估計公式裡——否則會有兩層無法單獨調整的緩衝。
 */

import type { DayType } from "@/lib/db/schema";
import { driveCoefficient } from "./day-type";

const EARTH_RADIUS_KM = 6371;

export const DRIVE_ESTIMATE = {
  /**
   * 繞路係數：實際路程 ÷ 直線距離。
   * 台灣西部平原都會區的經驗值約 1.3，山區更高。
   */
  detourFactor: 1.3,
  /** 平均行駛速度（km/h），無壅塞狀態。市區與快速道路混合。 */
  averageSpeedKmh: 35,
  /**
   * 超過這個直線距離（km）就視為需要走國道（ADR-0014 Q2）。
   * 粗且會錯，但它只影響一個係數。
   */
  freewayDistanceKm: 18,
} as const;

/** 兩點間的大圓距離（公里） */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** 匯入時判定是否走國道。純距離啟發式，見 ADR-0014。 */
export function inferUsesFreeway(distanceKm: number): boolean {
  return distanceKm > DRIVE_ESTIMATE.freewayDistanceKm;
}

/**
 * 基準車程（分鐘），含找車位時間。
 *
 * 不含日型係數——那是粗篩時才乘上去的，因為同一個地點在平日與連假
 * 有不同的估計值，而基準值本身應該是一個與日期無關的數字。
 */
export function baselineDriveMinutes(
  home: { lat: number; lng: number },
  place: { lat: number; lng: number; parkingSearchMinutes: number },
): number {
  const km = haversineKm(home, place) * DRIVE_ESTIMATE.detourFactor;
  const driving = (km / DRIVE_ESTIMATE.averageSpeedKmh) * 60;
  return Math.round(driving + place.parkingSearchMinutes);
}

/** 粗篩用的估計：基準車程 × 日型係數 */
export function coarseDriveMinutes(
  home: { lat: number; lng: number },
  place: { lat: number; lng: number; parkingSearchMinutes: number; usesFreeway: boolean },
  dayType: DayType,
): number {
  return Math.round(
    baselineDriveMinutes(home, place) * driveCoefficient(dayType, place.usesFreeway),
  );
}

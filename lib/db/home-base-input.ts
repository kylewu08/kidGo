/**
 * 出發點輸入的驗證（純函式）
 *
 * 與 Server Action 分開的理由：Action 會寫資料庫，測試它就得準備一個資料庫。
 * 驗證邏輯本身不需要——把它抽出來就能單獨測，這與推薦引擎是純函式的理由一樣。
 *
 * 這裡的驗證**不是在防惡意使用者**。這是單人使用的本機工具（P1），
 * 沒有攻擊者。它防的是**填錯而不自知**：縣市與鄉鎮對不起來的話，
 * 天氣會抓到錯的地方，而錯的天氣看起來永遠是「合理的」，
 * 不會有任何跡象讓你發現。
 */

import { COUNTY_DATASET_IDS, findTownship } from "@/lib/weather/townships";
import type { CountyName } from "@/lib/weather/townships";

/** 臺灣本島與離島的座標範圍，用來擋住明顯打錯的輸入 */
const TAIWAN_BOUNDS = { minLat: 21, maxLat: 26.5, minLng: 118, maxLng: 122.5 };

export interface HomeBaseInput {
  lat: number;
  lng: number;
  cwaCountyName: CountyName;
  cwaLocationName: string;
  maxDriveMinutes: number;
}

export type ValidationResult =
  | { ok: true; value: HomeBaseInput }
  | { ok: false; message: string };

/** 只讀字串的最小介面，這樣測試不必建構真的 FormData */
export interface RawHomeBaseInput {
  cwaCountyName: string;
  cwaLocationName: string;
  lat: string;
  lng: string;
  maxDriveMinutes: string;
}

export function validateHomeBaseInput(raw: RawHomeBaseInput): ValidationResult {
  const { cwaCountyName: county, cwaLocationName: township } = raw;

  if (!(county in COUNTY_DATASET_IDS)) {
    return { ok: false, message: `不認得的縣市「${county}」` };
  }
  // 成對驗證：鄉鎮名稱不唯一，東區橫跨四個縣市（ADR-0006）。
  if (!findTownship(county as CountyName, township)) {
    return { ok: false, message: `${county}沒有「${township}」` };
  }

  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, message: "座標必須是數字" };
  }
  if (
    lat < TAIWAN_BOUNDS.minLat ||
    lat > TAIWAN_BOUNDS.maxLat ||
    lng < TAIWAN_BOUNDS.minLng ||
    lng > TAIWAN_BOUNDS.maxLng
  ) {
    return { ok: false, message: "座標不在臺灣範圍內，緯度與經度可能填反了" };
  }

  const maxDriveMinutes = Number(raw.maxDriveMinutes);
  if (!Number.isInteger(maxDriveMinutes) || maxDriveMinutes <= 0) {
    return { ok: false, message: "車程上限必須是正整數（分鐘）" };
  }

  return {
    ok: true,
    value: {
      lat,
      lng,
      cwaCountyName: county as CountyName,
      cwaLocationName: township,
      maxDriveMinutes,
    },
  };
}

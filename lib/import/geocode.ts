/**
 * 地址 → 座標，來自 TGOS 批次門牌地址比對服務的結果檔。
 *
 * **這不是一個 API 整合，是一個離線流程**：
 *
 *   1. `scripts/export-geocode-requests.ts` 產生 TGOS 格式的 CSV
 *   2. 人工上傳到 https://www.tgos.tw/tgos/Addr/Compare（坐標系統選 EPSG:4326）
 *   3. TGOS 寄信通知，下載結果檔放進 `data/geocode/`
 *   4. 下次匯入時本模組讀它
 *
 * 為什麼是離線流程：即時 API（全國門牌地址定位服務）的申請資格限
 * 政府機關、法人、學術與業界；批次服務才開放個人。而這對本專案其實更好——
 * 憑證留在使用者手上、程式完全不碰，結果檔可長期保存
 * （不像 Google Geocoding 有 30 天快取限制，那正是 ADR-0013 的理由）。
 */

import { parseCsv } from "./csv";

/** 臺灣本島與離島的合理座標範圍，用來擋住座標軸顛倒與明顯的錯誤值。 */
const TAIWAN_BOUNDS = {
  minLat: 21.5,
  maxLat: 26.5,
  minLng: 118.0,
  maxLng: 122.5,
} as const;

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface GeocodeTable {
  /** key 是正規化後的地址。攤開而不是藏在 closure 裡，合併才不必猜。 */
  readonly entries: ReadonlyMap<string, Coordinates>;
  /** 有送出但 TGOS 比對不到的地址，供匯入報告使用 */
  readonly unmatched: readonly string[];
  lookup(address: string): Coordinates | null;
}

/** 地址的空白與全形空白不影響比對。 */
function normalizeAddress(address: string): string {
  return address.replace(/[\s\u3000]/g, "");
}

function inTaiwan(lat: number, lng: number): boolean {
  return (
    lat >= TAIWAN_BOUNDS.minLat &&
    lat <= TAIWAN_BOUNDS.maxLat &&
    lng >= TAIWAN_BOUNDS.minLng &&
    lng <= TAIWAN_BOUNDS.maxLng
  );
}

function tableOf(entries: Map<string, Coordinates>, unmatched: string[]): GeocodeTable {
  return {
    entries,
    unmatched,
    lookup: (address) => entries.get(normalizeAddress(address)) ?? null,
  };
}

/**
 * 解析 TGOS 結果檔。
 *
 * 欄位：`id, Address, Response_Address, Response_X, Response_Y`
 *
 * **座標軸自動判斷**：EPSG:4326 之下 X 應為經度、Y 為緯度，
 * 但這件事在拿到第一份真實結果檔之前無法確認，而弄反了的症狀很難看出來
 * ——臺灣的經緯度都是正數，顛倒之後仍然是一個「看起來像座標」的值，
 * 只是落在阿拉伯半島。所以用臺灣的範圍判斷方向，兩種都不成立就丟棄。
 */
export function parseTgosResult(csv: string): GeocodeTable {
  const entries = new Map<string, Coordinates>();
  const unmatched: string[] = [];

  for (const row of parseCsv(csv)) {
    const address = (row.Address ?? "").trim();
    if (address.length === 0) continue;

    const x = Number.parseFloat((row.Response_X ?? "").trim());
    const y = Number.parseFloat((row.Response_Y ?? "").trim());
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      unmatched.push(address);
      continue;
    }

    if (inTaiwan(y, x)) entries.set(normalizeAddress(address), { lat: y, lng: x });
    else if (inTaiwan(x, y)) entries.set(normalizeAddress(address), { lat: x, lng: y });
    else unmatched.push(address);
  }

  return tableOf(entries, unmatched);
}

/** 多份結果檔合併成一張表。後面的檔案覆蓋前面的同名地址。 */
export function mergeGeocodeTables(tables: readonly GeocodeTable[]): GeocodeTable {
  const entries = new Map<string, Coordinates>();
  const unmatched: string[] = [];

  for (const table of tables) {
    for (const [key, value] of table.entries) entries.set(key, value);
    // 在別的檔案裡查到的，就不算比對不到了。
    for (const address of table.unmatched) {
      if (!entries.has(normalizeAddress(address))) unmatched.push(address);
    }
  }

  return tableOf(
    entries,
    unmatched.filter((address) => !entries.has(normalizeAddress(address))),
  );
}

export const EMPTY_GEOCODE_TABLE: GeocodeTable = tableOf(new Map(), []);

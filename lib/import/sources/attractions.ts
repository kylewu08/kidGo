/**
 * 觀光資訊資料庫－景點（資料集 7777）：**只收博物館／美術館**
 *
 * 全國 6189 筆、每日更新、`PositionLat/Lon` 100% 有值（不需要 geocoding），
 * 是盤點裡唯一的全國級空間資料。但**絕大多數只帶名稱與座標**——
 * 正是 ADR-0019 的入場測試要擋的那種：
 *
 * > 一個只有先驗值的地點會擠掉一個真的有資料的地點（Stage 2 只精算前 8 名）
 *
 * 2026-09-02 抓下來實測的填充率：
 *
 * ```
 * VisitDuration   2%（全國 177/6189）
 * Facilities      1%
 * LocatedCities   0%   ← 所以用 PostalAddress.City 篩，不是這個欄位
 * ```
 *
 * ## 為什麼不靠 AttractionClasses 分類
 *
 * 它 100% 有值，但語意是髒的。北部最大的代碼 12（671 筆）同時包含
 * 「橘之鄉蜜餞形象館、休閒養殖場、精雕藝術館、五峰旗風景區、跑馬古道、
 * 溫泉廣場、瀑布、石磐步道」——蜜餞、藝術館、瀑布、步道在同一格。
 * **不能拿來映射類別。**
 *
 * ## 所以只收博物館，用名稱關鍵字
 *
 * 名稱裡出現「博物館／美術館／科教館」而實際不是的機率很低，
 * 規則式、可測、錯了看得出來（同 derivation.ts 解析遊具清單的作法）。
 *
 * 步道 107 筆、農場 18 筆、海邊 **4 筆**都查過了：步道對幼兒多半過不了
 * 適齡與家長負擔，農場與海邊的量少到補不上任何缺口。**投入產出比太差，
 * 刻意不做**——而不是忘了做。
 *
 * 博物館值得做的理由是覆蓋率診斷：五個情境有三個未達標，缺口都指向
 * 「室內選項只有圖書館一種」。博物館室內、有冷氣、放電低，正好補那一格。
 */

import type { SourceRecord } from "../types";

export const ATTRACTIONS_DATASET_ID = "7777";

/** ADR-0019 的範圍。用 PostalAddress.City 判斷，不用座標框。 */
const NORTHERN_CITIES = new Set(["臺北市", "台北市", "新北市", "桃園市", "基隆市"]);

/**
 * 名稱關鍵字。**寧可漏收不要誤收**——
 * 誤收一個假博物館會讓引擎以為有一張室內的牌，而它其實不是。
 */
const MUSEUM_NAME = /博物館|美術館|科教館|科學館|故事館|紀念館|文物館/;

interface PostalAddress {
  City?: string;
  Town?: string;
  StreetAddress?: string;
}

export interface AttractionEntry {
  AttractionID?: string;
  AttractionName?: string;
  PositionLat?: number | string;
  PositionLon?: number | string;
  PostalAddress?: PostalAddress | string;
  /** 分鐘，字串。全國只有 2% 有值。 */
  VisitDuration?: string | number | null;
}

export interface AttractionFile {
  Attractions?: AttractionEntry[];
}

function coordinate(raw: number | string | undefined): number | null {
  const value = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? "").trim());
  return Number.isFinite(value) && value !== 0 ? value : null;
}

function addressOf(postal: PostalAddress | string | undefined): {
  city: string | null;
  full: string;
} {
  if (typeof postal === "string") return { city: null, full: postal.trim() };
  if (!postal) return { city: null, full: "" };
  const parts = [postal.City, postal.Town, postal.StreetAddress].filter(Boolean);
  return { city: postal.City ?? null, full: parts.join("") };
}

/**
 * 停留時長。全國只有 2% 有值，但有值的那些是**來源實值**，
 * 會蓋掉類別先驗並在 fieldSources 標成 source_data。
 *
 * 擋掉 0 與離譜的值：來源是人填的，而一個 0 分鐘的停留會讓時間軸崩掉，
 * 且不會有任何錯誤訊息。
 */
function visitDuration(raw: string | number | null | undefined): number | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  const value = typeof raw === "number" ? raw : Number.parseInt(String(raw).trim(), 10);
  if (!Number.isInteger(value) || value < 10 || value > 480) return undefined;
  return value;
}

export function toSourceRecords(file: AttractionFile): SourceRecord[] {
  const records: SourceRecord[] = [];

  for (const entry of file.Attractions ?? []) {
    const name = (entry.AttractionName ?? "").trim();
    if (!name || !MUSEUM_NAME.test(name)) continue;

    const { city, full } = addressOf(entry.PostalAddress);
    if (!city || !NORTHERN_CITIES.has(city)) continue;

    const lat = coordinate(entry.PositionLat);
    const lng = coordinate(entry.PositionLon);
    // 沒有座標就算不出車程，Stage 1 無從過濾。這個資料集 100% 有座標，
    // 所以真的沒有時代表資料異常，跳過而不是硬塞一個 null 進去。
    if (lat === null || lng === null) continue;

    const sourceId = (entry.AttractionID ?? "").trim();
    if (!sourceId) continue;

    const duration = visitDuration(entry.VisitDuration);

    records.push({
      sourceDataset: "tourism_spot",
      sourceId,
      name,
      address: full,
      lat,
      lng,
      category: "museum",
      observed: duration === undefined ? {} : { typicalDurationMinutes: duration },
    });
  }

  return records;
}

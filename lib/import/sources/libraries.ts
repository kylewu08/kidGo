/**
 * 公共圖書館基本資料（資料集 99567，國立公共資訊圖書館）
 *
 * 616 筆、全國、**全部自帶經緯度**，不需要 geocoding。
 * 這是 §7.3「備案至少一個室內選項」目前唯一填得滿的來源（ADR-0020）。
 *
 * **不依縣市篩選。** ADR-0019 的「範圍限北部四縣市」講的是
 * 我們為哪些縣市寫 adapter，不是在全國資料集裡再切一刀——
 * 這一份本來就是一次下載全拿，切開來反而多一組會過期的縣市名單。
 * 半徑是查詢時的條件（ADR-0017）。
 *
 * 決策欄位全部來自類別先驗：來源只有名稱、地址、電話、座標、簡介。
 * 這是 ADR-0020 明文接受的代價——有一張品質普通的牌，好過雨天沒有牌。
 */

import type { SourceRecord } from "../types";

export const LIBRARIES_DATASET_ID = "99567";

export interface LibraryEntry {
  Name?: string;
  Area?: string;
  Address?: string;
  Longitude?: number | string;
  Latitude?: number | string;
}

export interface LibraryCountyGroup {
  縣市?: string;
  圖書館資訊?: LibraryEntry[];
}

function parseCoordinate(raw: number | string | undefined): number | null {
  const value = typeof raw === "number" ? raw : Number.parseFloat((raw ?? "").trim());
  return Number.isFinite(value) && value !== 0 ? value : null;
}

/**
 * 來源沒有主鍵，所以合成一個。
 *
 * 用縣市＋行政區＋館名而不只用館名：「總館」「中正分館」這類名稱
 * 在不同縣市會重複，只用館名會讓兩間不同的圖書館被當成同一筆而互相覆蓋。
 *
 * ⚠️ 這個鍵**依賴館名不變**。館名一改，重跑匯入會產生一筆新的地點，
 * 舊的那筆則被標記為來源已移除（不刪除，可能已有造訪紀錄）。
 */
export function sourceIdOf(county: string, entry: LibraryEntry): string {
  return [county, (entry.Area ?? "").trim(), (entry.Name ?? "").trim()]
    .filter((part) => part.length > 0)
    .join("-");
}

export function toSourceRecords(groups: readonly LibraryCountyGroup[]): SourceRecord[] {
  const records: SourceRecord[] = [];

  for (const group of groups) {
    const county = (group.縣市 ?? "").trim();
    for (const entry of group.圖書館資訊 ?? []) {
      const name = (entry.Name ?? "").trim();
      if (name.length === 0) continue;

      records.push({
        sourceDataset: "library",
        sourceId: sourceIdOf(county, entry),
        name,
        address: (entry.Address ?? "").trim(),
        lat: parseCoordinate(entry.Latitude),
        lng: parseCoordinate(entry.Longitude),
        category: "library",
        observed: {},
      });
    }
  }

  return records;
}

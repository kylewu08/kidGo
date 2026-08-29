/**
 * 全國親子館（托育資源中心）名冊（資料集 160907，衛福部社會及家庭署）
 *
 * 201 筆、全國，北部四縣市 102 筆。**沒有座標**，只有地址——
 * 但 199/201 是正規門牌號（北部四縣市 102/102 全部是），
 * 所以 TGOS 批次比對能處理，不像公園那種「路口」「純路名」的地址。
 *
 * 決策欄位全部來自類別先驗：來源只有縣市、區域、名稱、地址、電話、成立時間。
 * 它靠類別豁免通過入場測試——「0–6 歲專用、室內、免費」這件事本身
 * 就是 Google 的分類到不了的粒度（ADR-0019、ADR-0020）。
 *
 * §7.3 的備案槽位要的就是這種牌。
 */

import { parseCsv } from "../csv";
import type { SourceRecord } from "../types";

export const PARENTING_CENTERS_DATASET_ID = "160907";

const COUNTY = "縣市";
const DISTRICT = "區域";
const NAME = "親子館(托育資源中心)名稱";
const ADDRESS = "地址";

/**
 * 來源的「項次」只是列號，改版後會位移，所以合成主鍵。
 * 與圖書館同理：名稱跨縣市會重複。
 */
export function sourceIdOf(county: string, district: string, name: string): string {
  return [county, district, name]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("-");
}

export function toSourceRecords(csv: string): SourceRecord[] {
  const records: SourceRecord[] = [];

  for (const row of parseCsv(csv)) {
    const name = (row[NAME] ?? "").trim();
    const address = (row[ADDRESS] ?? "").trim();
    if (name.length === 0 || address.length === 0) continue;

    records.push({
      sourceDataset: "parenting_center",
      sourceId: sourceIdOf(row[COUNTY] ?? "", row[DISTRICT] ?? "", name),
      name,
      address,
      // 來源沒有座標，等 TGOS 批次比對補（lib/import/geocode.ts）。
      lat: null,
      lng: null,
      category: "parenting_center",
      observed: {},
    });
  }

  return records;
}

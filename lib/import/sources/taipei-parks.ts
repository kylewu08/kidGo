/**
 * 臺北市公園基本資料（資料集 128366）
 *
 * 目前品質最高的來源：815 筆全部有座標，且帶有公園面積、遊戲場類型
 * 與遊具清單——見 docs/資料來源盤點.md §3。
 *
 * ⚠️ **`pm_playeq` 欄位在來源端是壞的。** 每一筆都包含前面所有公園的
 * 遊具再串上自己的，到最後一筆累積成 1063 項（其中 310 個「組合遊具」，
 * 而那是一塊綠地）。實測 431/431 相鄰兩筆維持前綴關係、長度嚴格遞增，
 * 所以取相鄰差集可以還原每座公園真正的遊具（中位數 2 項）。
 *
 * 還原依賴兩個前提：陣列順序即累積順序，且這個 bug 尚未被修掉。
 * 因此 `recoverEquipment()` **每次都先驗證前綴性質，不成立就中止**——
 * 臺北哪天修好了，匯入器要大聲失敗，而不是默默把 1063 項遊具當成真值。
 */

import type { Category } from "@/lib/db/schema";

import { ageBandsFromEquipment, runnableSpaceFromAreaSqm } from "../derivation";
import type { ObservedFields, SourceRecord } from "../types";

export const TAIPEI_PARKS_DATASET_ID = "128366";

/** 只取用得到的欄位；來源另有二十餘個與決策無關的欄位。 */
export interface TaipeiParkRow {
  SeqNo?: string;
  pm_name?: string;
  pm_regions?: string;
  pm_location?: string;
  pm_Longitude?: string;
  pm_Latitude?: string;
  /** 公園 / 綠地 / 廣場 */
  pm_type?: string;
  /** 一般 / 共融 / 特色；空值代表沒有兒童遊戲場 */
  pm_playtype?: string;
  /** 公園面積（m²） */
  pm_LandPublicArea?: string;
  /** ⚠️ 累積值，須經 recoverEquipment() 還原 */
  pm_playeq?: string;
}

export class CumulativeShapeChangedError extends Error {
  constructor(index: number, name: string) {
    super(
      `臺北市公園基本資料的 pm_playeq 不再是累積值（第 ${index} 筆「${name}」破壞了前綴關係）。` +
        `這可能代表來源修好了這個 bug，或改變了排序。` +
        `請重新檢視 lib/import/sources/taipei-parks.ts 的還原邏輯，不要略過這個錯誤。`,
    );
    this.name = "CumulativeShapeChangedError";
  }
}

function splitEquipment(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * 還原每座公園真正的遊具清單。
 *
 * 回傳的 Map 以 `SeqNo` 為鍵。沒有 `pm_playeq` 的公園不會出現在 Map 裡——
 * 那代表「沒有兒童遊戲場」，與「有遊戲場但遊具辨識不出來」是不同的事。
 */
export function recoverEquipment(rows: readonly TaipeiParkRow[]): Map<string, string[]> {
  const recovered = new Map<string, string[]>();
  let previous: string[] = [];

  rows.forEach((row, index) => {
    const cumulative = splitEquipment(row.pm_playeq);
    if (cumulative.length === 0) return;

    const continuesPrevious =
      cumulative.length >= previous.length &&
      previous.every((item, i) => cumulative[i] === item);
    if (!continuesPrevious) {
      throw new CumulativeShapeChangedError(index, row.pm_name ?? "(無名稱)");
    }

    recovered.set(row.SeqNo ?? String(index), cumulative.slice(previous.length));
    previous = cumulative;
  });

  return recovered;
}

/**
 * `pm_type` × `pm_playtype` → 類別。
 *
 * `null` 代表這一筆不屬於本產品的任何領域類別，整筆略過。
 * 廣場就是這種：硬鋪面、多半無遮蔭，`Category` 的 11 個值裡沒有它的位置。
 * 但若廣場上有兒童遊戲場，那就以遊戲場論。
 */
export function categoryOf(row: TaipeiParkRow): Category | null {
  const playType = (row.pm_playtype ?? "").trim();
  if (playType === "共融" || playType === "特色") return "inclusive_playground";
  if (playType === "一般") return "park";

  const type = (row.pm_type ?? "").trim();
  if (type === "公園" || type === "綠地") return "park";
  return null;
}

function parseNumber(raw: string | undefined): number | null {
  const value = Number.parseFloat((raw ?? "").replace(/,/g, "").trim());
  return Number.isFinite(value) ? value : null;
}

export function toSourceRecords(rows: readonly TaipeiParkRow[]): SourceRecord[] {
  const equipmentBySeqNo = recoverEquipment(rows);
  const records: SourceRecord[] = [];

  rows.forEach((row, index) => {
    const category = categoryOf(row);
    if (!category) return;

    const lat = parseNumber(row.pm_Latitude);
    const lng = parseNumber(row.pm_Longitude);
    const sourceId = row.SeqNo ?? String(index);

    const observed: ObservedFields = {};

    const runnableSpace = runnableSpaceFromAreaSqm(parseNumber(row.pm_LandPublicArea) ?? 0);
    if (runnableSpace !== null) observed.runnableSpace = runnableSpace;

    const equipment = equipmentBySeqNo.get(sourceId);
    if (equipment) {
      const bands = ageBandsFromEquipment(equipment);
      // 推不出來時不寫入，讓類別先驗接手——見 derivation.ts 的說明。
      if (bands) observed.facilityAgeBands = bands;
    }

    records.push({
      sourceDataset: "park_facility",
      sourceId,
      name: (row.pm_name ?? "").trim(),
      address: (row.pm_location ?? "").trim(),
      lat,
      lng,
      category,
      observed,
    });
  });

  return records;
}

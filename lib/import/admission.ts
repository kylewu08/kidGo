/**
 * 入場測試（ADR-0019）
 *
 * > 一筆資料要進來，必須至少帶一個 Google Maps 查不到的欄位。
 *
 * 這是 §6.2 原則（「只記錄 Google Maps 和現有懶人包查不到的東西」）
 * 在匯入階段的具體化。它是決策邏輯（P7），所以每一條規則都有對應測試。
 *
 * **為什麼要有這道測試**：不套的話，觀光景點資料集 6076 筆會整包進來，
 * 而其中絕大多數只能提供名稱與座標——六個決策欄位全是類別先驗值，
 * 同類別、距離相近的兩個地點引擎無法區分。ADR-0013 已經指出過同型的機制：
 * Stage 2 只精算前 8 名，**一個只有先驗值的地點會擠掉一個真的有資料的地點**。
 */

import type { Category } from "@/lib/db/schema";
import type { ObservedFieldName, SourceRecord } from "./types";

/**
 * ADR-0019 第 2 條：類別本身即為強資訊的例外。
 *
 * **這份清單刻意只有兩項，而且必須維持列舉。**
 * 一旦允許「這個類別感覺也算」的解釋，整個測試就空了——
 * 每個類別都能講出一套「Google 分不到這個粒度」的說法。
 *
 * - `parenting_center`：「0–6 歲專用、室內、免費」。
 *   Google Maps 上多半只是一個地址，連營業性質都看不出來
 * - `inclusive_playground`：「共融」是法定標記，隱含安全封閉性與無障礙設計
 */
export const CATEGORIES_ADMITTED_ON_THEIR_OWN: readonly Category[] = [
  "parenting_center",
  "inclusive_playground",
] as const;

export type AdmissionVerdict =
  | { admitted: true; via: "observed_fields"; fields: ObservedFieldName[] }
  | { admitted: true; via: "category"; category: Category }
  | { admitted: false };

/**
 * 這一筆從來源讀到了哪些決策欄位。
 *
 * `ObservedFields` 只收「`places` 存得下」的欄位，這是刻意的：
 * 若用存不下的東西當入場憑證（例如票價——schema 沒有這個欄位），
 * 等於放進來一筆什麼都沒多帶的地點，測試就白做了。
 */
export function observedFieldNames(record: SourceRecord): ObservedFieldName[] {
  return (Object.keys(record.observed) as ObservedFieldName[]).filter(
    // null 是有意義的值（facilityAgeBands: null 代表「確認無遊具設施」），
    // 只有 undefined 才算沒讀到。
    (key) => record.observed[key] !== undefined,
  );
}

export function admit(record: SourceRecord): AdmissionVerdict {
  const fields = observedFieldNames(record);
  if (fields.length > 0) {
    return { admitted: true, via: "observed_fields", fields };
  }

  if (CATEGORIES_ADMITTED_ON_THEIR_OWN.includes(record.category)) {
    return { admitted: true, via: "category", category: record.category };
  }

  return { admitted: false };
}

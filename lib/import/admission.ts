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
 * ADR-0019 第 2 條：類別本身即為強資訊的例外。判準見 ADR-0020。
 *
 * 列入這份清單必須**同時**滿足兩條：
 *
 * 1. 該類別的先驗值組合本身就是強資訊，且 Google 的分類到不了那個粒度
 * 2. **移除該類別會在推薦輸出上造成結構性空缺**——
 *    §7.3 的三個槽位或 §7.4 的防同溫層會因此無法運作
 *
 * 第 2 條是真正的守門者。農場、步道、海邊都講得出一套「Google 分不到
 * 這個粒度」的說法，但少了它們，三個槽位照樣填得滿。
 *
 * - `parenting_center`：免費、室內、0–6 歲專用。Google 上多半只是一個地址
 * - `inclusive_playground`：「共融」是法定標記，隱含安全封閉性與無障礙設計
 * - `library`：免費、室內、有冷氣、低放電。**§7.3 的備案槽位要求
 *   至少一個室內選項**——2026-08-29 匯入 789 筆全戶外公園後，
 *   三個槽位只填得出一個，就是少了這一項（ADR-0020）
 * - `museum`：室內、有冷氣、放電低但可奔跑（§6.2 拿美術館當例子解釋
 *   為什麼需要「可奔跑空間」與「家長負擔」兩個欄位）。加入的證據是
 *   覆蓋率診斷：五個情境有三個未達標，缺口都指向「室內只有圖書館一種」
 *   （ADR-0027）
 *
 * ⚠️ **上面那句「農場、步道、海邊少了也照樣填得滿」已經被量測推翻。**
 * 寫的時候是假設三個槽位填得滿；2026-08-29 的診斷顯示五個情境有三個
 * 填不滿。所以判準第 2 條現在是**支持**再放類別進來的理由，不是反對。
 * 但仍要逐個看證據——步道 107 筆對幼兒過不了適齡、農場 18 筆、海邊 4 筆，
 * 那些補不上任何缺口（2026-09-02 實測），所以沒有加進來。
 */
export const CATEGORIES_ADMITTED_ON_THEIR_OWN: readonly Category[] = [
  "parenting_center",
  "inclusive_playground",
  "library",
  "museum",
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

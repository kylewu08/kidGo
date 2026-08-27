/**
 * 匯入器的中介型別（設計架構書 v1.0 §10.1、ADR-0019）
 *
 * 每個資料集的 adapter 把原始資料轉成 `SourceRecord`，之後的流程
 * （入場測試、套先驗值、upsert）都只認識這個型別，不再碰原始欄位。
 *
 * 這層存在的理由：**每個縣市的欄位語彙都不一樣。** 臺北叫 `pm_playeq`、
 * 桃園叫「設施」、基隆是一串代碼。若讓這些差異一路滲透到 upsert，
 * 加第五個縣市時就得改動所有下游。
 */

import type {
  AgeBand,
  Category,
  IndoorType,
  Level0to3,
  Rating,
  SourceDataset,
  TimeSlot,
} from "@/lib/db/schema";

/**
 * 來源直接讀到的決策欄位。**這些值會覆蓋類別先驗值**，
 * 並在 `fieldSources` 裡標記為非 `category_prior`。
 *
 * 只列出「開放資料真的供得起、而且 `places` 存得下」的欄位。
 * 存不下的東西（例如票價）不該進這裡——見 `admission.ts` 的說明。
 */
export interface ObservedFields {
  /** 觀光景點的 VisitDuration；§6.2「實際能撐多久」 */
  typicalDurationMinutes?: number;
  /** 由遊戲場面積或設施描述推導 */
  runnableSpace?: Level0to3;
  /** 由遊具清單推導 */
  facilityAgeBands?: AgeBand[] | null;
  indoorType?: IndoorType;
  hasAirConditioning?: boolean;
  shadeLevel?: Level0to3;
  safetyEnclosure?: Level0to3;
  strollerFriendly?: boolean;
  energyBurn?: Rating;
  parentEffort?: Rating;
  /** 由停車席位數推導 */
  parkingSearchMinutes?: number;
  /** 由開放時間推導 */
  bestTimeSlots?: TimeSlot[];
}

export type ObservedFieldName = keyof ObservedFields;

/**
 * 正規化後的來源資料，尚未套用類別先驗值。
 */
export interface SourceRecord {
  sourceDataset: SourceDataset;
  /** 該資料集內的原始主鍵。與 sourceDataset 合成外部唯一鍵。 */
  sourceId: string;
  name: string;
  address: string;
  /**
   * `null` 代表來源沒有座標，待 geocode。
   * 全國親子館名冊、新北市公園、桃園特色遊戲場都是這種。
   */
  lat: number | null;
  lng: number | null;
  category: Category;
  observed: ObservedFields;
  /** 來源自己標的更新時間，用於判斷是否需要重新套用 */
  sourceUpdatedAt?: string;
}

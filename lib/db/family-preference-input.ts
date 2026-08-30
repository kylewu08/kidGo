/**
 * 家庭偏好初始三題的驗證與預設值（設計架構書 §6.2）
 *
 * 與 Server Action 分開的理由同 home-base-input.ts：Action 會寫資料庫，
 * 驗證邏輯本身不需要，抽出來就測得到。
 *
 * 三題對應 §6.2 表格裡標明「來源：初始三題」的三個概念：
 * 戶外傾向、家長負擔上限、是否需含用餐。**類別權重不在這裡**——
 * 那是由回饋累積學習出來的，不能用問的（ADR-0018 的同一個理由：
 * 問出來的是審美偏好，不是行為偏好）。
 */

import type { FamilyPreference, Rating } from "./schema";

/**
 * 從未回答過三題時使用的值。
 *
 * **這三題必須有預設值，否則違反驗收標準一**——「僅輸入住家地址與小孩
 * 生日即可獲得三個合理推薦」。沒有預設值就等於強迫回答，那是 P1 明確
 * 排除的建檔行為。
 *
 * `maxParentEffort: 4` 是刻意寬鬆但不無上限：它是硬過濾條件，預設值訂太緊
 * 會在使用者不知情的狀況下砍掉候選。（2026-08-30 的資料庫裡沒有任何
 * parentEffort = 5 的地點，所以 4 與 5 目前結果相同；等農場、海灘一類
 * 進來之後才會有差別。）
 */
export const DEFAULT_FAMILY_PREFERENCE: FamilyPreference = {
  id: "default",
  outdoorTendency: 0,
  maxParentEffort: 4,
  requiresMeal: false,
};

/** 戶外傾向的範圍。五段而非連續值，UI 才講得清楚（ADR-0014）。 */
export const OUTDOOR_TENDENCY_MIN = -2;
export const OUTDOOR_TENDENCY_MAX = 2;

export interface FamilyPreferenceInput {
  outdoorTendency: number;
  maxParentEffort: Rating;
  requiresMeal: boolean;
}

export type ValidationResult =
  | { ok: true; value: FamilyPreferenceInput }
  | { ok: false; message: string };

/** 只讀字串的最小介面，這樣測試不必建構真的 FormData */
export interface RawFamilyPreferenceInput {
  outdoorTendency: string;
  maxParentEffort: string;
  requiresMeal: string;
}

export function validateFamilyPreferenceInput(
  raw: RawFamilyPreferenceInput,
): ValidationResult {
  const outdoorTendency = Number(raw.outdoorTendency);
  if (
    !Number.isInteger(outdoorTendency) ||
    outdoorTendency < OUTDOOR_TENDENCY_MIN ||
    outdoorTendency > OUTDOOR_TENDENCY_MAX
  ) {
    return {
      ok: false,
      message: `戶外傾向必須是 ${OUTDOOR_TENDENCY_MIN} 到 ${OUTDOOR_TENDENCY_MAX} 的整數`,
    };
  }

  const maxParentEffort = Number(raw.maxParentEffort);
  if (!Number.isInteger(maxParentEffort) || maxParentEffort < 1 || maxParentEffort > 5) {
    return { ok: false, message: "家長負擔上限必須是 1 到 5 的整數" };
  }

  /*
   * 未勾選的 checkbox 根本不會出現在 FormData 裡，所以「缺值」就是 false，
   * 不是錯誤。這裡不接受任意字串當真值——只認 "on"（原生 checkbox 的值）
   * 與 "true"，其餘一律視為否。
   */
  const requiresMeal = raw.requiresMeal === "on" || raw.requiresMeal === "true";

  return {
    ok: true,
    value: {
      outdoorTendency,
      maxParentEffort: maxParentEffort as Rating,
      requiresMeal,
    },
  };
}

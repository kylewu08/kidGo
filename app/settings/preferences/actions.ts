"use server";

import { revalidatePath } from "next/cache";

import { validateFamilyPreferenceInput } from "@/lib/db/family-preference-input";
import { getStoredFamilyPreference, saveFamilyPreference } from "@/lib/db/queries";

export interface SaveFamilyPreferenceState {
  status: "idle" | "saved" | "error";
  message?: string;
}

/**
 * 儲存家庭偏好三題。驗證邏輯在 lib/db/family-preference-input.ts，
 * 那是純函式所以測得到。
 */
export async function saveFamilyPreferenceAction(
  _prev: SaveFamilyPreferenceState,
  formData: FormData,
): Promise<SaveFamilyPreferenceState> {
  /*
   * 「是否需含用餐」目前不在畫面上（理由見 preferences-form.tsx 的註解），
   * 所以 FormData 裡沒有這個欄位。**不能就這樣讓它變成 false**——
   * 那會在使用者按下儲存的當下靜默清掉一個他填過的答案，而畫面上完全
   * 看不出來發生了什麼。沿用已存的值，等這題放回去時原封不動。
   */
  const existing = await getStoredFamilyPreference();

  const result = validateFamilyPreferenceInput({
    outdoorTendency: String(formData.get("outdoorTendency") ?? ""),
    maxParentEffort: String(formData.get("maxParentEffort") ?? ""),
    requiresMeal: existing?.requiresMeal ? "on" : "",
  });

  if (!result.ok) {
    return { status: "error", message: result.message };
  }

  await saveFamilyPreference(result.value);
  revalidatePath("/settings/preferences");
  revalidatePath("/");
  // /today 讀的是同一份設定。少了這行，用戶端的 Router Cache 可能
  // 在改完設定後仍然顯示舊的推薦——而畫面上完全看不出是快取。
  revalidatePath("/today");
  return { status: "saved" };
}

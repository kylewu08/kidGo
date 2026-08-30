"use server";

import { revalidatePath } from "next/cache";

import { validateFamilyPreferenceInput } from "@/lib/db/family-preference-input";
import { saveFamilyPreference } from "@/lib/db/queries";

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
  const result = validateFamilyPreferenceInput({
    outdoorTendency: String(formData.get("outdoorTendency") ?? ""),
    maxParentEffort: String(formData.get("maxParentEffort") ?? ""),
    // 未勾選的 checkbox 不在 FormData 裡，get 回傳 null → 空字串 → false。
    requiresMeal: String(formData.get("requiresMeal") ?? ""),
  });

  if (!result.ok) {
    return { status: "error", message: result.message };
  }

  await saveFamilyPreference(result.value);
  revalidatePath("/settings/preferences");
  revalidatePath("/");
  return { status: "saved" };
}

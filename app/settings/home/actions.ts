"use server";

import { revalidatePath } from "next/cache";

import { validateHomeBaseInput } from "@/lib/db/home-base-input";
import { saveHomeBase } from "@/lib/db/queries";

export interface SaveHomeBaseState {
  status: "idle" | "saved" | "error";
  message?: string;
}

/**
 * 儲存出發點。驗證邏輯在 lib/db/home-base-input.ts，那是純函式所以測得到。
 */
export async function saveHomeBaseAction(
  _prev: SaveHomeBaseState,
  formData: FormData,
): Promise<SaveHomeBaseState> {
  const result = validateHomeBaseInput({
    cwaCountyName: String(formData.get("cwaCountyName") ?? ""),
    cwaLocationName: String(formData.get("cwaLocationName") ?? ""),
    lat: String(formData.get("lat") ?? ""),
    lng: String(formData.get("lng") ?? ""),
    maxDriveMinutes: String(formData.get("maxDriveMinutes") ?? ""),
  });

  if (!result.ok) {
    return { status: "error", message: result.message };
  }

  await saveHomeBase(result.value);
  revalidatePath("/settings/home");
  revalidatePath("/");
  // /today 讀的是同一份設定。少了這行，用戶端的 Router Cache 可能
  // 在改完設定後仍然顯示舊的推薦——而畫面上完全看不出是快取。
  revalidatePath("/today");
  return { status: "saved" };
}

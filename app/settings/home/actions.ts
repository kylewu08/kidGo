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
  return { status: "saved" };
}

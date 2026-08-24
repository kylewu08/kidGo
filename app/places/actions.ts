"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { validatePlaceInput, type RawPlaceInput } from "@/lib/db/place-input";
import { createPlace, deletePlace, updatePlace } from "@/lib/db/queries";

export interface PlaceFormState {
  status: "idle" | "saved" | "error";
  message?: string;
  /**
   * 驗證失敗時原封帶回使用者填的內容。
   *
   * React 19 會在 Server Action 完成後自動重置表單 DOM，所以錯一個欄位
   * 就會清空另外二十幾個。建 40–60 個地點的過程中那是不可接受的。
   * 表單拿這份值重新掛載，使用者只需要改錯的那一格。
   */
  values?: RawPlaceInput;
  /** 每次失敗遞增，用來當表單的 key 觸發重新掛載 */
  attempt?: number;
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");
/** 未勾選的 checkbox 根本不會出現在 FormData 裡，所以是「有沒有這個 key」而不是值 */
const checked = (formData: FormData, key: string) => formData.get(key) !== null;

function readPlaceForm(formData: FormData): RawPlaceInput {
  return {
    name: text(formData, "name"),
    category: text(formData, "category"),
    address: text(formData, "address"),
    lat: text(formData, "lat"),
    lng: text(formData, "lng"),
    driveMinutes: text(formData, "driveMinutes"),
    parking: text(formData, "parking"),
    energyBurn: text(formData, "energyBurn"),
    typicalDurationMin: text(formData, "typicalDurationMin"),
    bestTimeSlots: formData.getAll("bestTimeSlots").map(String),
    ageMinMonths: text(formData, "ageMinMonths"),
    ageMaxMonths: text(formData, "ageMaxMonths"),
    sweetSpotMinMonths: text(formData, "sweetSpotMinMonths"),
    sweetSpotMaxMonths: text(formData, "sweetSpotMaxMonths"),
    indoor: text(formData, "indoor"),
    shadeLevel: text(formData, "shadeLevel"),
    strollerFriendly: checked(formData, "strollerFriendly"),
    hasChangingTable: checked(formData, "hasChangingTable"),
    hasNursingSpace: checked(formData, "hasNursingSpace"),
    hasFoodOnSite: checked(formData, "hasFoodOnSite"),
    hasWaterPlay: checked(formData, "hasWaterPlay"),
    needsReservation: checked(formData, "needsReservation"),
    crowdWeekday: text(formData, "crowdWeekday"),
    crowdWeekend: text(formData, "crowdWeekend"),
    quietHours: text(formData, "quietHours"),
    costPerFamily: text(formData, "costPerFamily"),
    personalRating: text(formData, "personalRating"),
    notes: text(formData, "notes"),
    tags: text(formData, "tags"),
  };
}

export async function createPlaceAction(
  _prev: PlaceFormState,
  formData: FormData,
): Promise<PlaceFormState> {
  const values = readPlaceForm(formData);
  const result = validatePlaceInput(values);
  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
      values,
      attempt: (_prev.attempt ?? 0) + 1,
    };
  }

  const id = await createPlace(result.value);
  revalidatePath("/places");
  // redirect 會丟一個 Next.js 會攔截的特殊例外，所以放在最後、不要包在 try 裡。
  redirect(`/places/${id}`);
}

export async function updatePlaceAction(
  _prev: PlaceFormState,
  formData: FormData,
): Promise<PlaceFormState> {
  const id = String(formData.get("id") ?? "");
  if (id === "") return { status: "error", message: "缺少地點 id" };

  const values = readPlaceForm(formData);
  const result = validatePlaceInput(values);
  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
      values,
      attempt: (_prev.attempt ?? 0) + 1,
    };
  }

  await updatePlace(id, result.value);
  revalidatePath("/places");
  revalidatePath(`/places/${id}`);
  return { status: "saved" };
}

export async function deletePlaceAction(
  _prev: PlaceFormState,
  formData: FormData,
): Promise<PlaceFormState> {
  const id = String(formData.get("id") ?? "");
  if (id === "") return { status: "error", message: "缺少地點 id" };

  const result = await deletePlace(id);
  if (!result.ok) {
    // 有紀錄的地點刪不掉。這不是技術限制，是 §12.3「Visit 永不刪除」的延伸——
    // 刪掉地點會讓那些紀錄變成孤兒。
    return {
      status: "error",
      message: `這個地點有 ${result.visitCount} 筆出遊紀錄，不能刪除。想讓它不再被推薦，請改條件而不是刪掉它。`,
    };
  }

  revalidatePath("/places");
  redirect("/places");
}

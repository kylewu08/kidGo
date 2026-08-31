"use server";

import { revalidatePath } from "next/cache";

import { recordSuggestionResponse } from "@/lib/db/queries";
import type { SuggestionResponse } from "@/lib/db/schema";

/**
 * 「去了／沒去」（§9.3 的最輕層，長期主力訊號）
 *
 * ADR-0011 把「沒去」拆開的理由要記得：原本一個「沒去」混合了三件完全
 * 不同的事，卻全部被當成降權依據餵給最重要的訊號。所以這裡不提供
 * 一個籠統的「沒去」按鈕——那等於把 ADR-0011 修好的東西再弄壞一次。
 */
const ALLOWED: SuggestionResponse[] = ["went", "stayed_home", "went_elsewhere"];

export async function respondToSuggestionAction(formData: FormData): Promise<void> {
  const id = String(formData.get("suggestionId") ?? "");
  const response = String(formData.get("response") ?? "") as SuggestionResponse;

  if (!id || !ALLOWED.includes(response)) return;

  await recordSuggestionResponse(id, response, new Date());
  revalidatePath("/today");
}

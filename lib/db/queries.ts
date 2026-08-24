/**
 * 資料庫查詢（設計架構書 §8.2）
 *
 * 所有讀寫集中在這裡，頁面與 Server Action 不直接碰 Drizzle。
 * 理由：推薦引擎是純函式、不讀資料庫（§8.3），所以「從哪裡拿資料」
 * 這件事只發生在少數幾個地方，集中起來才看得出全貌。
 */

import "server-only";

import { eq } from "drizzle-orm";

import { db } from "./index";
import { homeBase, type HomeBase, type NewHomeBase } from "./schema";

/** HomeBase 是單列表，id 固定為這個值 */
const HOME_BASE_ID = "default";

/** 尚未設定出發點時回傳 null。UI 應該引導使用者去設定，而不是用預設值假裝有。 */
export async function getHomeBase(): Promise<HomeBase | null> {
  const rows = await db
    .select()
    .from(homeBase)
    .where(eq(homeBase.id, HOME_BASE_ID))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 寫入或更新出發點。
 *
 * 用 upsert 而非「先查再決定 insert/update」：這是單列表，
 * 兩段式寫法只會多一次查詢和一個競態視窗，換不到任何東西。
 */
export async function saveHomeBase(
  values: Omit<NewHomeBase, "id">,
): Promise<void> {
  await db
    .insert(homeBase)
    .values({ ...values, id: HOME_BASE_ID })
    .onConflictDoUpdate({ target: homeBase.id, set: values });
}

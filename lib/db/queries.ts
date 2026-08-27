/**
 * 資料庫查詢（設計架構書 §8.2）
 *
 * 所有讀寫集中在這裡，頁面與 Server Action 不直接碰 Drizzle。
 * 理由：推薦引擎是純函式、不讀資料庫（§8.3），所以「從哪裡拿資料」
 * 這件事只發生在少數幾個地方，集中起來才看得出全貌。
 */

import "server-only";

import { and, asc, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";

import { db } from "./index";
import {
  children,
  homeBase,
  places,
  visits,
  type SourceDataset,
  type HomeBase,
  type NewHomeBase,
  type Child,
  type NewChild,
  type NewPlace,
  type Place,
  type Visit,
} from "./schema";

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

// ---------------------------------------------------------------------------
// Place
// ---------------------------------------------------------------------------

/** 依名稱排序。v1 只有 40–60 筆（P3），不需要分頁。 */
export async function listPlaces(): Promise<Place[]> {
  return db.select().from(places).orderBy(asc(places.name));
}

export async function getPlace(id: string): Promise<Place | null> {
  const rows = await db.select().from(places).where(eq(places.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createPlace(values: Omit<NewPlace, "id">): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(places).values({ ...values, id });
  return id;
}

export async function updatePlace(
  id: string,
  values: Omit<NewPlace, "id">,
): Promise<void> {
  await db.update(places).set(values).where(eq(places.id, id));
}

/** 只更新指定的欄位。匯入器用這個，因為它多半只動得了一部分欄位。 */
export async function updatePlaceFields(
  id: string,
  values: Partial<NewPlace>,
): Promise<void> {
  if (Object.keys(values).length === 0) return;
  await db.update(places).set(values).where(eq(places.id, id));
}

/**
 * 以 (sourceDataset, sourceId) 找出既有地點——匯入器判斷「這是同一個地點」的依據。
 *
 * ⚠️ 這兩欄目前**沒有** unique index。單使用者、單程序下不會出問題，
 * 但併發匯入可能產生重複列。要加索引需要一次 migration。
 */
export async function findPlaceBySource(
  sourceDataset: SourceDataset,
  sourceId: string,
): Promise<Place | null> {
  const rows = await db
    .select()
    .from(places)
    .where(and(eq(places.sourceDataset, sourceDataset), eq(places.sourceId, sourceId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 標記「來源不再包含這筆」，**但不刪除**。
 *
 * 不刪除的理由：那筆地點可能已經有造訪紀錄，刪掉會讓紀錄變成孤兒，
 * 而 §6.4 說紀錄永不刪除（docs/資料模型草案.md §7）。
 */
export async function markPlacesRemovedFromSource(
  sourceDataset: SourceDataset,
  stillPresentSourceIds: string[],
  removedAt: string,
): Promise<number> {
  const stillPresent =
    stillPresentSourceIds.length > 0
      ? notInArray(places.sourceId, stillPresentSourceIds)
      : sql`1 = 1`;
  const result = await db
    .update(places)
    .set({ sourceRemovedAt: removedAt })
    .where(and(eq(places.sourceDataset, sourceDataset), stillPresent, sql`${places.sourceRemovedAt} IS NULL`));
  return result.changes ?? 0;
}

/** 曾被標記移除、但這次又出現在來源裡的地點，要把標記清掉。 */
export async function clearSourceRemovedFlag(
  sourceDataset: SourceDataset,
  sourceIds: string[],
): Promise<number> {
  if (sourceIds.length === 0) return 0;
  const result = await db
    .update(places)
    .set({ sourceRemovedAt: null })
    .where(
      and(
        eq(places.sourceDataset, sourceDataset),
        inArray(places.sourceId, sourceIds),
        isNotNull(places.sourceRemovedAt),
      ),
    );
  return result.changes ?? 0;
}

/** 這個地點累積了幾筆出遊紀錄 */
export async function countVisitsForPlace(placeId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(visits)
    .where(eq(visits.placeId, placeId));
  return row?.count ?? 0;
}

export type DeletePlaceResult =
  | { ok: true }
  | { ok: false; reason: "has_visits"; visitCount: number };

/**
 * 刪除地點。**有出遊紀錄的地點刪不掉。**
 *
 * 這不只是外鍵約束的技術限制。設計架構書 §12.3 說 Visit 是 append-only、
 * 永不刪除，因為那是本產品最有價值的資產。刪掉地點會讓那些紀錄變成孤兒——
 * 「18 個月時去某個地方撐了兩小時」，而某個地方已經不存在了。
 *
 * 想讓某個地點不再被推薦，正確做法是把 ageRange 或車程改掉讓它被過濾，
 * 而不是刪除它。
 */
export async function deletePlace(id: string): Promise<DeletePlaceResult> {
  const visitCount = await countVisitsForPlace(id);
  if (visitCount > 0) {
    return { ok: false, reason: "has_visits", visitCount };
  }
  await db.delete(places).where(eq(places.id, id));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Child
// ---------------------------------------------------------------------------

/** 依生日排序，老大在前。 */
export async function listChildren(): Promise<Child[]> {
  return db.select().from(children).orderBy(asc(children.birthDate));
}

export async function getChild(id: string): Promise<Child | null> {
  const rows = await db.select().from(children).where(eq(children.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createChild(values: Omit<NewChild, "id">): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(children).values({ ...values, id });
  return id;
}

export async function updateChild(
  id: string,
  values: Omit<NewChild, "id">,
): Promise<void> {
  await db.update(children).set(values).where(eq(children.id, id));
}

/**
 * 刪除小孩。
 *
 * 不像 Place 那樣擋——Visit.childIds 是 JSON 陣列沒有外鍵，
 * 而且刪掉一個小孩不會讓歷史紀錄失去意義（childAgesMonths 是快照，
 * 設計架構書 §5.3 就是為了這種情況才存快照而不是反推）。
 */
export async function deleteChild(id: string): Promise<void> {
  await db.delete(children).where(eq(children.id, id));
}

// ---------------------------------------------------------------------------
// Visit
// ---------------------------------------------------------------------------

/** 全部出遊紀錄。v1 的量很小，推薦引擎一次吃全部（它是純函式，不讀 DB）。 */
export async function listVisits(): Promise<Visit[]> {
  return db.select().from(visits);
}

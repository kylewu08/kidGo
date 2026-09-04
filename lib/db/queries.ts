/**
 * 資料庫查詢（設計架構書 §8.2）
 *
 * 所有讀寫集中在這裡，頁面與 Server Action 不直接碰 Drizzle。
 * 理由：推薦引擎是純函式、不讀資料庫（§8.3），所以「從哪裡拿資料」
 * 這件事只發生在少數幾個地方，集中起來才看得出全貌。
 */

import "server-only";

import { asc, eq, inArray, lt, sql } from "drizzle-orm";

import {
  subscriptionId,
  type BrowserPushSubscription,
} from "@/lib/push/subscription";
import {
  isExpired,
  ROUTE_CACHE_MAX_AGE_DAYS,
  routeCacheId,
} from "@/lib/routes/cache-key";
import {
  DEFAULT_FAMILY_PREFERENCE,
  type FamilyPreferenceInput,
} from "./family-preference-input";
import { db } from "./index";
import {
  categoryPreferences,
  children,
  familyPreferences,
  homeBase,
  places,
  pushSubscriptions,
  routeCache,
  suggestions,
  visits,
  type HomeBase,
  type NewHomeBase,
  type CategoryPreference,
  type Child,
  type NewChild,
  type FamilyPreference,
  type NewPlace,
  type Place,
  type PushSubscription as PushSubscriptionRow,
  type Suggestion,
  type SuggestionResponse,
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

// ---------------------------------------------------------------------------
// FamilyPreference（初始三題）
// ---------------------------------------------------------------------------

/** FamilyPreference 是單列表，id 固定為這個值 */
const FAMILY_PREFERENCE_ID = "default";

/**
 * 從未回答過三題時回傳 null。
 *
 * 與 `getFamilyPreference` 分成兩個函式，是為了讓「沒設定」與「設定成
 * 剛好等於預設值」區分得開——UI 要靠這個決定要不要提示，而推薦流程
 * 不該知道這件事的差別。
 */
export async function getStoredFamilyPreference(): Promise<FamilyPreference | null> {
  const rows = await db
    .select()
    .from(familyPreferences)
    .where(eq(familyPreferences.id, FAMILY_PREFERENCE_ID))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 推薦流程要用的家庭偏好，未設定時回傳預設值。
 *
 * 這裡刻意**不回傳 null**，與 `getHomeBase` 相反。出發點沒有預設值可言
 * ——不知道從哪出發就算不出車程；三題則有，因為驗收標準一要求「僅輸入
 * 住家地址與小孩生日即可獲得三個合理推薦」。三題必須不擋路。
 */
export async function getFamilyPreference(): Promise<FamilyPreference> {
  return (await getStoredFamilyPreference()) ?? DEFAULT_FAMILY_PREFERENCE;
}

/** 寫入或更新三題。理由同 saveHomeBase：單列表用 upsert。 */
export async function saveFamilyPreference(
  values: FamilyPreferenceInput,
): Promise<void> {
  await db
    .insert(familyPreferences)
    .values({ ...values, id: FAMILY_PREFERENCE_ID })
    .onConflictDoUpdate({ target: familyPreferences.id, set: values });
}

// ---------------------------------------------------------------------------
// RouteCache（§7.1 的成本控制、ADR-0013 的 30 天上限）
// ---------------------------------------------------------------------------

/**
 * 讀取這個時段已經查過的車程。
 *
 * 存在的理由是**帳單**：精算車程要付費，而落地頁可以被重複整理。
 * 沒有這一層的話，每按一次重新整理就是一次 Google Routes 呼叫。
 *
 * 分桶規則見 lib/routes/cache-key.ts。過期的當成沒有——**不刪，只是不用**，
 * 刪除交給 purgeExpiredRouteCache，這樣讀取路徑上不會有寫入。
 */
export async function getCachedRoutes(
  placeIds: string[],
  direction: "outbound" | "return",
  bucket: string,
  now: Date,
): Promise<Map<string, number>> {
  if (placeIds.length === 0) return new Map();

  const ids = placeIds.map((id) => routeCacheId(id, direction, bucket));
  const rows = await db.select().from(routeCache).where(inArray(routeCache.id, ids));

  const found = new Map<string, number>();
  for (const row of rows) {
    if (isExpired(new Date(row.fetchedAt), now)) continue;
    found.set(row.placeId, row.durationMinutes);
  }
  return found;
}

/** 寫入這次查到的車程。同一個桶重複查就覆蓋，不累積歷史。 */
export async function putCachedRoutes(
  entries: { placeId: string; durationMinutes: number }[],
  direction: "outbound" | "return",
  bucket: string,
  departureAt: Date,
  now: Date,
): Promise<void> {
  if (entries.length === 0) return;

  for (const entry of entries) {
    const values = {
      id: routeCacheId(entry.placeId, direction, bucket),
      placeId: entry.placeId,
      direction,
      departureAt: departureAt.toISOString(),
      durationMinutes: entry.durationMinutes,
      fetchedAt: now.toISOString(),
    };
    await db
      .insert(routeCache)
      .values(values)
      .onConflictDoUpdate({ target: routeCache.id, set: values });
  }
}

/**
 * 刪除超過 30 天的快取（ADR-0013）。
 *
 * 這**不是效能最佳化，是合規要求**：Google Maps Platform 的服務條款
 * 不允許無限期保存路況結果。所以它必須真的刪，不能只是不使用。
 */
export async function purgeExpiredRouteCache(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - ROUTE_CACHE_MAX_AGE_DAYS * 24 * 3600_000);
  await db.delete(routeCache).where(lt(routeCache.fetchedAt, cutoff.toISOString()));
}

// ---------------------------------------------------------------------------
// Suggestion（§9.3 的採納率）
// ---------------------------------------------------------------------------

/** 今天這一筆（不分 kind）。一天最多一筆，理由見 upsertTodaySuggestion。 */
export async function getSuggestionForDate(date: string): Promise<Suggestion | null> {
  const rows = await db
    .select()
    .from(suggestions)
    .where(eq(sql`substr(${suggestions.sentAt}, 1, 10)`, date))
    .limit(1);
  return rows[0] ?? null;
}

export interface TodaySuggestionSlots {
  primaryPlaceId: string | null;
  backupPlaceId: string | null;
  explorePlaceId: string | null;
  suggestedDeparture: string | null;
  suggestedReturn: string | null;
  noOutingReason: string | null;
}

/**
 * 今天的建議：沒有就建一筆，有就更新槽位。**一天最多一筆。**
 *
 * 為什麼不是「開一次頁建一筆」：採納率是 §9.3 的長期主力訊號，
 * 分母被重新整理灌大之後，系統會誤以為自己的建議一直被無視，
 * 於是壓低那個類別的權重——只因為使用者多按了兩次 F5。
 *
 * 為什麼已回應之後就不再更新槽位：那筆紀錄要能回答「使用者當時看到的
 * 是什麼」。天氣變了、排序跟著變，而使用者按「去了」時看到的是舊的那組
 * ——事後把它改成新的，等於竄改了回饋的對象。
 */
export async function upsertTodaySuggestion(
  date: string,
  kind: "opened",
  slots: TodaySuggestionSlots,
  now: Date,
): Promise<Suggestion> {
  const existing = await getSuggestionForDate(date);

  if (existing) {
    if (existing.response !== null) return existing;
    await db.update(suggestions).set(slots).where(eq(suggestions.id, existing.id));
    return { ...existing, ...slots };
  }

  const row = {
    id: crypto.randomUUID(),
    sentAt: now.toISOString(),
    kind,
    ...slots,
    contextOverrideId: null,
    response: null,
    respondedAt: null,
    wentElsewherePlaceId: null,
    responseNote: null,
  };
  await db.insert(suggestions).values(row);
  return row;
}

/** 記下「去了／沒去」。ADR-0011 把「沒去」拆成三種，各自的後果不同。 */
export async function recordSuggestionResponse(
  id: string,
  response: SuggestionResponse,
  now: Date,
): Promise<void> {
  await db
    .update(suggestions)
    .set({ response, respondedAt: now.toISOString() })
    .where(eq(suggestions.id, id));
}

// ---------------------------------------------------------------------------
// CategoryPreference（§6.3 的學習權重）
// ---------------------------------------------------------------------------

/** 全部類別偏好。表很小（類別數固定），沒有分頁的必要。 */
export async function listCategoryPreferences(): Promise<CategoryPreference[]> {
  return db.select().from(categoryPreferences);
}

// ---------------------------------------------------------------------------
// PushSubscription（§9.4）
// ---------------------------------------------------------------------------

/**
 * 寫入訂閱。**同一台裝置重新訂閱時覆蓋同一列**（主鍵取自 endpoint 的雜湊）。
 *
 * 不做「一台裝置只留一筆」的清理：同一個人可能同時用 iPhone 與桌機，
 * 而伺服器分不出「換了瀏覽器的同一個人」與「另一台裝置」。失效的訂閱
 * 由送出時的 404／410 自然淘汰（見 `lib/push/send.ts`），那是唯一
 * 可靠的訊號。
 */
export async function savePushSubscription(
  subscription: BrowserPushSubscription,
  now: Date,
): Promise<void> {
  const row = {
    id: subscriptionId(subscription.endpoint),
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    createdAt: now.toISOString(),
    lastUsedAt: null,
  };

  await db
    .insert(pushSubscriptions)
    .values(row)
    .onConflictDoUpdate({
      target: pushSubscriptions.id,
      // createdAt 不覆寫：那是「這台裝置什麼時候第一次訂閱」，
      // 重新訂閱不該讓它看起來像新裝置。
      set: { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
    });
}

/** 全部訂閱。單一家庭、幾台裝置，沒有分頁的必要。 */
export async function listPushSubscriptions(): Promise<PushSubscriptionRow[]> {
  return db.select().from(pushSubscriptions);
}

/** 取消訂閱，或推播服務回報這個 endpoint 已失效時刪掉它。 */
export async function deletePushSubscription(endpoint: string): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.id, subscriptionId(endpoint)));
}

/**
 * 記下這個訂閱最後一次成功送達的時間。
 *
 * 用途是診斷：「明明訂閱了卻收不到」時，這個欄位分得出
 * 「伺服器根本沒送」與「送了但裝置沒顯示」——兩者要查的地方完全不同。
 */
export async function markPushSubscriptionUsed(
  endpoint: string,
  now: Date,
): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({ lastUsedAt: now.toISOString() })
    .where(eq(pushSubscriptions.id, subscriptionId(endpoint)));
}

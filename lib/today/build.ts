import "server-only";

import {
  getCachedRoutes,
  getFamilyPreference,
  getHomeBase,
  listCategoryPreferences,
  listChildren,
  listPlaces,
  listVisits,
  purgeExpiredRouteCache,
  putCachedRoutes,
} from "@/lib/db/queries";
import type { Child, DayType, HomeBase } from "@/lib/db/schema";
import {
  pickReferenceNote,
  recommend,
  selectPrecisionShortlist,
  type Recommendation,
  type RecommendContext,
  type RecommendResult,
  type WeatherSlot,
} from "@/lib/recommend";
import { fetchDriveMinutes } from "@/lib/routes/matrix";
import { departureBucket } from "@/lib/routes/cache-key";
import { fetchCwaForecast } from "@/lib/weather/cwa";
import { resolveTarget, type DayTarget } from "./target";
import type { CountyName } from "@/lib/weather/townships";

/**
 * 組出「今天去哪」需要的一切（設計架構書 §9.1 的執行流程）
 *
 * **這一層有副作用**——讀資料庫、呼叫天氣與路況 API。推薦引擎本身仍是
 * 純函式（§7.6），這裡是 §7.6 說的「呼叫端」。
 *
 * 放在 lib/ 而不是 app/today/ 的理由：**推播的伺服器排程需要一模一樣的
 * 東西**。§9.1 的流程（天氣 → 日型 → 時間窗 → 推薦 → 精算前 8 名 → 文案）
 * 與落地頁完全重疊，差別只在最後怎麼呈現。寫在頁面裡的話，推播上線時
 * 只能複製一份，然後兩份開始各自漂移。
 */

export type TodayStatus =
  | { kind: "no_home" }
  | { kind: "no_children" }
  | { kind: "no_places" }
  | { kind: "weather_unavailable"; message: string }
  | { kind: "ok" };

export interface TodayData {
  status: TodayStatus;
  /**
   * 這份建議是給哪一天的。可用時間窗過了就是明天（§9.1）。
   * **明天的建議是唯讀預覽**：不建立 suggestion、不顯示回饋按鈕——
   * 那件事還沒發生，而採納率是 §9.3 的長期主力訊號，不能預先寫入。
   */
  target: DayTarget;
  home: HomeBase | null;
  children: Child[];
  placeCount: number;
  now: Date;
  dayType: DayType;
  availableWindow: { start: string; end: string };
  currentWeather: WeatherSlot | null;
  result: RecommendResult | null;
  referenceNote: ReturnType<typeof pickReferenceNote>;
  /** §10.3.5：路況降級必須明示，不得靜默使用低信心估值 */
  driveNotice: string | null;
  preciseCount: number;
}

export interface BuildTodayOptions {
  now: Date;
  /** "HH:MM"。可用時間窗的結束，預設由呼叫端決定。 */
  availableUntil: string;
  cwaApiKey: string | undefined;
  routesApiKey: string | undefined;
}

export async function buildToday(options: BuildTodayOptions): Promise<TodayData> {
  const { now, availableUntil } = options;

  // 晚上打開時算明天。判斷邏輯在 target.ts，那裡全是時間邊界所以獨立測。
  const target = resolveTarget(now, availableUntil);
  // 引擎眼中的「現在」。明天的話是明天的窗口起點，不是此刻——
  // 作息、天氣時段、車程查詢的出發時刻都得跟著移，否則會拿半夜的
  // 路況去算早上的行程。
  const at = target.timestamp;

  const empty = {
    target,
    home: null,
    children: [],
    placeCount: 0,
    now,
    dayType: "weekend" as DayType,
    availableWindow: target.window,
    currentWeather: null,
    result: null,
    referenceNote: null,
    driveNotice: null,
    preciseCount: 0,
  };

  const [home, children, places, visits, familyPreference, categoryPreferences] =
    await Promise.all([
      getHomeBase(),
      listChildren(),
      listPlaces(),
      listVisits(),
      getFamilyPreference(),
      listCategoryPreferences(),
    ]);

  if (!home) return { ...empty, status: { kind: "no_home" } };
  if (children.length === 0)
    return { ...empty, status: { kind: "no_children" }, home };
  if (places.length === 0)
    return { ...empty, status: { kind: "no_places" }, home, children };

  /**
   * 行事曆表尚未匯入，先依星期粗判（與 smoke-recommend.ts 同一個權宜）。
   * 連假要等 CalendarDay 有資料才準——那會讓車程係數整個不一樣。
   */
  // **依目標日期判斷**，不是今天——晚上看明天時，今天是平日而明天可能是週六。
  const dayType: DayType = at.getDay() === 0 || at.getDay() === 6 ? "weekend" : "weekday";

  // --- 天氣 ---------------------------------------------------------------
  //
  // 天氣失敗**不能靜默降級**。Stage 1 的 rain 與 heat 都靠它，
  // 沒有預報就等於關掉了雨天與高溫的保護，而畫面上看起來一切正常。
  let weather;
  try {
    if (!options.cwaApiKey) throw new Error("沒有設定 CWA_API_KEY");
    weather = await fetchCwaForecast({
      county: home.cwaCountyName as CountyName,
      township: home.cwaLocationName,
      apiKey: options.cwaApiKey,
    });
  } catch (error) {
    return {
      ...empty,
      status: { kind: "weather_unavailable", message: (error as Error).message },
      home,
      children,
      placeCount: places.length,
      dayType,
    };
  }

  const base: RecommendContext = {
    timestamp: at,
    children,
    home: { lat: home.lat, lng: home.lng },
    weather,
    dayType,
    maxDriveMinutes: home.maxDriveMinutes,
    availableWindow: target.window,
    familyPreference,
    categoryPreferences,
  };

  // --- 精算車程 -------------------------------------------------------------
  const { preciseDrive, notice, preciseCount } = await resolvePreciseDrive(
    base,
    places,
    visits,
    options.routesApiKey,
    now,
    at,
  );

  const result = recommend(places, visits, { ...base, preciseDrive });

  // 顯示的是**目標時段**的天氣，不是此刻的。晚上看明天早上的建議時，
  // 標頭若寫現在的天氣，跟底下的推薦理由會對不起來。
  const currentWeather =
    weather.slots.find((s) => s.startsAt.getTime() + 3 * 3600_000 > at.getTime()) ??
    null;

  return {
    status: { kind: "ok" },
    target,
    home,
    children,
    placeCount: places.length,
    now,
    dayType,
    availableWindow: target.window,
    currentWeather,
    result,
    // 參考欄只挑三個槽位沒用到的類別——推一個跟主建議同類的不增加資訊。
    referenceNote: pickReferenceNote(
      result.rejected,
      result.slots.map((r) => r.place.category),
    ),
    driveNotice: notice,
    preciseCount,
  };
}

/**
 * 對硬過濾後分數最高的前 8 名查即時車程（§7.1 的成本控制）。
 *
 * **必須先用粗估跑完 Stage 2 排序再取前 8 名**（資料模型草案 §8）：
 * 直接取 Stage 1 存活者的前 8 個拿到的是資料庫順序，額度會花在隨機的
 * 地點上，而真正會被推薦的那幾個仍然只有估算值。
 */
async function resolvePreciseDrive(
  base: RecommendContext,
  places: Parameters<typeof recommend>[0],
  visits: Parameters<typeof recommend>[1],
  routesApiKey: string | undefined,
  now: Date,
  /** 查路況要用的出發時刻。明天的建議要查明天早上，不是此刻。 */
  departAt: Date,
): Promise<{
  preciseDrive: Map<string, { outboundMinutes: number; returnMinutes: number }> | undefined;
  notice: string | null;
  preciseCount: number;
}> {
  const coarse = recommend(places, visits, base);
  const shortlist = selectPrecisionShortlist(coarse.scored);

  if (shortlist.length === 0) {
    return { preciseDrive: undefined, notice: null, preciseCount: 0 };
  }
  if (!routesApiKey) {
    return {
      preciseDrive: undefined,
      notice: "沒有設定路況金鑰，車程全部為估算值",
      preciseCount: 0,
    };
  }

  await purgeExpiredRouteCache(now);

  try {
    const outbound = await legMinutes(
      shortlist.map((r) => ({ rec: r, departAt })),
      base,
      "outbound",
      routesApiKey,
      now,
    );

    /*
     * 回程用**各自的離場時刻**去查，不是抄去程的值。
     *
     * §7.1：「回程必須獨立計算，不可假設等於去程」——早上出發與下午返程
     * 是不同的路況，而「能否在午睡前返家」正是依賴回程。目前連粗估都是
     * 直接令回程等於去程（timeline.ts），所以這裡是第一個真的分開算的地方。
     *
     * 每個地點的離場時刻不同，但 Routes 一次呼叫只能有一個出發時間，
     * 所以依小時分桶後一桶一次——8 個地點通常只落在一兩個桶裡。
     */
    const returnRequests = shortlist.map((r) => {
      const out = outbound.get(r.place.id) ?? r.drive.outboundMinutes;
      const leaveAt = new Date(
        departAt.getTime() + (out + r.place.typicalDurationMinutes) * 60_000,
      );
      return { rec: r, departAt: leaveAt };
    });
    const returning = await legMinutes(returnRequests, base, "return", routesApiKey, now);

    const preciseDrive = new Map<string, { outboundMinutes: number; returnMinutes: number }>();
    for (const r of shortlist) {
      const out = outbound.get(r.place.id);
      const back = returning.get(r.place.id);
      // 兩段都拿到才算精算。只有單邊的話混用兩種來源，
      // 而 DriveEstimate 只有一個 source 欄位，標成 precise 會過度自信。
      if (out !== undefined && back !== undefined) {
        preciseDrive.set(r.place.id, { outboundMinutes: out, returnMinutes: back });
      }
    }

    return {
      preciseDrive: preciseDrive.size > 0 ? preciseDrive : undefined,
      notice:
        preciseDrive.size < shortlist.length
          ? `${shortlist.length} 個候選中有 ${shortlist.length - preciseDrive.size} 個取不到即時路況，那幾個是估算值`
          : null,
      preciseCount: preciseDrive.size,
    };
  } catch (error) {
    // §10.3.5：失敗時降級為估算並**明示**，不得靜默使用低信心估值。
    return {
      preciseDrive: undefined,
      notice: `路況暫時無法取得，車程為估算值（${(error as Error).message}）`,
      preciseCount: 0,
    };
  }
}

/** 查一個方向的車程，先讀快取，只對沒命中的呼叫 API，結果寫回快取。 */
async function legMinutes(
  requests: { rec: Recommendation; departAt: Date }[],
  base: RecommendContext,
  direction: "outbound" | "return",
  apiKey: string,
  now: Date,
): Promise<Map<string, number>> {
  const byBucket = new Map<string, { rec: Recommendation; departAt: Date }[]>();
  for (const req of requests) {
    const bucket = departureBucket(req.departAt);
    const list = byBucket.get(bucket) ?? [];
    list.push(req);
    byBucket.set(bucket, list);
  }

  const minutes = new Map<string, number>();

  for (const [bucket, group] of byBucket) {
    const ids = group.map((g) => g.rec.place.id);
    const cached = await getCachedRoutes(ids, direction, bucket, now);
    for (const [id, m] of cached) minutes.set(id, m);

    const missing = group.filter((g) => !cached.has(g.rec.place.id));
    if (missing.length === 0) continue;

    const fetched = await fetchDriveMinutes({
      origin: base.home,
      destinations: missing.map((g) => ({
        id: g.rec.place.id,
        lat: g.rec.place.lat,
        lng: g.rec.place.lng,
      })),
      // 同一桶內的出發時刻差不到一小時，取第一個當代表。
      departAt: group[0].departAt,
      apiKey,
    });

    const entries: { placeId: string; durationMinutes: number }[] = [];
    for (const [id, m] of fetched) {
      minutes.set(id, m);
      entries.push({ placeId: id, durationMinutes: m });
    }
    await putCachedRoutes(entries, direction, bucket, group[0].departAt, now);
  }

  return minutes;
}

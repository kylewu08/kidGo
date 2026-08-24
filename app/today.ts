import "server-only";

import {
  applyStage1,
  recommend,
  type RecommendContext,
  type Recommendation,
} from "@/lib/recommend";
import type { Child, HomeBase, Place, Visit } from "@/lib/db/schema";
import { fetchDriveMinutes } from "@/lib/routes/matrix";
import { fetchCwaForecast } from "@/lib/weather/cwa";
import type { CountyName } from "@/lib/weather/townships";

/**
 * 把「今天去哪」需要的三個外部輸入湊齊，然後呼叫純函式推薦引擎。
 *
 * 這個檔案是**唯一**同時碰到網路與決策層的地方，而它碰的方式是
 * 「先取好資料，再傳進去」。`recommend()` 本身仍然不呼叫網路（§8.3）。
 *
 * 兩個外部呼叫都可以失敗，而且失敗都不會讓功能中斷：
 * - 天氣掛了 → 天氣因子拿中性分數，Stage 1 對純戶外地點發警示
 * - 路況掛了 → 退回 Place.driveMinutes（P6 離線可用）
 */

/** 回家還要吃飯洗澡，所以可用時間不會用到就寢那一刻 */
const WIND_DOWN_MINUTES = 90;

export interface TodayInput {
  home: HomeBase;
  children: Child[];
  places: Place[];
  visits: Visit[];
  now: Date;
  /** 使用者透過「調整條件」覆寫的車程上限 */
  maxDriveMinutes?: number;
  /** 使用者覆寫的可用時間終點 "HH:MM" */
  until?: string;
}

export interface TodayResult {
  recommendations: Recommendation[];
  context: RecommendContext;
  /** 外部資料的取得狀況，UI 要據此誠實說明目前的精度 */
  weatherError: string | null;
  routesError: string | null;
  liveDriveCount: number;
}

/**
 * 可用時間的終點：最早就寢的那個小孩往前推 90 分鐘。
 *
 * 用資料推導而不是寫死 18:00——帶一個 19:00 就寢的嬰兒和一個 21:00 就寢的
 * 五歲小孩，能出門的時間本來就不一樣。取最早的那個，理由與 Stage 2
 * 多小孩取最低分相同：只要有一個撐不住，整趟就毀了。
 */
function defaultUntil(children: Child[]): string {
  const earliest = children
    .map((c) => c.bedTime)
    .sort()[0] ?? "20:30";
  const [h, m] = earliest.split(":").map(Number);
  const minutes = Math.max(0, h * 60 + m - WIND_DOWN_MINUTES);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export async function planToday({
  home,
  children,
  places,
  visits,
  now,
  maxDriveMinutes,
  until,
}: TodayInput): Promise<TodayResult> {
  const availableWindow = {
    start: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    end: until ?? defaultUntil(children),
  };

  let weatherError: string | null = null;
  let weather = { slots: [] as never[] };
  try {
    weather = (await fetchCwaForecast({
      county: home.cwaCountyName as CountyName,
      township: home.cwaLocationName,
      apiKey: process.env.CWA_API_KEY ?? "",
    })) as typeof weather;
  } catch (error) {
    weatherError = error instanceof Error ? error.message : "取得天氣預報失敗";
  }

  const baseContext: RecommendContext = {
    timestamp: now,
    children,
    weather,
    maxDriveMinutes: maxDriveMinutes ?? home.maxDriveMinutes,
    availableWindow,
  };

  // ADR-0005 的成本控制：先用基準車程跑完 Stage 1 的其他條件，
  // 只對存活下來的地點查即時路況。50 個地點通常只剩 5–10 個，
  // 一次查詢約 10 個元素而不是 50 個。
  const shortlist = applyStage1(places, baseContext)
    .filter((r) => r.passed)
    .map((r) => r.place);

  let routesError: string | null = null;
  let liveDriveMinutes: ReadonlyMap<string, number> | undefined;
  const apiKey = process.env.GOOGLE_ROUTES_API_KEY;

  if (shortlist.length > 0 && apiKey) {
    try {
      liveDriveMinutes = await fetchDriveMinutes({
        origin: { lat: home.lat, lng: home.lng },
        destinations: shortlist.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng })),
        departAt: now,
        apiKey,
      });
    } catch (error) {
      routesError = error instanceof Error ? error.message : "取得即時路況失敗";
    }
  }

  const context: RecommendContext = { ...baseContext, liveDriveMinutes };

  return {
    recommendations: recommend(places, visits, context),
    context,
    weatherError,
    routesError,
    liveDriveCount: liveDriveMinutes?.size ?? 0,
  };
}

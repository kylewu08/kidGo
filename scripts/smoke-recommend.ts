/**
 * 端到端煙霧測試：真實天氣 + 真實路況 + 推薦引擎。
 *
 * **這不是單元測試**，它需要網路與兩把金鑰，所以刻意放在 scripts/ 而不是
 * lib/**\/*.test.ts（vitest 不會撿到它）。單元測試永遠不該依賴外部服務。
 *
 * 它回答的是單元測試回答不了的問題：三個獨立正確的模組串起來之後，
 * 對真實資料還是不是對的。
 *
 *   set -a && . ./.env.local && set +a
 *   npx vite-node --config vitest.config.mts --root . scripts/smoke-recommend.ts
 *
 * 可以指定模擬時間，用來問「週六早上會推薦什麼」：
 *
 *   ... scripts/smoke-recommend.ts 2026-08-29T09:00 18:00
 *
 * 模擬時間必須落在 CWA 預報涵蓋的範圍內（未來約 3 天），否則天氣因子
 * 會全部落到「沒有資料」的中性分數。
 *
 * 出發點讀資料庫（先到 /settings/home 設定）。地點仍是寫死的示範資料——
 * Phase 1 的地點 CRUD 還沒做。
 */

import Database from "better-sqlite3";

import type { Child, Place } from "@/lib/db/schema";
import { recommend } from "@/lib/recommend";
import { fetchDriveMinutes } from "@/lib/routes/matrix";
import { fetchCwaForecast } from "@/lib/weather/cwa";
import type { CountyName } from "@/lib/weather/townships";

/**
 * 直接開 SQLite 而不是用 lib/db/queries.ts：那個模組標了 server-only，
 * 在 RSC 以外的環境 import 會直接丟錯。這支腳本不是 Next.js 的一部分。
 */
function readHomeBase() {
  const db = new Database(process.env.DATABASE_URL ?? "./data/kidgo.db", {
    readonly: true,
  });
  return db
    .prepare(
      "select lat, lng, cwa_county_name as county, cwa_location_name as township, max_drive_minutes as maxDriveMinutes from home_base where id = 'default'",
    )
    .get() as
    | { lat: number; lng: number; county: string; township: string; maxDriveMinutes: number }
    | undefined;
}

const home = readHomeBase();
if (!home) {
  console.error("還沒有設定出發點。先到 /settings/home 設定，再跑這支腳本。");
  process.exit(1);
}

const HOME = { lat: home.lat, lng: home.lng };
const COUNTY = home.county as CountyName;
const TOWNSHIP = home.township;

/** 四個真實地點。driveMinutes 是隨手估的基準值，正好用來對照即時路況。 */
const places: Place[] = [
  demo({ id: "daan-park", name: "大安森林公園", category: "park", lat: 25.0299, lng: 121.5361,
        driveMinutes: 20, indoor: "outdoor", shadeLevel: 2, energyBurn: 4, typicalDurationMin: 120 }),
  demo({ id: "taipei-kids", name: "兒童新樂園", category: "indoor_playground", lat: 25.0955, lng: 121.5148,
        driveMinutes: 25, indoor: "mixed", shadeLevel: 2, energyBurn: 3, typicalDurationMin: 180 }),
  demo({ id: "yangmingshan", name: "陽明山", category: "trail", lat: 25.1553, lng: 121.5453,
        driveMinutes: 40, indoor: "outdoor", shadeLevel: 3, energyBurn: 5, typicalDurationMin: 150 }),
  demo({ id: "bitan", name: "碧潭", category: "park", lat: 24.9573, lng: 121.5378,
        driveMinutes: 25, indoor: "outdoor", shadeLevel: 1, energyBurn: 3, typicalDurationMin: 90 }),
];

const children: Child[] = [
  { id: "c1", name: "示範小孩", birthDate: "2024-02-01", napStage: "one_nap",
    wakeTime: "07:00", napWindows: [{ start: "12:30", end: "14:30" }],
    bedTime: "20:30", mobility: "stroller", notes: null },
];

function demo(p: Partial<Place> & Pick<Place, "id" | "name" | "lat" | "lng" | "driveMinutes">): Place {
  return {
    ownerId: "local", category: "park", address: "", parking: "moderate",
    energyBurn: 3, typicalDurationMin: 120, bestTimeSlots: ["morning", "post_nap"],
    ageRange: { minMonths: 6, maxMonths: 120 }, sweetSpotAge: { minMonths: 12, maxMonths: 72 },
    indoor: "outdoor", shadeLevel: 2, strollerFriendly: true, hasChangingTable: true,
    hasNursingSpace: true, hasFoodOnSite: true, hasWaterPlay: false, needsReservation: false,
    quietHours: null, crowdLevel: { weekday: 2, weekend: 4 }, costPerFamily: null,
    indoorBackupPlaceIds: [], personalRating: null, notes: null, tags: [],
    fieldSources: {}, lastVerifiedAt: null, ...p,
  } as Place;
}

function clock(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// 時間由參數決定而不是直接用 new Date()，理由與 recommend() 要求
// context.timestamp 由外部傳入完全相同：不能重現的東西沒辦法除錯。
const now = process.argv[2] ? new Date(process.argv[2]) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error(`看不懂的時間「${process.argv[2]}」。格式如 2026-08-29T09:00`);
  process.exit(1);
}
const availableWindow = { start: clock(now), end: process.argv[3] ?? "18:00" };

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

// --- 1. 真實天氣 -------------------------------------------------------------
const weather = await fetchCwaForecast({
  county: COUNTY, township: TOWNSHIP, apiKey: process.env.CWA_API_KEY!,
});
console.log(`出發點      ${COUNTY}${TOWNSHIP}（${HOME.lat}, ${HOME.lng}）車程上限 ${home.maxDriveMinutes} 分`);
const nowSlot = weather.slots.find((s) => s.startsAt > now) ?? weather.slots[0];
console.log(`天氣（${COUNTY}${TOWNSHIP}）  ${nowSlot.condition}  降雨 ${nowSlot.rainProbability}%  體感 ${nowSlot.apparentTempC}°C`);

// --- 2. 真實路況 -------------------------------------------------------------
let liveDriveMinutes: ReadonlyMap<string, number> | undefined;
try {
  liveDriveMinutes = await fetchDriveMinutes({
    origin: HOME,
    destinations: places.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng })),
    // 傳出發時間才拿得到「那個時候」的預測性路況，而不是此刻的。
    // 這正是 ADR-0005 要解決的連假問題。
    departAt: now,
    apiKey: process.env.GOOGLE_ROUTES_API_KEY!,
  });
  console.log(`路況        取得 ${liveDriveMinutes.size} / ${places.length} 筆即時車程`);
} catch (error) {
  // 這正是 P6 要保護的情況：路況拿不到，推薦仍然要出得來。
  console.log(`路況        取得失敗，退回基準值：${(error as Error).message}`);
}

// --- 3. 推薦（純函式，不碰網路）-----------------------------------------------
const results = recommend(places, [], {
  timestamp: now, children, weather,
  maxDriveMinutes: home.maxDriveMinutes, availableWindow, liveDriveMinutes,
});

console.log(
  `\n${now.getMonth() + 1}/${now.getDate()}（週${WEEKDAYS[now.getDay()]}）${clock(now)}` +
    `，可用到 ${availableWindow.end}`,
);
console.log(`${places.length} 個地點 → Stage 1 之後剩 ${results.length} 個\n`);

if (results.length === 0) {
  console.log("今天沒有適合的地點。");
} else {
  for (const [i, r] of results.entries()) {
    const src = r.driveMinutesSource === "live" ? "即時" : "基準";
    console.log(`${i + 1}. ${r.place.name}  ${r.score.toFixed(1)} 分   車程 ${r.driveMinutes} 分（${src}）`);
    const b = r.scoreBreakdown;
    console.log(`   作息 ${b.schedule.toFixed(2)} · 年齡 ${b.age.toFixed(2)} · 天氣 ${b.weather.toFixed(2)} · 新鮮 ${b.freshness.toFixed(2)} · 車程 ${b.drive.toFixed(2)} · 歷史 ${b.history.toFixed(2)}`);
    console.log(`   回到家 ${clock(r.timeline.homeAt)}`);
    for (const w of r.warnings) console.log(`   ⚠ ${w}`);
  }
}

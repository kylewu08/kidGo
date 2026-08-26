/**
 * 端到端煙霧測試：真實天氣 + 真實路況 + 推薦引擎。
 *
 * **這不是單元測試**——它需要網路與金鑰，所以放在 scripts/ 而非 lib/，
 * vitest 撿不到它。單元測試永遠不該依賴外部服務。
 *
 * 它回答單元測試回答不了的問題：三個各自正確的模組串起來之後，
 * 對真實資料還是不是對的。
 *
 *   set -a && . ./.env.local && set +a
 *   npx vite-node --config vitest.config.mts --root . \
 *     scripts/smoke-recommend.ts 2026-08-29T09:00 18:00
 *
 * 出發點、小孩、地點都讀資料庫。匯入器尚未實作，所以目前地點會是空的。
 */

import Database from "better-sqlite3";

import type { Child, DayType, FamilyPreference, Place } from "@/lib/db/schema";
import { applyStage1, recommend, type RecommendContext } from "@/lib/recommend";
import { fetchDriveMinutes } from "@/lib/routes/matrix";
import { fetchCwaForecast } from "@/lib/weather/cwa";
import type { CountyName } from "@/lib/weather/townships";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function openDb() {
  return new Database(process.env.DATABASE_URL ?? "./data/kidgo.db", { readonly: true });
}

const now = process.argv[2] ? new Date(process.argv[2]) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error(`看不懂的時間「${process.argv[2]}」。格式如 2026-08-29T09:00`);
  process.exit(1);
}
const until = process.argv[3] ?? "18:00";

const db = openDb();

const home = db
  .prepare(
    "select lat, lng, cwa_county_name as county, cwa_location_name as township, max_drive_minutes as maxDrive from home_base where id='default'",
  )
  .get() as { lat: number; lng: number; county: string; township: string; maxDrive: number } | undefined;

if (!home) {
  console.error("還沒有設定出發點。先到 /settings/home 設定。");
  process.exit(1);
}

const children = (db.prepare("select * from children").all() as Record<string, unknown>[]).map(
  (r) =>
    ({
      id: r.id, name: r.name, birthDate: r.birth_date, napStage: r.nap_stage,
      wakeTime: r.wake_time, napWindows: JSON.parse(r.nap_windows as string),
      bedTime: r.bed_time, mobility: r.mobility, notes: r.notes,
    }) as Child,
);
if (children.length === 0) {
  console.error("還沒有設定小孩。推薦引擎需要至少一個——那是判斷的支點。");
  process.exit(1);
}

const places = (db.prepare("select * from places").all() as Record<string, unknown>[]).map(
  (r) =>
    ({
      id: r.id, sourceDataset: r.source_dataset, sourceId: r.source_id,
      importedAt: r.imported_at, sourceUpdatedAt: r.source_updated_at,
      sourceRemovedAt: r.source_removed_at, name: r.name, category: r.category,
      address: r.address, lat: r.lat, lng: r.lng,
      parkingSearchMinutes: r.parking_search_minutes, usesFreeway: !!r.uses_freeway,
      energyBurn: r.energy_burn, typicalDurationMinutes: r.typical_duration_minutes,
      bestTimeSlots: JSON.parse(r.best_time_slots as string),
      facilityAgeBands: r.facility_age_bands ? JSON.parse(r.facility_age_bands as string) : null,
      suitableAgeMonths: JSON.parse(r.suitable_age_months as string),
      runnableSpace: r.runnable_space, safetyEnclosure: r.safety_enclosure,
      parentEffort: r.parent_effort, indoorType: r.indoor_type,
      hasAirConditioning: !!r.has_air_conditioning, shadeLevel: r.shade_level,
      strollerFriendly: !!r.stroller_friendly,
      fieldSources: JSON.parse(r.field_sources as string),
      dataSuspect: !!r.data_suspect, dataSuspectReason: r.data_suspect_reason,
      lastVerifiedAt: r.last_verified_at, notes: r.notes,
    }) as Place,
);

if (places.length === 0) {
  console.error("資料庫裡還沒有地點。匯入器尚未實作（Phase 1 下一項）。");
  process.exit(1);
}

const familyPreference =
  (db.prepare("select * from family_preferences where id='default'").get() as
    | FamilyPreference
    | undefined) ??
  ({ id: "default", outdoorTendency: 0, maxParentEffort: 4, requiresMeal: false } as FamilyPreference);

const categoryPreferences = db.prepare("select * from category_preferences").all() as never[];

/** 行事曆表尚未匯入，先依星期粗判。連假要等 CalendarDay 有資料才準。 */
const dayType: DayType = now.getDay() === 0 || now.getDay() === 6 ? "weekend" : "weekday";

const clock = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

// --- 1. 真實天氣 -------------------------------------------------------------
const weather = await fetchCwaForecast({
  county: home.county as CountyName,
  township: home.township,
  apiKey: process.env.CWA_API_KEY!,
});

console.log(`出發點      ${home.county}${home.township}　車程上限 ${home.maxDrive} 分`);
console.log(`地點        ${places.length} 個 · 小孩 ${children.length} 位`);

const base: RecommendContext = {
  timestamp: now, children, home: { lat: home.lat, lng: home.lng },
  weather, dayType, maxDriveMinutes: home.maxDrive,
  availableWindow: { start: clock(now), end: until },
  familyPreference, categoryPreferences,
};

const nowSlot = weather.slots.find((s) => s.startsAt.getTime() + 3 * 3600_000 > now.getTime());
console.log(
  nowSlot
    ? `天氣        ${nowSlot.condition} · 體感 ${nowSlot.apparentTempC}°C · 降雨 ${nowSlot.rainProbability}%`
    : "天氣        這個時間點沒有預報資料",
);

// --- 2. 兩段式車程：粗篩後只對前 8 名精算（§7.1、ADR-0005 的成本控制）--------
const shortlist = applyStage1(places, base).filter((r) => r.passed).map((r) => r.place).slice(0, 8);

let preciseDrive: Map<string, { outboundMinutes: number; returnMinutes: number }> | undefined;
const routesKey = process.env.GOOGLE_ROUTES_API_KEY;
if (shortlist.length > 0 && routesKey) {
  try {
    const out = await fetchDriveMinutes({
      origin: { lat: home.lat, lng: home.lng },
      destinations: shortlist.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng })),
      departAt: now,
      apiKey: routesKey,
    });
    // 回程用「離開時間」再查一次會更準，但煙霧測試先用同一組值示意。
    preciseDrive = new Map([...out].map(([id, m]) => [id, { outboundMinutes: m, returnMinutes: m }]));
    console.log(`路況        粗篩後 ${shortlist.length} 個，取得 ${out.size} 筆即時車程`);
  } catch (error) {
    console.log(`路況        取得失敗，全部降級為估算：${(error as Error).message}`);
  }
}

// --- 3. 推薦（純函式，不碰網路）----------------------------------------------
const result = recommend(places, [], { ...base, preciseDrive });

console.log(`\n${now.getMonth() + 1}/${now.getDate()}（週${WEEKDAYS[now.getDay()]}）${clock(now)}，可用到 ${until}`);
console.log(`${places.length} 個地點 → Stage 1 之後剩 ${result.scored.length} 個`);
if (result.preferenceSuppressed) console.log("（受限情境，家庭偏好權重已歸零）");
console.log();

if (result.slots.length === 0) {
  console.log(result.noOutingReason ?? "今天沒有適合的地點。");
} else {
  const label = { primary: "今天建議", backup: "備案", explore: "換換口味" } as const;
  for (const r of result.slots) {
    console.log(`【${label[r.slot!]}】${r.place.name}　${r.score.toFixed(1)} 分`);
    console.log(
      `   車程 ${r.drive.outboundMinutes} 分（${r.drive.source === "precise" ? "即時" : "估算"}）` +
        ` · ${r.status === "verified" ? "去過" : "還沒去過"}` +
        (r.suggestedReturn ? ` · ${r.suggestedDeparture} 出發、${r.suggestedReturn} 到家` : ` · ${r.suggestedDeparture} 出發`),
    );
    for (const reason of r.reasons) console.log(`   ✓ ${reason}`);
    for (const w of r.warnings) console.log(`   ⚠ ${w}`);
    const b = r.scoreBreakdown;
    console.log(
      `   作息 ${b.schedule.toFixed(2)} · 年齡 ${b.age.toFixed(2)} · 天氣 ${b.weather.toFixed(2)} · 偏好 ${b.familyPreference.toFixed(2)} · 新鮮 ${b.freshness.toFixed(2)} · 車程 ${b.drive.toFixed(2)} · 歷史 ${b.history.toFixed(2)}`,
    );
    console.log();
  }
}

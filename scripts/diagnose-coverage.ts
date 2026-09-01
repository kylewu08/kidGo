/**
 * 情境覆蓋率診斷（需求補充 01 §B）
 *
 *   npx vite-node --config vitest.config.mts --root . scripts/diagnose-coverage.ts
 *
 * 回答「資料收集夠了沒」，並在不足時指出**缺哪一類**。
 * 不需要網路與金鑰——診斷用的是虛擬情境，不是真實天氣。
 */

import Database from "better-sqlite3";

import { CATEGORY_LABELS } from "@/lib/domain/category-priors";
import { COVERAGE_TARGET, diagnoseCoverage, type CoverageBaseline } from "@/lib/recommend";
import { DEFAULT_FAMILY_PREFERENCE } from "@/lib/db/family-preference-input";
import type { Child, FamilyPreference, Place, Rating } from "@/lib/db/schema";

const db = new Database(process.env.DATABASE_URL ?? "./data/kidgo.db", { readonly: true });

const home = db
  .prepare(
    "select lat, lng, max_drive_minutes as maxDrive from home_base where id='default'",
  )
  .get() as { lat: number; lng: number; maxDrive: number } | undefined;
if (!home) {
  console.error("還沒有設定出發點。");
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
  console.error("還沒有設定小孩。");
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

/**
 * ⚠️ 這裡是 raw sqlite，欄位名是 snake_case。
 *
 * 原本這段直接 `as FamilyPreference`——那在資料表是空的時候看不出問題
 * （fallback 接手了），但只要使用者在 /settings/preferences 存過一次，
 * 就會拿到一個每個欄位都是 undefined 的物件。而 Stage 1 拿 undefined
 * 去比大小不會丟錯，只會靜默放行所有地點。所以逐欄對應，不 cast。
 */
const familyPreferenceRow = db
  .prepare("select * from family_preferences where id='default'")
  .get() as Record<string, unknown> | undefined;

const familyPreference: FamilyPreference = familyPreferenceRow
  ? {
      id: String(familyPreferenceRow.id),
      outdoorTendency: Number(familyPreferenceRow.outdoor_tendency),
      maxParentEffort: Number(familyPreferenceRow.max_parent_effort) as Rating,
      requiresMeal: !!familyPreferenceRow.requires_meal,
    }
  : DEFAULT_FAMILY_PREFERENCE;

const baseline: CoverageBaseline = {
  children,
  home: { lat: home.lat, lng: home.lng },
  maxDriveMinutes: home.maxDrive,
  familyPreference,
  // 固定基準日，診斷結果才可重現。
  date: new Date("2026-09-05T00:00:00"),
};

console.log(`匯入地點 ${places.filter((p) => p.sourceDataset !== "manual").length} 個（手動新增不計，ADR-0024）· 小孩 ${children.length} 位 · 車程上限 ${home.maxDrive} 分`);
console.log(
  `停止條件：存活 ≥ ${COVERAGE_TARGET.minSurvivors}、` +
    `類別 ≥ ${COVERAGE_TARGET.minCategories}、室內 ≥ ${COVERAGE_TARGET.minWeatherProof}\n`,
);

let allMet = true;
for (const r of diagnoseCoverage(places, baseline)) {
  const mark = r.meetsTarget ? "✓ 達標" : "⚠ 未達標";
  if (!r.meetsTarget) allMet = false;
  console.log(
    `${r.scenario.label.padEnd(6, "　")} 存活 ${String(r.survivors).padStart(4)} · ` +
      `類別 ${r.categories.length} · 室內 ${String(r.weatherProofSurvivors).padStart(3)}　${mark}`,
  );
  if (r.categories.length > 0) {
    console.log(`         類別：${r.categories.map((c) => CATEGORY_LABELS[c]).join("、")}`);
  }
  if (r.gap) {
    console.log(`         缺乏：${r.gap.missing}`);
    if (r.gap.suggest.length > 0) {
      console.log(`         建議補充：${r.gap.suggest.map((c) => CATEGORY_LABELS[c]).join("、")}`);
    }
  }
  const breakdown = Object.entries(r.rejectionBreakdown).sort((a, b) => b[1] - a[1]);
  if (breakdown.length > 0) {
    console.log(`         剔除：${breakdown.map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  }
  console.log();
}

console.log(allMet ? "全部達標——覆蓋足夠，可以停止擴充資料。" : "有情境未達標，見上方建議補充的類別。");

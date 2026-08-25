/**
 * 把 v0.2 備份裡仍然相容的資料搬進 v1.0 schema。
 *
 * 只搬**小孩**與**出發點**：這兩者的欄位在 v1.0 完全沒變（§6.1、ADR-0012），
 * 而且是使用者親手輸入、重打會不高興的東西。
 *
 * **地點不搬。** P1 零建檔啟動之後它們會由匯入器產生，
 * 而且 v0.2 的地點缺 parentEffort / runnableSpace / safetyEnclosure 這些
 * v1.0 的核心欄位——用類別先驗補進去只是製造一筆看起來像手填、
 * 實際上是猜的資料，違反「每個欄位都要知道自己怎麼來的」。
 *
 *   npx vite-node --config vitest.config.mts --root . \
 *     scripts/restore-from-v02-backup.ts data/backup/v0.2-dump-2026-08-25.json
 */

import Database from "better-sqlite3";
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("用法：restore-from-v02-backup.ts <備份 JSON 路徑>");
  process.exit(1);
}

interface V02Child {
  id: string; name: string; birth_date: string; nap_stage: string;
  wake_time: string; nap_windows: string; bed_time: string;
  mobility: string; notes: string | null;
}
interface V02Home {
  id: string; lat: number; lng: number;
  cwa_county_name: string; cwa_location_name: string; max_drive_minutes: number;
}

const dump = JSON.parse(readFileSync(path, "utf8")) as {
  children: V02Child[];
  home_base: V02Home[];
  places: unknown[];
};

const db = new Database(process.env.DATABASE_URL ?? "./data/kidgo.db");
db.pragma("foreign_keys = ON");

const insertChild = db.prepare(`
  insert or replace into children
    (id, name, birth_date, nap_stage, wake_time, nap_windows, bed_time, mobility, notes)
  values (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
for (const c of dump.children) {
  insertChild.run(c.id, c.name, c.birth_date, c.nap_stage, c.wake_time,
    c.nap_windows, c.bed_time, c.mobility, c.notes);
  console.log(`✔ 小孩：${c.name}（生日 ${c.birth_date}）`);
}

const insertHome = db.prepare(`
  insert or replace into home_base
    (id, lat, lng, cwa_county_name, cwa_location_name, max_drive_minutes)
  values (?, ?, ?, ?, ?, ?)
`);
for (const h of dump.home_base) {
  insertHome.run(h.id, h.lat, h.lng, h.cwa_county_name, h.cwa_location_name, h.max_drive_minutes);
  console.log(`✔ 出發點：${h.cwa_county_name}${h.cwa_location_name}，車程上限 ${h.max_drive_minutes} 分`);
}

console.log(`\n跳過 ${dump.places.length} 個地點——它們會由匯入器重新產生（P1）。`);
console.log("備份檔保留著，需要時可以查回原本填的值。");

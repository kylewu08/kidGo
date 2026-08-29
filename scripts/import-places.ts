/**
 * 開放資料匯入（設計架構書 §10.1、ADR-0019）
 *
 * **這不是單元測試**——它需要網路並且會寫資料庫，所以放在 scripts/ 而非 lib/。
 * 決策邏輯（入場測試、推導、upsert）全都在 lib/import/ 且各自有測試；
 * 這支腳本只負責把它們串起來。
 *
 *   npx vite-node --config vitest.config.mts --root . \
 *     scripts/import-places.ts [來源代號…]
 *
 * 不給參數時匯入全部來源。**重跑是安全的**：upsert 冪等，
 * 且不會覆蓋 fieldSources 為 manual / visit_corrected / ai_suggested 的欄位。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { downloadText, fetchResources, pickResource } from "@/lib/import/catalog";
import { importRecords, type ImportReport } from "@/lib/import/run";
import { findSource, SOURCES, type SourceDefinition } from "@/lib/import/sources/registry";
import {
  EMPTY_GEOCODE_TABLE,
  mergeGeocodeTables,
  parseTgosResult,
  type GeocodeTable,
} from "@/lib/import/geocode";
import { createSqlitePlaceStore } from "@/lib/import/sqlite-store";
import type { PlaceStore } from "@/lib/import/store";

const GEOCODE_DIR = "data/geocode";

/**
 * 載入所有 TGOS 批次比對的結果檔。
 *
 * 缺檔不是錯誤：座標齊全的來源本來就不需要，而還沒送去比對的來源
 * 會走 deferredNoCoordinates 那條路，等結果檔到了再重跑即可。
 */
function loadGeocodeTable(): GeocodeTable {
  if (!existsSync(GEOCODE_DIR)) return EMPTY_GEOCODE_TABLE;
  const files = readdirSync(GEOCODE_DIR)
    .filter((f) => f.endsWith(".result.csv"))
    .sort();
  if (files.length === 0) return EMPTY_GEOCODE_TABLE;

  const table = mergeGeocodeTables(
    files.map((f) => parseTgosResult(readFileSync(`${GEOCODE_DIR}/${f}`, "utf-8"))),
  );
  console.log(
    `座標表　　　 ${files.length} 個結果檔 · 可查 ${table.entries.size} 個地址` +
      (table.unmatched.length > 0 ? ` · TGOS 比對不到 ${table.unmatched.length} 個` : ""),
  );
  return table;
}

async function importOne(
  store: PlaceStore,
  geocode: GeocodeTable,
  source: SourceDefinition,
): Promise<ImportReport> {
  const resources = await fetchResources(source.datasetId);
  const resource = pickResource(resources, source.datasetId, source.resourceDescription);

  console.log(`  資源「${resource.description || "(無名稱)"}」 ${resource.format}`);
  const text = await downloadText(resource.downloadUrl, source.encoding);
  const records = source.parse(text);
  console.log(`  解析出 ${records.length} 筆`);

  return importRecords(store, source.sourceDataset, records, { geocode });
}

function printReport(report: ImportReport): void {
  const rows: [string, number][] = [
    ["來源筆數", report.incoming],
    ["入場測試擋下", report.rejected],
    ["由座標表補上", report.geocoded],
    ["缺座標暫緩", report.deferredNoCoordinates],
    ["新增", report.created],
    ["更新", report.updated],
    ["受保護未覆蓋的欄位", report.protectedFields],
    ["標記來源已移除", report.markedRemoved],
    ["回到來源", report.restored],
  ];
  for (const [label, value] of rows) {
    console.log(`  ${label.padEnd(12, "　")} ${value}`);
  }
}

async function main(): Promise<void> {
  const keys = process.argv.slice(2);
  const selected = keys.length > 0 ? keys.map(findSource) : SOURCES;

  const sqlite = new Database(process.env.DATABASE_URL ?? "./data/kidgo.db");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const store = createSqlitePlaceStore(drizzle(sqlite));
  const geocode = loadGeocodeTable();

  for (const source of selected) {
    console.log(`\n▸ ${source.label}（資料集 ${source.datasetId}）`);
    try {
      printReport(await importOne(store, geocode, source));
    } catch (error) {
      console.error(`  ✗ 失敗：${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }

  sqlite.close();
}

void main();

/**
 * 產生 TGOS 批次門牌地址比對服務的上傳檔。
 *
 *   npx vite-node --config vitest.config.mts --root . \
 *     scripts/export-geocode-requests.ts [來源代號…]
 *
 * 產出 `data/geocode/<來源代號>.request.csv`。接下來是人工步驟：
 *
 *   1. 到 https://www.tgos.tw/tgos/Addr/Compare 上傳這個檔
 *   2. **坐標系統選 EPSG:4326 (WGS84)**，比對方式選「進行完全比對」
 *   3. 收到通知信後下載結果，存成 `data/geocode/<來源代號>.result.csv`
 *   4. 重跑 scripts/import-places.ts，座標就會補上
 *
 * 為什麼是人工步驟：即時 API 的申請資格限政府機關、法人、學術與業界，
 * 批次服務才開放個人。憑證因此留在使用者手上，程式完全不碰。
 */

import { mkdirSync, writeFileSync } from "node:fs";

import { downloadText, fetchResources, pickResource } from "@/lib/import/catalog";
import { admit } from "@/lib/import/admission";
import { findSource, SOURCES, type SourceDefinition } from "@/lib/import/sources/registry";

const OUTPUT_DIR = "data/geocode";

/** TGOS 範本的欄位。後三欄由 TGOS 填回。 */
const HEADER = "id,Address,Response_Address,Response_X,Response_Y";

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function exportOne(source: SourceDefinition): Promise<void> {
  const resources = await fetchResources(source.datasetId);
  const resource = pickResource(resources, source.datasetId, source.resourceDescription);
  const records = source.parse!(await downloadText(resource.downloadUrl, source.encoding));

  // 只送「會被匯入、但缺座標」的地址。入場測試擋掉的送去比對是浪費額度
  // （每日 1 萬筆），而且會讓結果檔混進永遠用不到的資料。
  const needed = records.filter(
    (r) => admit(r).admitted && (r.lat === null || r.lng === null) && r.address.length > 0,
  );

  // 同一個地址只送一次。
  const addresses = [...new Set(needed.map((r) => r.address))];

  const lines = [HEADER, ...addresses.map((a, i) => `${i + 1},${csvEscape(a)},,,`)];
  const path = `${OUTPUT_DIR}/${source.key}.request.csv`;
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(path, `${lines.join("\n")}\n`, "utf-8");

  console.log(`  來源 ${records.length} 筆 · 需要座標 ${needed.length} 筆 · 去重後 ${addresses.length} 個地址`);
  console.log(`  → ${path}`);
}

async function main(): Promise<void> {
  const keys = process.argv.slice(2);
  const selected = keys.length > 0 ? keys.map(findSource) : SOURCES;

  for (const source of selected) {
    console.log(`\n▸ ${source.label}`);
    try {
      await exportOne(source);
    } catch (error) {
      console.error(`  ✗ 失敗：${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }

  console.log(
    "\n接下來：到 https://www.tgos.tw/tgos/Addr/Compare 上傳，" +
      "坐標系統選 EPSG:4326，結果存成 data/geocode/<來源代號>.result.csv",
  );
}

void main();

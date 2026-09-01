/**
 * 最小的 ZIP 讀取器——只做「從壓縮檔裡取出一個檔案」
 *
 * 觀光資訊資料庫（資料集 7777）只提供 zip，而 `downloadText` 只處理文字。
 *
 * **為什麼不引依賴**：與 csv.ts 同一個判斷。ZIP 需要的只有兩件事——
 * 找到中央目錄、對單一項目做 DEFLATE 解壓——而 Node 內建的 `zlib` 已經
 * 提供了後者。為 60 行函式引入一個依賴，對一個要離線跑在 NAS 上的專案
 * 不划算（同 c4eb02b 對 CSV 的判斷）。
 *
 * **不支援的**：加密、多磁碟、ZIP64（超過 4GB 或 65535 個項目）。
 * 觀光資料是 3 MB、十來個檔案，遇不到這些。真的遇到會丟錯而不是靜默回錯的值。
 */

import { inflateRawSync } from "node:zlib";

/** 中央目錄結尾標記（End of Central Directory） */
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;

const STORED = 0;
const DEFLATED = 8;

interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

/**
 * 從尾端往回找 EOCD。
 * 它不在固定位置，因為後面可能跟著註解——所以只能倒著掃。
 */
function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 65_557); // 22 + 最大註解長度
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new Error("不是有效的 ZIP：找不到中央目錄結尾");
}

function readCentralDirectory(buf: Buffer): Entry[] {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);

  const entries: Entry[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== CENTRAL_FILE_SIGNATURE) {
      throw new Error(`中央目錄第 ${i} 項的簽章不正確`);
    }
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");

    entries.push({ name, method, compressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function listZipEntries(zip: Buffer): string[] {
  return readCentralDirectory(zip).map((e) => e.name);
}

/**
 * 取出一個檔案的內容。
 *
 * 名稱用「結尾比對」而非完全相等：壓縮檔內可能帶有目錄前綴，
 * 而呼叫端關心的是檔名。找不到時把現有項目列出來——
 * 資料集改版時那個訊息就是唯一的線索。
 */
export function readZipEntry(zip: Buffer, endsWith: string): Buffer {
  const entries = readCentralDirectory(zip);
  const entry = entries.find((e) => e.name.endsWith(endsWith));
  if (!entry) {
    throw new Error(
      `壓縮檔裡找不到「${endsWith}」。現有項目：${entries.map((e) => e.name).join("、")}`,
    );
  }

  // 本地檔頭的長度是變動的，得讀了才知道實際資料從哪裡開始。
  const local = entry.localHeaderOffset;
  const nameLength = zip.readUInt16LE(local + 26);
  const extraLength = zip.readUInt16LE(local + 28);
  const start = local + 30 + nameLength + extraLength;
  const raw = zip.subarray(start, start + entry.compressedSize);

  if (entry.method === STORED) return Buffer.from(raw);
  if (entry.method === DEFLATED) return inflateRawSync(raw);
  throw new Error(`不支援的壓縮方式 ${entry.method}（${entry.name}）`);
}

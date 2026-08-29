/**
 * 最小的 CSV 解析器。
 *
 * 為什麼不裝套件：開放資料的 CSV 都很規矩（政府平臺產出的），
 * 而這裡只需要「引號內可含逗號與換行」這一條規則。
 * 為了一個 40 行的函式引入依賴，對一個要離線跑在 NAS 上的專案不划算。
 *
 * 已知不支援：跳脫字元（CSV 標準用兩個雙引號表示一個，這個有支援）、
 * 非逗號分隔符、BOM 以外的編碼標記（編碼在 catalog.ts 的下載階段處理）。
 */

/** 解析成一列一列的字串陣列。空白列會被略過。 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // BOM 會讓第一個欄位名多一個看不見的字元，之後用欄位名取值就會取不到。
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') inQuotes = true;
    else if (char === ",") endField();
    else if (char === "\r") continue;
    else if (char === "\n") endRow();
    else field += char;
  }

  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}

/** 以第一列為欄位名，解析成物件陣列。 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    header.forEach((name, i) => {
      record[name] = row[i] ?? "";
    });
    return record;
  });
}

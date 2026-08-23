import "server-only";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

/**
 * SQLite 連線。單一使用者、單一程序，所以用一個 module-level 的連線就夠。
 *
 * `server-only` 是刻意加的：這個模組若被 client component import 會直接建置失敗，
 * 而不是在 runtime 才出現難懂的錯誤。
 */
const sqlite = new Database(process.env.DATABASE_URL ?? "./data/kidgo.db");

// WAL 讓讀寫不互相阻塞。單使用者下影響不大，但沒有理由不開。
sqlite.pragma("journal_mode = WAL");
// SQLite 預設不檢查外鍵。visits.place_id 的參照完整性需要這行才會生效。
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { schema };

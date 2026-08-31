/**
 * 啟動時套用 migration（ADR-0023）
 *
 * 為什麼不用 `drizzle-kit migrate`：drizzle-kit 是 devDependency。
 * 為了在容器裡跑它，runtime 就得帶著整套開發相依——那既讓映像肥一倍，
 * 也讓「映像裡不含原始碼」做不到（drizzle-kit 會去讀 drizzle.config.ts，
 * 而那份設定又指向 lib/db/schema.ts）。
 *
 * `drizzle-orm/better-sqlite3/migrator` 則是**執行期相依**，
 * 它只需要 drizzle/ 底下已經產生好的 SQL 與 meta/_journal.json，
 * 不需要 schema 原始碼。這正是多階段建置能把 lib/ 與 app/ 留在
 * builder 階段的原因。
 *
 * 用 .mjs 而非 .ts：runtime 沒有 TypeScript，也不該有。
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const url = process.env.DATABASE_URL ?? "./data/kidgo.db";

// 持久卷第一次是空的（第一次部署、或換新 NAS），檔案根本不存在。
// better-sqlite3 會自己建檔，但**目錄必須存在**——目錄不在時的錯誤訊息是
// 「Cannot open database because the directory does not exist」，
// 而那句話不會告訴你是 compose 的掛載點沒設對。
const db = drizzle(new Database(url));

migrate(db, { migrationsFolder: "./drizzle" });

console.log(`migrations applied → ${url}`);

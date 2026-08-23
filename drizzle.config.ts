import type { Config } from "drizzle-kit";

/**
 * 本地 SQLite。理由見 docs/adr/0001-sqlite-over-cloud-db.md。
 * 資料庫就是一個檔案，備份與匯出都是 cp。
 */
export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "./data/kidgo.db",
  },
} satisfies Config;

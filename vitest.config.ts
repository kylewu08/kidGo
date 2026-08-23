import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    // 只測純邏輯。lib/recommend/ 是無副作用的純函式（設計架構書 §8.3），
    // 不需要 jsdom 或資料庫，測試因此可以跑得很快、隨時跑。
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * AI 邊界的強制執行（設計架構書 §3、§8.2；ADR-0002）
 *
 * 決策層禁用 LLM。這條界線以資料夾邊界表達，並由 lint 強制——
 * 靠自律或註解是不夠的，因為違反它的程式碼看起來永遠很合理。
 *
 * 雙向禁止，不是單向：
 * - recommend/ import ai/  → 決策被汙染，排序不再可重現
 * - ai/ import recommend/  → 建檔邏輯開始依賴評分，兩者無法獨立測試
 */
const aiBoundary = [
  {
    files: ["lib/recommend/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/lib/ai/**", "@/lib/ai/**", "../ai/**", "../../ai/**"],
              message:
                "決策層禁止 import lib/ai/。推薦排序必須由確定性純函式產生，理由見 docs/adr/0002-no-llm-in-decision-layer.md。",
            },
            {
              group: ["@anthropic-ai/*"],
              message:
                "決策層禁止直接呼叫模型 SDK。recommend() 必須無副作用、不呼叫網路（設計架構書 §8.3）。",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["lib/ai/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/lib/recommend/**",
                "@/lib/recommend/**",
                "../recommend/**",
                "../../recommend/**",
              ],
              message:
                "建檔層禁止 import lib/recommend/。兩者必須能獨立測試，理由見 docs/adr/0002-no-llm-in-decision-layer.md。",
            },
          ],
        },
      ],
    },
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...aiBoundary,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;

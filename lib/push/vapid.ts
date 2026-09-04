/**
 * VAPID 金鑰的讀取（設計架構書 §9.4）
 *
 * VAPID 是 Web Push 的身分憑證：伺服器用私鑰簽一個 JWT，推播服務
 * （Apple、Google、Mozilla 各自一個）用公鑰驗證這則推播確實來自這個站台。
 * 少了它，瀏覽器連訂閱都不會給。
 *
 * ## 為什麼公鑰不叫 NEXT_PUBLIC_VAPID_PUBLIC_KEY
 *
 * Next 的 `NEXT_PUBLIC_` 前綴是**建置期**替換：值在 `next build` 當下
 * 被寫死進 bundle。而這個專案的映像是 GitHub Actions 建的（見
 * `.github/workflows/build-image.yml`），CI 上沒有、也不該有 NAS 的 `.env`
 * ——那樣做的結果是瀏覽器拿到字串 `undefined`，而**訂閱會在
 * `applicationServerKey` 解碼時才失敗**，錯誤訊息完全指不到金鑰沒設。
 *
 * 所以公鑰用一般環境變數，由伺服器元件在**請求時**讀出來傳給前端
 * （見 `app/page.tsx`）。公鑰本來就是要給瀏覽器看的，經由 props 傳過去
 * 沒有任何損失，換來的是「換金鑰只要改 .env 重啟」而不必重建映像。
 */

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** 推播服務用來聯絡站台管理者的位址，必須是 mailto: 或 https: */
  subject: string;
}

/** 沒設 VAPID_SUBJECT 時用站台位址。web-push 只接受 mailto: 或 https:。 */
const DEFAULT_SUBJECT = "https://kidgo.kylewu.org";

/**
 * 從環境變數讀出 VAPID 設定，缺任何一把金鑰就回 `null`。
 *
 * 刻意不丟例外：沒設金鑰是**還沒設定**，不是錯誤。呼叫端據此顯示
 * 「伺服器尚未設定推播金鑰」，而不是讓整頁掛掉——P9 的同一個判斷，
 * 少了選用的外部設定，其餘功能照樣要能用。
 *
 * 接受 `env` 參數而不直接讀 `process.env`：這樣它是純函式，測得動。
 * 型別刻意寫成鬆散的字典而不是 `NodeJS.ProcessEnv`——後者要求 `NODE_ENV`，
 * 測試就得為了型別去湊一個與這件事無關的欄位。
 */
export function readVapidConfig(
  env: Record<string, string | undefined>,
): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();

  if (!publicKey || !privateKey) return null;

  return {
    publicKey,
    privateKey,
    subject: env.VAPID_SUBJECT?.trim() || DEFAULT_SUBJECT,
  };
}

import type { MetadataRoute } from "next";

/**
 * Web App Manifest（設計架構書 §9.4）
 *
 * **這不是為了讓網站「像 App」，是推播的前置條件。**
 * §9.4 標明必讀：iOS 的 Web Push 只在 PWA 被加入主畫面後可用（iOS 16.4 起）。
 * 沒有 manifest 就沒有「加入主畫面」，沒有加入主畫面 iPhone 就收不到推播，
 * 而推播是這個產品的主要形態（§1.3）。
 *
 * 用 app/manifest.ts 而不是 public/manifest.json：值要跟 globals.css 的
 * 色票對得上，而註解只有在原始碼裡才留得住。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KidGo — 這個週末帶小孩去哪",
    /** 主畫面圖示底下顯示的字。超過約 12 個字元會被截斷，所以只放品牌 */
    short_name: "KidGo",
    description:
      "輸入當下條件，輸出一到三個具體答案。不是景點資料庫，是決策引擎。",
    lang: "zh-Hant-TW",

    /**
     * 從主畫面開啟時直接進落地頁，不是首頁。
     *
     * P3「答案優先，非清單」：使用者按圖示的當下要的是今天的建議，
     * 不是一個導覽選單。首頁的角色是設定入口，那是低頻操作。
     *
     * 尚未設定出發點或小孩時，/today 會顯示帶 CTA 的引導狀態，
     * 所以新安裝落在這裡也走得下去。
     */
    start_url: "/today",
    /** 設定頁也要留在 App 內，不然點「去設定出發點」會跳出瀏覽器 */
    scope: "/",

    /**
     * **standalone 是硬性要求，不是偏好。**
     * iOS 只在 standalone 模式下開放 Web Push 與通知權限。
     * 改成 browser 或 minimal-ui 會讓 §9.4 的整條路徑失效。
     */
    display: "standalone",
    /** 使用情境是週六早上單手看一眼（§1.3），沒有橫向的理由 */
    orientation: "portrait",

    /** 啟動畫面底色。取自 globals.css 的 --background（淺色） */
    background_color: "#fbfaf8",
    /** 系統 UI 的底色。取自 --accent 深松綠 */
    theme_color: "#1f4d3f",

    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      /*
       * Android 的 adaptive icon 會自行裁切成任意形狀。少了 maskable 這張，
       * 部分 launcher 會把圓角外的透明區當成內容，圖示看起來像被咬掉一角。
       * 這張的底色滿版、標誌縮在中央 80% 的安全區內（generate-icons.mjs）。
       */
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

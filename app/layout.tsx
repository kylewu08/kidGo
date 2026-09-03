import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KidGo",
  description: "這個週末帶小孩去哪的決策引擎",
  /**
   * iOS 加到主畫面後，App 的顯示名稱與是否全螢幕由這組 meta 決定
   * （§9.4：iOS 的 Web Push 只在 PWA 加入主畫面後可用）。
   * manifest 的 display: standalone 在 iOS 上不夠，Safari 看的是這個。
   */
  appleWebApp: {
    capable: true,
    title: "KidGo",
    /** 狀態列與深松綠的標頭融在一起，不要一條白邊 */
    statusBarStyle: "black-translucent",
  },
};

/**
 * 系統 UI 的底色跟著主題走。
 *
 * 只給一個值的話，深色模式下網址列會是淺色而頁面是近黑，接縫很明顯——
 * 而 standalone 模式整個畫面都是這個顏色包著，接縫會更刺眼。
 * 兩個值分別對應 globals.css 的 --accent 與 --background 深色版。
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1f4d3f" },
    { media: "(prefers-color-scheme: dark)", color: "#12110f" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-Hant-TW"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

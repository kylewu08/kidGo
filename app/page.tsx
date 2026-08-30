import Link from "next/link";

import { getHomeBase, getStoredFamilyPreference, listChildren } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

/**
 * 暫時的首頁。
 *
 * v1.0 §1.3 把主要形態改成**週末早晨的推播**，App 的角色是設定介面與
 * 回饋介面。所以這裡不會再有 v0.2 那個「今天去哪」的主推薦卡片——
 * 那個位置未來屬於**推播落地頁**（§12 Phase 1 最後一項）。
 */
export default async function Home() {
  const [home, children, preference] = await Promise.all([
    getHomeBase(),
    listChildren(),
    getStoredFamilyPreference(),
  ]);

  return (
    <main className="mx-auto w-full max-w-md px-5 py-10 flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold">KidGo</h1>
        <p className="text-sm opacity-70">這個週末帶小孩去哪</p>
      </header>

      <div className="rounded-xl border border-dashed border-black/20 dark:border-white/25 p-4 text-sm leading-relaxed opacity-75">
        推薦引擎與匯入器都已就緒。還缺推播與落地頁——在那之前，
        這裡只有設定，沒有「今天去哪」的畫面。
      </div>

      <nav className="flex flex-col gap-2">
        <Link
          href="/settings/home"
          className="flex items-center justify-between rounded-xl border border-black/10 dark:border-white/15 px-4 py-3.5"
        >
          <span className="font-medium">出發點</span>
          <span className="text-sm opacity-60">
            {home ? `${home.cwaCountyName}${home.cwaLocationName}` : "尚未設定"}
          </span>
        </Link>
        <Link
          href="/settings/children"
          className="flex items-center justify-between rounded-xl border border-black/10 dark:border-white/15 px-4 py-3.5"
        >
          <span className="font-medium">小孩</span>
          <span className="text-sm opacity-60">
            {children.length === 0 ? "尚未設定" : `${children.length} 位`}
          </span>
        </Link>
        {/*
          三題沒填時顯示「使用預設值」而不是「尚未設定」——後者會讓人以為
          不填就不能用，但 P1 與驗收標準一都要求它不擋路。這一行本身就是
          §6.2 那個提示：看得見、填了會自己消失，不需要一個要手動關掉的橫幅。
        */}
        <Link
          href="/settings/preferences"
          className="flex items-center justify-between rounded-xl border border-black/10 dark:border-white/15 px-4 py-3.5"
        >
          <span className="font-medium">家庭偏好</span>
          <span className="text-sm opacity-60">
            {preference ? "已設定" : "使用預設值"}
          </span>
        </Link>
      </nav>
    </main>
  );
}

import Link from "next/link";

import { getHomeBase, listPlaces } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

/**
 * 佔位首頁。
 *
 * 真正的首頁是設計架構書 §10.1 的「今天去哪」——一進來就是答案，不是搜尋框。
 * 那是 Phase 1 尚未完成的項目，這裡先放一個能到達設定頁的入口，
 * 免得設定頁做好了卻沒有路走過去。
 */
export default async function Home() {
  const [home, places] = await Promise.all([getHomeBase(), listPlaces()]);

  return (
    <main className="mx-auto w-full max-w-md px-5 py-10 flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold">KidGo</h1>
        <p className="text-sm opacity-70">這個週末帶小孩去哪</p>
      </header>

      <div className="rounded-xl border border-dashed border-black/20 dark:border-white/25 p-4 text-sm leading-relaxed opacity-70">
        「今天去哪」的推薦畫面還沒做（設計架構書 §10.1）。決策引擎本身已完成並
        通過測試，缺的是把它接上畫面，以及建檔 40–60 個地點。
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
          href="/places"
          className="flex items-center justify-between rounded-xl border border-black/10 dark:border-white/15 px-4 py-3.5"
        >
          <span className="font-medium">地點</span>
          <span className="text-sm opacity-60">
            {places.length === 0 ? "尚未建檔" : `${places.length} 個`}
          </span>
        </Link>
      </nav>
    </main>
  );
}

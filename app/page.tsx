import Link from "next/link";

import { getHomeBase, listChildren } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

/**
 * 暫時的首頁。
 *
 * v1.0 §1.3 把主要形態改成**週末早晨的推播**，App 的角色是設定介面與回饋介面。
 * 所以這裡不會再有 v0.2 那個「今天去哪」的主推薦卡片——
 * 那個位置未來屬於**推播落地頁**（§12 Phase 1 最後一項）。
 *
 * 目前處於 v0.2 → v1.0 的遷移中，見 docs/adr/0008-adopt-spec-v1.md。
 */
export default async function Home() {
  const [home, children] = await Promise.all([getHomeBase(), listChildren()]);

  return (
    <main className="mx-auto w-full max-w-md px-5 py-10 flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold">KidGo</h1>
        <p className="text-sm opacity-70">這個週末帶小孩去哪</p>
      </header>

      <div className="rounded-xl border border-dashed border-black/20 dark:border-white/25 p-4 text-sm leading-relaxed opacity-75">
        正在從設計架構書 v0.2 遷移到 v1.0。資料模型與領域參數已就位，
        推薦引擎與匯入器尚未改寫完成。
        <br />
        <br />
        對照表見 <code className="text-xs">docs/adr/0008-adopt-spec-v1.md</code>。
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
      </nav>
    </main>
  );
}

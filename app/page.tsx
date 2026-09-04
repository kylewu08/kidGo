import Link from "next/link";

import { getHomeBase, getStoredFamilyPreference, listChildren } from "@/lib/db/queries";
import { readVapidConfig } from "@/lib/push/vapid";
import { AddToHomeScreen } from "./add-to-home-screen";
import { EnablePush } from "./enable-push";

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

      {/*
        §9.4 要求「首次設定流程**必須**引導加入主畫面」，所以它放在設定
        入口這一頁，而不是 /today。/today 的工作是給答案（P3），
        在那裡擺一個裝機提示會壓過主建議。

        已加入主畫面時它會自己縮成一行確認，不需要手動關掉。
      */}
      <AddToHomeScreen />

      {/*
        推播訂閱。放在加入主畫面的**下面**是刻意的順序——iOS 要先裝起來，
        `window.PushManager` 才存在，反過來的話 iPhone 使用者會先看到
        一張說「這個瀏覽器不支援」的卡片，而那個結論是錯的。

        公鑰在**請求時**從環境變數讀出來傳下去。不用 NEXT_PUBLIC_：
        那是建置期替換，而映像在 GitHub Actions 上建，那裡沒有 NAS 的 .env
        ——理由寫在 lib/push/vapid.ts。
      */}
      <EnablePush vapidPublicKey={readVapidConfig(process.env)?.publicKey ?? null} />

      {/*
        「還缺推播」原本寫在這裡，但 AddToHomeScreen 現在也講同一件事，
        兩個框疊在一起等於講兩次。推播的狀態交給上面那張卡片——
        它同時處理「為什麼收不到」與「你可以先做什麼」，這裡只講已經好的部分。
      */}
      <div className="rounded-xl border border-dashed border-black/20 dark:border-white/25 p-4 text-sm leading-relaxed opacity-75">
        推薦引擎、匯入器與落地頁都已就緒——現在就能用「今天去哪」試整套引擎。
      </div>

      {/*
        落地頁的入口。推播上線後這是推播點進來的目的地，
        在那之前它也是唯一能真正試用整套引擎的畫面。
      */}
      <Link
        href="/today"
        className="flex items-center justify-between rounded-xl border border-black/15 dark:border-white/25 bg-foreground/[0.04] px-4 py-4"
      >
        <span className="font-medium">今天去哪</span>
        <span className="text-sm opacity-60">看今天的建議 →</span>
      </Link>

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

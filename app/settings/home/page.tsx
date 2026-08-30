import Link from "next/link";

import { getHomeBase } from "@/lib/db/queries";
import { TOWNSHIPS, type CountyName } from "@/lib/weather/townships";
import { HomeBaseForm } from "./home-base-form";

export const metadata = { title: "出發點設定 · KidGo" };

/** 這頁讀資料庫，不能靜態預先產生 */
export const dynamic = "force-dynamic";

export default async function HomeBaseSettingsPage() {
  const existing = await getHomeBase();

  // 尚未設定時給一個明顯是佔位的預設值，不猜使用者住哪裡。
  const fallback = TOWNSHIPS[0];

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8 flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href="/" className="text-sm opacity-60 hover:opacity-100">
          ← 回首頁
        </Link>
        <h1 className="text-2xl font-semibold">出發點</h1>
        <p className="text-sm opacity-70 leading-relaxed">
          {existing
            ? "所有地點的車程都以這裡為起點計算，天氣也抓這一區的預報。"
            : "還沒有設定。設定之後才能開始推薦——車程與天氣都需要一個起點。"}
        </p>
      </header>

      <div className="rounded-xl border border-black/10 dark:border-white/15 p-4 text-sm leading-relaxed opacity-80">
        這是<span className="font-semibold">固定的家</span>
        ，不是你當下的位置。每個地點的車程都是以它為起點量出來的，出遊紀錄也以它為錨點累積——
        它一旦移動，所有地點的車程基準會同時失效。
      </div>

      {/*
        key 讓儲存成功後整個表單重新掛載，帶著剛存進資料庫的值。
        沒有它的話，React 19 送出後的自動表單重置會讓 DOM 與 state 脫鉤——
        受控的 <select> 會顯示被重置的值，而 React state 還是舊的。
      */}
      {/*
        ⚠️ 已知副作用（2026-08-31 實測，暫不處理）：值一改 key 就變，整個
        表單重掛載，useActionState 的狀態跟著歸零——所以「已儲存」那行綠字
        永遠來不及顯示。資料是存對的，只是少一句確認。

        兩頁都有，因為這個 key 模式是共用的。要修得二選一：拿掉 key（上面
        那個 DOM 與 state 脫鉤的 bug 就會回來），或把提示移出表單、由 page
        依 ?saved=1 顯示。等落地頁做完、表單互動的樣貌定下來再一起決定。
      */}
      <HomeBaseForm
        key={
          existing
            ? `${existing.cwaCountyName}/${existing.cwaLocationName}/${existing.lat}/${existing.lng}/${existing.maxDriveMinutes}`
            : "new"
        }
        isNew={existing === null}
        initial={{
          county: (existing?.cwaCountyName ?? fallback.county) as CountyName,
          township: existing?.cwaLocationName ?? fallback.name,
          lat: existing?.lat ?? fallback.lat,
          lng: existing?.lng ?? fallback.lng,
          maxDriveMinutes: existing?.maxDriveMinutes ?? 45,
        }}
      />
    </main>
  );
}

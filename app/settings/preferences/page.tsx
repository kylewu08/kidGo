import Link from "next/link";

import { DEFAULT_FAMILY_PREFERENCE } from "@/lib/db/family-preference-input";
import { getStoredFamilyPreference } from "@/lib/db/queries";
import type { Rating } from "@/lib/db/schema";
import { PreferencesForm } from "./preferences-form";

export const metadata = { title: "家庭偏好 · KidGo" };

/** 這頁讀資料庫，不能靜態預先產生 */
export const dynamic = "force-dynamic";

export default async function PreferencesSettingsPage() {
  const existing = await getStoredFamilyPreference();
  const initial = existing ?? DEFAULT_FAMILY_PREFERENCE;

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8 flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href="/" className="text-sm opacity-60 hover:opacity-100">
          ← 回首頁
        </Link>
        <h1 className="text-2xl font-semibold">家庭偏好</h1>
        <p className="text-sm opacity-70 leading-relaxed">
          {existing
            ? "三題，隨時可以改。改完下一次推薦就會照新的來。"
            : "三題，現在用的是預設值。不填也能收到推薦，填了會更準。"}
        </p>
      </header>

      <div className="rounded-xl border border-black/10 dark:border-white/15 p-4 text-sm leading-relaxed opacity-80">
        這裡問的是<span className="font-semibold">你們家的常態</span>
        ，不是今天的狀況。臨時的變動——今天特別累、外婆一起去——
        用當天的一次性情境輸入處理，不必回來改這裡。
      </div>

      {/*
        key 讓儲存成功後整個表單重新掛載，帶著剛存進資料庫的值。
        理由與出發點表單相同，見 app/settings/home/page.tsx 的註解。
      */}
      <PreferencesForm
        key={
          existing
            ? `${existing.outdoorTendency}/${existing.maxParentEffort}/${existing.requiresMeal}`
            : "new"
        }
        isNew={existing === null}
        initial={{
          outdoorTendency: initial.outdoorTendency,
          maxParentEffort: initial.maxParentEffort as Rating,
          requiresMeal: initial.requiresMeal,
        }}
      />
    </main>
  );
}

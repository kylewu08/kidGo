import Link from "next/link";

import { CHILD_LABELS } from "@/lib/db/child-input";
import { listChildren } from "@/lib/db/queries";
import { ageInMonths } from "@/lib/schedule/napStage";

export const metadata = { title: "小孩 · KidGo" };
export const dynamic = "force-dynamic";

/** 24 個月以上顯示成「X 歲 Y 個月」，那比「31 個月」好讀 */
function formatAge(months: number): string {
  if (months < 24) return `${months} 個月`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest === 0 ? `${years} 歲` : `${years} 歲 ${rest} 個月`;
}

export default async function ChildrenPage() {
  const children = await listChildren();
  const now = new Date();

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8 flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <Link href="/" className="text-sm opacity-60 hover:opacity-100">
          ← 回首頁
        </Link>
        <h1 className="text-2xl font-semibold">小孩</h1>
        <p className="text-sm opacity-70 leading-relaxed">
          作息階段與行動能力是推薦的支點。它們每 3–6 個月變一次，
          變了記得回來改——推薦結果會跟著變。
        </p>
      </header>

      <Link
        href="/settings/children/new"
        className="rounded-xl border border-dashed border-black/25 dark:border-white/30 px-4 py-3 text-center text-base font-medium"
      >
        ＋ 新增小孩
      </Link>

      {children.length === 0 ? (
        <p className="rounded-xl border border-black/10 dark:border-white/15 p-4 text-sm leading-relaxed opacity-70">
          還沒有設定任何小孩。推薦引擎需要至少一個——月齡、午睡時間、
          會不會自己走，這三件事決定了大部分的判斷。
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {children.map((child) => (
            <li key={child.id}>
              <Link
                href={`/settings/children/${child.id}`}
                className="flex flex-col gap-1.5 rounded-xl border border-black/10 dark:border-white/15 px-4 py-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{child.name}</span>
                  <span className="shrink-0 text-sm opacity-60">
                    {formatAge(ageInMonths(child.birthDate, now))}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs opacity-65">
                  <span>{CHILD_LABELS.napStage[child.napStage].split("（")[0]}</span>
                  <span>{CHILD_LABELS.mobility[child.mobility]}</span>
                  {child.napWindows.length > 0 && (
                    <span>
                      午睡 {child.napWindows.map((w) => `${w.start}–${w.end}`).join("、")}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

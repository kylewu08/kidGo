import Link from "next/link";

import { DAY_INTENT_LABELS, type DayIntent } from "@/lib/domain/day-intent";

/**
 * 今天想去哪一類（ADR-0026）
 *
 * 用網址參數而不是表單送出：這是**只對本次有效**的選擇（§8.3），
 * 沒有任何東西該被寫進資料庫。網址參數天生就是這個語意——
 * 重新整理還在、關掉就沒了、可以直接分享一個帶意圖的連結。
 *
 * 「沒想法」不是一個值，是**不帶參數**。所以它不需要特別處理，
 * 也不會有「使用者選了沒想法」與「使用者沒選」的區別——那本來就是同一件事。
 */

const OPTIONS: DayIntent[] = ["air_conditioned", "run_around", "further_afield"];

export function DayIntentPicker({ current }: { current: DayIntent | null }) {
  const chip =
    "rounded-full border px-3.5 py-1.5 text-[0.8125rem] transition-colors";
  const on = "border-accent bg-accent/10 text-accent font-medium";
  const off = "border-surface-line text-muted hover:border-accent hover:text-accent";

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium tracking-[0.08em] text-muted">今天想去哪一類？</p>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((intent) => {
          const active = current === intent;
          return (
            <Link
              key={intent}
              // 再按一次就取消——「沒想法」就是不帶參數
              href={active ? "/today" : `/today?intent=${intent}`}
              className={`${chip} ${active ? on : off}`}
            >
              {DAY_INTENT_LABELS[intent]}
            </Link>
          );
        })}
        {current && (
          <Link href="/today" className={`${chip} ${off}`}>
            清除
          </Link>
        )}
      </div>
      {!current && (
        <p className="text-xs text-muted opacity-70">
          不選也可以，系統會照一般條件推薦。
        </p>
      )}
    </div>
  );
}

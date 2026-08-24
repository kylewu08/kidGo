import Link from "next/link";

import { LABELS } from "@/lib/db/place-input";
import {
  getHomeBase,
  listChildren,
  listPlaces,
  listVisits,
} from "@/lib/db/queries";
import { formatClock, type Recommendation } from "@/lib/recommend";
import { planToday } from "./today";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * 開發模式限定的時間覆寫，例如 `?now=2026-08-29T09:00`。
 *
 * 這個產品的輸出完全取決於「現在幾點」，所以在晚上十一點根本檢視不了
 * 「週六早上會推薦什麼」。scripts/smoke-recommend.ts 早就有同樣的參數，
 * 最重要的那個畫面沒有反而說不過去。
 *
 * **正式環境一律忽略。** 這是開發工具，不是功能——真正的使用者只會有
 * 一個「現在」，而讓他們能偽造它只會製造出無法重現的問題回報。
 */
function simulatedNow(raw: string | string[] | undefined): Date | null {
  if (process.env.NODE_ENV === "production") return null;
  if (typeof raw !== "string") return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * 首頁：今天去哪（設計架構書 §10.1）
 *
 * **一進來就是答案，不是搜尋框。** 這是 P2「答案優先，非清單」的具體落實，
 * 也是這個產品與所有旅遊 App 的分界。
 *
 * 不顯示分數。§6.5 說 scoreBreakdown 僅開發模式可見——
 * 使用者要的是「為什麼是這裡」，不是 82.5 這個數字。
 * 理由由 lib/recommend/reasons.ts 的規則模板產生，不是生成的（ADR-0002）。
 */
export default async function Home({
  searchParams,
}: PageProps<"/">) {
  const params = await searchParams;
  const [home, children, places, visits] = await Promise.all([
    getHomeBase(),
    listChildren(),
    listPlaces(),
    listVisits(),
  ]);

  const setupDone = home !== null && children.length > 0 && places.length > 0;
  if (!setupDone) {
    return <SetupGuide hasHome={home !== null} childCount={children.length} placeCount={places.length} />;
  }

  const maxDrive = Number(params.maxDrive);
  const until = typeof params.until === "string" ? params.until : undefined;

  const { recommendations, context, weatherError, routesError } = await planToday({
    home,
    children,
    places,
    visits,
    now: simulatedNow(params.now) ?? new Date(),
    maxDriveMinutes: Number.isInteger(maxDrive) && maxDrive > 0 ? maxDrive : undefined,
    until,
  });

  const now = context.timestamp;
  /**
   * 涵蓋「現在」的那個三小時預報時段。
   *
   * 找不到就是找不到——**不要退回 slots[0]**。CWA 只提供未來三天，
   * 超出範圍時第一筆是好幾天前的資料，拿它當現在的天氣顯示，
   * 使用者會看到「降雨 70%」卻不知道那是上週的。
   * 把過期的天氣講成當下的，是這個產品最不能犯的錯。
   */
  const nowSlot = context.weather.slots.find(
    (s) => s.startsAt.getTime() + 3 * 3600_000 > now.getTime(),
  );

  const [best, ...others] = recommendations;

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6 flex flex-col gap-5">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-medium">
          週{WEEKDAYS[now.getDay()]} {formatClock(now)}
        </span>
        {nowSlot ? (
          <span className="opacity-70">
            {nowSlot.condition} · 體感 {nowSlot.apparentTempC}°C · 降雨 {nowSlot.rainProbability}%
          </span>
        ) : (
          <span className="opacity-70">天氣資料暫時取不到</span>
        )}
      </header>

      {weatherError && (
        <Notice>天氣預報取得失敗，天氣沒有被納入這次的判斷。（{weatherError}）</Notice>
      )}
      {routesError && (
        <Notice>即時路況取得失敗，車程用的是建檔時填的值。（{routesError}）</Notice>
      )}

      {best === undefined ? (
        <NothingToday
          until={context.availableWindow.end}
          maxDriveMinutes={context.maxDriveMinutes}
          placeCount={places.length}
        />
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h1 className="text-sm font-semibold opacity-70">今天建議</h1>
            <BestCard recommendation={best} />
          </section>

          {others.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold opacity-70">其他選項</h2>
              <ul className="flex flex-col gap-2">
                {others.slice(0, 4).map((r) => (
                  <li key={r.place.id}>
                    <OtherOption recommendation={r} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <Adjust
        maxDriveMinutes={context.maxDriveMinutes}
        until={context.availableWindow.end}
      />

      <nav className="flex gap-3 border-t border-black/10 dark:border-white/15 pt-4 text-sm opacity-60">
        <Link href="/places">地點（{places.length}）</Link>
        <Link href="/settings/children">小孩（{children.length}）</Link>
        <Link href="/settings/home">出發點</Link>
      </nav>
    </main>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-600/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed opacity-85">
      {children}
    </p>
  );
}

function EnergyDots({ level }: { level: number }) {
  return (
    <span className="font-mono tracking-tight" aria-label={`放電強度 ${level}`}>
      {"●".repeat(level)}
      <span className="opacity-30">{"○".repeat(5 - level)}</span>
    </span>
  );
}

function mapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function BestCard({ recommendation: r }: { recommendation: Recommendation }) {
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-black/15 dark:border-white/20 p-4">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold">{r.place.name}</h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm opacity-70">
          <span>
            車程 {r.driveMinutes} 分
            {r.driveMinutesSource === "live" && (
              <span className="ml-1 text-xs opacity-70">即時</span>
            )}
          </span>
          <EnergyDots level={r.place.energyBurn} />
          <span>{LABELS.indoor[r.place.indoor]}</span>
        </div>
      </div>

      {r.reasons.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {r.reasons.map((reason) => (
            <li key={reason} className="flex gap-2 text-sm leading-relaxed">
              <span className="opacity-50">✓</span>
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      )}

      {r.warnings.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {r.warnings.map((warning) => (
            <li key={warning} className="flex gap-2 text-sm leading-relaxed opacity-75">
              <span className="opacity-60">⚠</span>
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs opacity-55">
        {r.suggestedDeparture} 出發 · {r.suggestedReturn} 到家
      </p>

      <div className="flex gap-2 pt-1">
        <a
          href={mapsUrl(r.place.lat, r.place.lng)}
          target="_blank"
          rel="noreferrer"
          className="flex-1 rounded-lg bg-foreground px-4 py-2.5 text-center text-base font-medium text-background"
        >
          導航
        </a>
        <Link
          href={`/places/${r.place.id}`}
          className="rounded-lg border border-black/15 dark:border-white/20 px-4 py-2.5 text-center text-base"
        >
          細節
        </Link>
      </div>

      {/*
        §6.5：scoreBreakdown 是除錯用的，UI 預設不顯示。
        使用者要的是「為什麼是這裡」，不是 82.5 這個數字。
      */}
      {process.env.NODE_ENV !== "production" && (
        <details className="text-xs opacity-45">
          <summary className="cursor-pointer">評分明細（開發模式）</summary>
          <p className="pt-1 font-mono">
            {r.score.toFixed(1)} ={" "}
            {Object.entries(r.scoreBreakdown)
              .map(([k, v]) => `${k} ${v.toFixed(2)}`)
              .join(" · ")}
          </p>
        </details>
      )}
    </article>
  );
}

function OtherOption({ recommendation: r }: { recommendation: Recommendation }) {
  return (
    <Link
      href={`/places/${r.place.id}`}
      className="flex flex-col gap-1 rounded-xl border border-black/10 dark:border-white/15 px-4 py-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{r.place.name}</span>
        <span className="shrink-0 text-xs opacity-55">
          {LABELS.indoor[r.place.indoor]} · 車程 {r.driveMinutes} 分
        </span>
      </div>
      {r.reasons[0] && (
        <span className="text-xs opacity-65 leading-relaxed">{r.reasons[0]}</span>
      )}
    </Link>
  );
}

/**
 * 調整條件（§10.1）。
 *
 * 用原生 GET 表單而不是 client component：條件會寫進網址，
 * 重新整理不會消失，也不需要任何 JavaScript。
 */
function Adjust({ maxDriveMinutes, until }: { maxDriveMinutes: number; until: string }) {
  return (
    <details className="rounded-xl border border-black/10 dark:border-white/15 px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium">調整條件</summary>
      <form method="get" className="flex flex-col gap-3 pt-3">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>車程上限</span>
          <span className="flex items-center gap-2">
            <input
              name="maxDrive"
              type="number"
              min={1}
              defaultValue={maxDriveMinutes}
              className="w-20 rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-2 py-1.5 text-base"
            />
            <span className="opacity-60">分</span>
          </span>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>要在幾點前到家</span>
          <input
            name="until"
            type="time"
            defaultValue={until}
            className="rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-2 py-1.5 text-base"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
          >
            重新推薦
          </button>
          <Link href="/" className="self-center text-sm opacity-60">
            回到預設
          </Link>
        </div>
      </form>
    </details>
  );
}

function NothingToday({
  until,
  maxDriveMinutes,
  placeCount,
}: {
  until: string;
  maxDriveMinutes: number;
  placeCount: number;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-black/15 dark:border-white/20 p-4">
      <h1 className="text-lg font-semibold">今天沒有適合的地點</h1>
      <p className="text-sm leading-relaxed opacity-75">
        {placeCount} 個地點全都被過濾掉了。可能是時間不夠（要在 {until} 前到家）、
        車程超過 {maxDriveMinutes} 分，或是天氣不適合。
      </p>
      <p className="text-sm leading-relaxed opacity-75">
        這是正常結果，不是故障——有些日子就是不適合出門。
        下面可以放寬條件再看一次。
      </p>
    </section>
  );
}

function SetupGuide({
  hasHome,
  childCount,
  placeCount,
}: {
  hasHome: boolean;
  childCount: number;
  placeCount: number;
}) {
  const steps = [
    { done: hasHome, href: "/settings/home", label: "設定出發點", detail: "車程與天氣都需要一個起點" },
    { done: childCount > 0, href: "/settings/children", label: "設定小孩", detail: "月齡與作息是推薦的支點" },
    { done: placeCount > 0, href: "/places", label: "建立地點", detail: "先加幾個你這幾個月真的去過的地方" },
  ];

  return (
    <main className="mx-auto w-full max-w-md px-5 py-10 flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold">KidGo</h1>
        <p className="text-sm opacity-70">這個週末帶小孩去哪</p>
      </header>

      <p className="text-sm leading-relaxed opacity-75">
        還差幾個設定才能開始推薦。這三件事做完之後，首頁就會直接給答案。
      </p>

      <ol className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <li key={step.href}>
            <Link
              href={step.href}
              className="flex items-center gap-3 rounded-xl border border-black/10 dark:border-white/15 px-4 py-3.5"
            >
              <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${step.done ? "bg-foreground text-background" : "border border-black/20 dark:border-white/25"}`}>
                {step.done ? "✓" : i + 1}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{step.label}</span>
                <span className="text-xs opacity-60">{step.detail}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </main>
  );
}

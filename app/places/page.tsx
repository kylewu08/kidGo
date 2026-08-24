import Link from "next/link";

import { LABELS } from "@/lib/db/place-input";
import { listPlaces } from "@/lib/db/queries";

export const metadata = { title: "地點 · KidGo" };
export const dynamic = "force-dynamic";

/** 放電強度用實心圓顯示，掃視時比數字快 */
function EnergyDots({ level }: { level: number }) {
  return (
    <span className="font-mono tracking-tight" aria-label={`放電強度 ${level}`}>
      {"●".repeat(level)}
      <span className="opacity-30">{"○".repeat(5 - level)}</span>
    </span>
  );
}

export default async function PlacesPage() {
  const places = await listPlaces();

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8 flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <Link href="/" className="text-sm opacity-60 hover:opacity-100">
          ← 回首頁
        </Link>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold">地點</h1>
          <span className="text-sm opacity-60">{places.length} 個</span>
        </div>
        <p className="text-sm opacity-70 leading-relaxed">
          v1 的目標是 40–60 個你實際會去的地方。
          {places.length > 0 && places.length < 40 && (
            <> 還差 {40 - places.length} 個才到下限。</>
          )}
        </p>
      </header>

      <Link
        href="/places/new"
        className="rounded-xl border border-dashed border-black/25 dark:border-white/30 px-4 py-3 text-center text-base font-medium"
      >
        ＋ 新增地點
      </Link>

      {places.length === 0 ? (
        <p className="rounded-xl border border-black/10 dark:border-white/15 p-4 text-sm leading-relaxed opacity-70">
          還沒有任何地點。推薦引擎需要地點才有東西可以推薦——
          先加幾個你這幾個月真的去過的地方，不用一次加滿。
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {places.map((place) => (
            <li key={place.id}>
              <Link
                href={`/places/${place.id}`}
                className="flex flex-col gap-1.5 rounded-xl border border-black/10 dark:border-white/15 px-4 py-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{place.name}</span>
                  <span className="shrink-0 text-xs opacity-55">
                    {LABELS.category[place.category]}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs opacity-65">
                  <span>車程 {place.driveMinutes} 分</span>
                  <EnergyDots level={place.energyBurn} />
                  <span>{LABELS.indoor[place.indoor]}</span>
                  <span>
                    {place.ageRange.minMonths}–{place.ageRange.maxMonths} 個月
                  </span>
                  {place.needsReservation && <span>需預約</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

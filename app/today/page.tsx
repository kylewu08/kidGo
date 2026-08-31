import Link from "next/link";

import { upsertTodaySuggestion } from "@/lib/db/queries";
import type { Recommendation, SlotKind } from "@/lib/recommend";
import { buildToday } from "@/lib/today/build";
import { ResponseButtons } from "./response-buttons";

export const metadata = { title: "今天去哪 · KidGo" };

/** 天氣、路況、時間都會變，不能靜態預先產生 */
export const dynamic = "force-dynamic";

/**
 * 推播落地頁（設計架構書 §12 Phase 1 最後一項）
 *
 * 規格對這一頁著墨極少——「落地頁」在整份文件只出現三次。但資料模型
 * 早就替它準備好了：suggestions 表的 explorePlaceId 註解直接寫著
 * 「引擎產出三項，但推播只顯示前兩項（§9.1），這一項在落地頁才看得到」。
 *
 * **所以這一頁不是推播文案的複製品**：
 * - 推播只列主建議與備案（§9.1「不列第三個」）
 * - 落地頁多了探索槽（§7.4）與參考欄（ADR-0021）
 *
 * §8 的一次性情境輸入框尚未實作——它需要 lib/ai/，那裡目前只有 README。
 */

/** 可用時間窗的結束。之後應該可設定，先給一個不擋路的預設。 */
const DEFAULT_AVAILABLE_UNTIL = "18:00";

const SLOT_LABEL: Record<SlotKind, string> = {
  primary: "今天建議",
  backup: "備案",
  explore: "換換口味",
};

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export default async function TodayPage() {
  const now = new Date();
  const data = await buildToday({
    now,
    availableUntil: DEFAULT_AVAILABLE_UNTIL,
    cwaApiKey: process.env.CWA_API_KEY,
    routesApiKey: process.env.GOOGLE_ROUTES_API_KEY,
  });

  if (data.status.kind !== "ok" || !data.result) {
    return <Blocked status={data.status} />;
  }

  const { result } = data;
  const primary = result.slots.find((s) => s.slot === "primary") ?? null;

  /*
   * 一天一筆，不是開一次頁建一筆。
   *
   * 採納率是 §9.3 的長期主力訊號；分母被重新整理灌大之後，系統會以為
   * 自己的建議一直被無視，於是壓低那個類別的權重——只因為使用者多按了
   * 兩次重新整理。kind 用 "opened" 標明它不是推播送出的那種。
   */
  const dateKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const suggestion = await upsertTodaySuggestion(
    dateKey,
    "opened",
    {
      primaryPlaceId: primary?.place.id ?? null,
      backupPlaceId: result.slots.find((s) => s.slot === "backup")?.place.id ?? null,
      explorePlaceId: result.slots.find((s) => s.slot === "explore")?.place.id ?? null,
      suggestedDeparture: primary?.suggestedDeparture ?? null,
      suggestedReturn: primary?.suggestedReturn ?? null,
      noOutingReason: result.noOutingReason,
    },
    now,
  );

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8 flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href="/" className="text-sm opacity-60 hover:opacity-100">
          ← 回首頁
        </Link>
        <h1 className="text-2xl font-semibold">今天去哪</h1>
        <p className="text-sm opacity-70">
          {now.getMonth() + 1}/{now.getDate()}（週{WEEKDAYS[now.getDay()]}）
          {" · "}
          {data.currentWeather
            ? `${data.currentWeather.condition} · 體感 ${data.currentWeather.apparentTempC}°C · 降雨 ${data.currentWeather.rainProbability}%`
            : "這個時間點沒有預報資料"}
          {" · "}可用到 {data.availableWindow.end}
        </p>
      </header>

      {/* §10.3.5：路況降級必須明示，不得靜默使用低信心估值 */}
      {data.driveNotice && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
          ⚠ {data.driveNotice}
        </p>
      )}

      {/* §7.4 防線一：受限情境下偏好權重歸零 */}
      {result.preferenceSuppressed && (
        <p className="rounded-xl border border-black/10 dark:border-white/15 px-4 py-3 text-sm opacity-75">
          今天條件受限，已暫時忽略你們家的偏好，讓所有選項以原始分數競爭。
        </p>
      )}

      {result.slots.length === 0 ? (
        /* §9.1：不得沉默，也不得降低標準硬推 */
        <section className="rounded-xl border border-black/15 dark:border-white/20 p-5 flex flex-col gap-2">
          <h2 className="text-lg font-semibold">今天不要出門</h2>
          <p className="text-sm leading-relaxed opacity-80">
            {result.noOutingReason ?? "今天沒有適合的地點。"}
          </p>
          <p className="text-xs opacity-55">
            這也是一個答案——它省下了糾結的成本。系統不會為了給出建議而降低標準。
          </p>
        </section>
      ) : (
        <div className="flex flex-col gap-3">
          {result.slots.map((r) => (
            <SlotCard key={r.place.id} rec={r} />
          ))}
        </div>
      )}

      {/* ADR-0021：參考欄不是第四個推薦，必須連同剔除理由一起呈現 */}
      {data.referenceNote && (
        <section className="rounded-xl border border-dashed border-black/20 dark:border-white/25 px-4 py-3.5 flex flex-col gap-1">
          <p className="text-xs opacity-55">今天不行，但改天可以</p>
          <p className="text-sm font-medium">{data.referenceNote.result.place.name}</p>
          <p className="text-xs opacity-70">
            {`今天${REJECTION_LABEL[data.referenceNote.rejectedBy] ?? "條件不符"}，所以沒有進入建議。`}
          </p>
        </section>
      )}

      <ResponseButtons suggestionId={suggestion.id} response={suggestion.response} />

      <p className="text-xs opacity-45 leading-relaxed">
        {data.placeCount} 個地點 → 硬過濾後剩 {result.scored.length} 個
        {data.preciseCount > 0 && ` · ${data.preciseCount} 個取得即時路況`}
      </p>
    </main>
  );
}

function SlotCard({ rec }: { rec: Recommendation }) {
  return (
    <section className="rounded-xl border border-black/15 dark:border-white/20 p-4 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs opacity-55">{SLOT_LABEL[rec.slot!]}</span>
        <span className="text-xs opacity-45">
          {rec.status === "verified" ? "去過" : "還沒去過"}
        </span>
      </div>

      <h2 className="text-lg font-semibold leading-snug">{rec.place.name}</h2>

      <p className="text-sm opacity-80">
        車程 {rec.drive.outboundMinutes} 分
        <span className="opacity-60">
          （{rec.drive.source === "precise" ? "即時" : "估算"}）
        </span>
        {" · "}
        {rec.suggestedDeparture} 出發
        {/* §7.5：沒去過的地方不給精確返家時間，停留時長只是估計值 */}
        {rec.suggestedReturn && ` · ${rec.suggestedReturn} 到家`}
      </p>

      {rec.reasons.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-sm opacity-80">
          {rec.reasons.map((reason) => (
            <li key={reason}>· {reason}</li>
          ))}
        </ul>
      )}

      {rec.warnings.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-sm text-amber-700 dark:text-amber-400">
          {rec.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

const REJECTION_LABEL: Record<string, string> = {
  heat: "太熱",
  rain: "會下雨",
  not_enough_time: "時間不夠來回",
};

/** 還不能推薦時的引導。缺什麼就說缺什麼，不要給一個空畫面。 */
function Blocked({ status }: { status: { kind: string; message?: string } }) {
  const COPY: Record<string, { title: string; body: string; href?: string; cta?: string }> = {
    no_home: {
      title: "還沒設定出發點",
      body: "車程與天氣都需要一個起點，設定完就能開始推薦。",
      href: "/settings/home",
      cta: "去設定出發點",
    },
    no_children: {
      title: "還沒設定小孩",
      body: "適齡判斷與作息契合度都以小孩為支點，沒有它沒有推薦可言。",
      href: "/settings/children/new",
      cta: "去新增小孩",
    },
    no_places: {
      title: "資料庫裡還沒有地點",
      body: "先跑一次匯入器：scripts/import-places.ts",
    },
    weather_unavailable: {
      title: "天氣暫時取不到",
      body:
        "硬過濾的下雨與高溫判斷都依賴預報。沒有它就等於關掉了那兩層保護，" +
        "所以這裡不給推薦，而不是給一個看起來正常、實際上少了保護的結果。",
    },
  };
  const copy = COPY[status.kind] ?? { title: "還不能推薦", body: "" };

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8 flex flex-col gap-5">
      <Link href="/" className="text-sm opacity-60 hover:opacity-100">
        ← 回首頁
      </Link>
      <h1 className="text-2xl font-semibold">{copy.title}</h1>
      <p className="text-sm leading-relaxed opacity-75">{copy.body}</p>
      {status.message && (
        <p className="rounded-lg border border-black/10 dark:border-white/15 px-3 py-2 font-mono text-xs opacity-60">
          {status.message}
        </p>
      )}
      {copy.href && (
        <Link
          href={copy.href}
          className="self-start rounded-lg bg-foreground px-5 py-2.5 text-background text-base font-medium"
        >
          {copy.cta}
        </Link>
      )}
    </main>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

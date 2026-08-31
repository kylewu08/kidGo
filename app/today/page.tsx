import Link from "next/link";

import { upsertTodaySuggestion } from "@/lib/db/queries";
import type { Place } from "@/lib/db/schema";
import type { Recommendation } from "@/lib/recommend";
import { mapsUrl } from "@/lib/places/maps-link";
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

  const primaryRec = result.slots.find((s) => s.slot === "primary") ?? null;
  const backupRec = result.slots.find((s) => s.slot === "backup") ?? null;
  const exploreRec = result.slots.find((s) => s.slot === "explore") ?? null;

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-6 pb-[calc(2rem+env(safe-area-inset-bottom))] flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <Link href="/" className="text-sm text-muted hover:text-foreground">
          ← 回首頁
        </Link>
        <h1 className="text-[1.75rem] leading-none font-semibold tracking-tight">
          今天去哪
        </h1>

        {/* 條件列。數字用等寬，重新整理時才不會左右跳動 */}
        <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-muted">
          <div className="flex items-baseline gap-1.5">
            <dt className="sr-only">日期</dt>
            <dd className="tnum">
              {now.getMonth() + 1}/{now.getDate()}
            </dd>
            <span>週{WEEKDAYS[now.getDay()]}</span>
          </div>
          {data.currentWeather && (
            <>
              <div className="flex items-baseline gap-1.5">
                <dt className="sr-only">天氣</dt>
                <dd>{data.currentWeather.condition}</dd>
              </div>
              <div className="flex items-baseline gap-1.5">
                <dt>體感</dt>
                <dd className="tnum text-foreground">
                  {data.currentWeather.apparentTempC}°
                </dd>
              </div>
              <div className="flex items-baseline gap-1.5">
                <dt>降雨</dt>
                <dd className="tnum text-foreground">
                  {data.currentWeather.rainProbability}%
                </dd>
              </div>
            </>
          )}
          <div className="flex items-baseline gap-1.5">
            <dt>可用到</dt>
            <dd className="tnum text-foreground">{data.availableWindow.end}</dd>
          </div>
        </dl>
      </header>

      {/* §10.3.5：路況降級必須明示，不得靜默使用低信心估值 */}
      {data.driveNotice && (
        <p className="rounded-xl border border-warn/35 px-4 py-3 text-sm text-warn">
          ⚠ {data.driveNotice}
        </p>
      )}

      {/* §7.4 防線一：受限情境下偏好權重歸零 */}
      {result.preferenceSuppressed && (
        <p className="rounded-xl bg-surface px-4 py-3 text-sm text-muted">
          今天條件受限，已暫時忽略你們家的偏好，讓所有選項以原始分數競爭。
        </p>
      )}

      {result.slots.length === 0 ? (
        /* §9.1：不得沉默，也不得降低標準硬推 */
        <section className="rounded-2xl bg-surface px-5 py-6 flex flex-col gap-2.5">
          <h2 className="text-lg font-semibold">今天不要出門</h2>
          <p className="text-sm leading-relaxed">
            {result.noOutingReason ?? "今天沒有適合的地點。"}
          </p>
          <p className="text-xs leading-relaxed text-muted">
            這也是一個答案——它省下了糾結的成本。系統不會為了給出建議而降低標準。
          </p>
        </section>
      ) : (
        /*
         * 三個槽位用三個不同的元件，不是同一張卡換文字。
         *
         * P3「答案優先，非清單」：引擎分了主建議 / 備案 / 探索槽三種
         * 語意，排版若給它們一樣的視覺權重，使用者看到的就是一個三項
         * 清單而不是一個決定。這裡的層級差異是在還原決策層已經做過的判斷。
         */
        <div className="flex flex-col gap-4">
          {primaryRec && <PrimaryCard rec={primaryRec} />}
          {backupRec && <BackupCard rec={backupRec} />}
          {exploreRec && <ExploreCard rec={exploreRec} />}
        </div>
      )}

      {/* ADR-0021：參考欄不是第四個推薦，必須連同剔除理由一起呈現 */}
      {data.referenceNote && (
        <section className="rounded-xl border border-dashed border-surface-line px-4 py-3.5 flex flex-col gap-1">
          <p className="text-xs tracking-[0.08em] text-muted">今天不行，但改天可以</p>
          <p className="text-sm font-medium">{data.referenceNote.result.place.name}</p>
          <p className="text-xs text-muted">
            {`今天${REJECTION_LABEL[data.referenceNote.rejectedBy] ?? "條件不符"}，所以沒有進入建議。`}
          </p>
          {/* 參考欄照定義就是「你還不知道存在的地方」，最需要這個連結 */}
          <WhereLink place={data.referenceNote.result.place} />
        </section>
      )}

      <ResponseButtons suggestionId={suggestion.id} response={suggestion.response} />

      <p className="text-xs leading-relaxed text-muted opacity-80">
        {data.placeCount} 個地點 → 硬過濾後剩 {result.scored.length} 個
        {data.preciseCount > 0 && ` · ${data.preciseCount} 個取得即時路況`}
      </p>
    </main>
  );
}

/**
 * 「看看這是哪」（ADR-0011 修訂四）
 *
 * 承認並加速「跳出去查」這個行為，而不是假裝它不存在。**開的是地點頁
 * 不是導航**——使用者想知道的是「這是什麼地方」，不是「怎麼開過去」。
 *
 * 不放照片是 ADR-0011 的明確決定：開放資料集通常沒有照片，
 * 而地圖服務的照片有授權限制。
 */
function WhereLink({ place }: { place: Pick<Place, "name" | "lat" | "lng"> }) {
  return (
    <a
      href={mapsUrl(place)}
      target="_blank"
      rel="noopener noreferrer"
      className="self-start text-[0.8125rem] text-accent underline underline-offset-4 decoration-accent/40 hover:decoration-accent"
    >
      看看這是哪 ↗
    </a>
  );
}

/**
 * 理由與警示。三個槽位共用，因為它們是決策層的輸出——
 * 文字由 lib/recommend/reasons.ts 產生，UI 只負責排版（憲法第 9 條：
 * 推播文案與推薦理由共用同一組規則模板，不由 UI 改寫）。
 *
 * **警示在三個層級都完整顯示**，不因為層級低就收起來。
 * 高溫、降雨、估算車程都是安全與誠實的資訊（§10.3.5），
 * 不是可以為了版面整潔而犧牲的裝飾。
 */
function Notes({ rec, dense }: { rec: Recommendation; dense?: boolean }) {
  const size = dense ? "text-[0.8125rem]" : "text-sm";
  return (
    <>
      {rec.reasons.length > 0 && (
        <ul className={`flex flex-col gap-1 ${size}`}>
          {rec.reasons.map((reason) => (
            <li key={reason} className="flex gap-2">
              <span aria-hidden className="select-none opacity-40">
                —
              </span>
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      )}
      {rec.warnings.length > 0 && (
        <ul className={`flex flex-col gap-1 ${size} text-warn`}>
          {rec.warnings.map((w) => (
            <li key={w} className="flex gap-2">
              <span aria-hidden className="select-none">
                ⚠
              </span>
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** 車程與出發時間。§7.5：沒去過的地方不給精確返家時間。 */
function Trip({ rec, big }: { rec: Recommendation; big?: boolean }) {
  return (
    <p className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 ${big ? "text-sm" : "text-[0.8125rem]"}`}>
      <span>
        車程 <span className="tnum">{rec.drive.outboundMinutes}</span> 分
        <span className="opacity-60">
          （{rec.drive.source === "precise" ? "即時" : "估算"}）
        </span>
      </span>
      {rec.suggestedReturn && (
        <span className="opacity-70">
          <span className="tnum">{rec.suggestedReturn}</span> 到家
        </span>
      )}
    </p>
  );
}

/**
 * 主建議。**出發時間是這一頁的主角。**
 *
 * §9.1 要求出發時間具體到分鐘，而這正是整個產品的原子——
 * 使用者週六早上要的不是「哪裡不錯」，是「幾點出門」。
 * 所以它是版面上最大的東西，比地點名稱還大。
 */
function PrimaryCard({ rec }: { rec: Recommendation }) {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-surface">
      {/* 左側的實色軸線。不用陰影分層——陰影在深色模式幾乎看不見 */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-accent" />

      <div className="flex flex-col gap-4 py-5 pl-6 pr-5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs font-medium tracking-[0.08em] text-accent">
            今天建議
          </span>
          <span className="text-xs text-muted">
            {rec.status === "verified" ? "去過" : "還沒去過"}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2">
            <span className="tnum text-[3.25rem] leading-[0.9] font-semibold tracking-tight">
              {rec.suggestedDeparture}
            </span>
            <span className="text-base text-muted">出發</span>
          </div>
          <h2 className="text-xl font-semibold leading-snug">{rec.place.name}</h2>
        </div>

        <Trip rec={rec} big />
        <Notes rec={rec} />
        <WhereLink place={rec.place} />
      </div>
    </section>
  );
}

/**
 * 備案。§7.3 保證它至少有一個室內選項，供天氣突變。
 *
 * 視覺上明顯退一階：只有外框、沒有底色、出發時間縮回內文大小。
 * 它存在的意義是「主建議不成立時還有這個」，不是第二個答案。
 */
function BackupCard({ rec }: { rec: Recommendation }) {
  return (
    <section className="rounded-2xl border border-surface-line px-5 py-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium tracking-[0.08em] text-muted">
          備案
        </span>
        <span className="text-xs text-muted">
          {rec.status === "verified" ? "去過" : "還沒去過"}
        </span>
      </div>

      <div className="flex items-baseline gap-2.5">
        <span className="tnum text-lg font-semibold">{rec.suggestedDeparture}</span>
        <h2 className="text-base font-medium leading-snug">{rec.place.name}</h2>
      </div>

      <Trip rec={rec} />
      <Notes rec={rec} dense />
      <WhereLink place={rec.place} />
    </section>
  );
}

/**
 * 探索槽（§7.4 防同溫層）。
 *
 * 退到最低一階：沒有外框、沒有底色。**但不能拿掉。**
 * §7.4 明文規定不得為了「提升推薦精準度」而移除探索槽——
 * 它偶爾會推出使用者明知不會去的地點，那是保險費不是缺陷。
 * 排版上把它做輕，是讓它不干擾決定，不是讓它消失。
 */
function ExploreCard({ rec }: { rec: Recommendation }) {
  return (
    <section className="px-1 flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-medium tracking-[0.08em] text-muted">
          換換口味
        </span>
        <span className="text-xs text-muted opacity-70">平常不會排到的類別</span>
      </div>

      <div className="flex items-baseline gap-2.5">
        <span className="tnum text-base text-muted">{rec.suggestedDeparture}</span>
        <h2 className="text-base font-medium leading-snug">{rec.place.name}</h2>
      </div>

      <div className="text-muted">
        <Trip rec={rec} />
      </div>
      <Notes rec={rec} dense />
      <WhereLink place={rec.place} />
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
      <Link href="/" className="text-sm text-muted hover:text-foreground">
        ← 回首頁
      </Link>
      <h1 className="text-2xl font-semibold">{copy.title}</h1>
      <p className="text-sm leading-relaxed text-muted">{copy.body}</p>
      {status.message && (
        <p className="rounded-lg bg-surface px-3 py-2 font-mono text-xs text-muted">
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

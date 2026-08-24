"use client";

import { useActionState } from "react";

import {
  CATEGORIES,
  INDOOR_TYPES,
  LABELS,
  PARKING_RATINGS,
  TIME_SLOTS,
} from "@/lib/db/place-input";
import type { Place } from "@/lib/db/schema";
import {
  createPlaceAction,
  updatePlaceAction,
  type PlaceFormState,
} from "./actions";

/**
 * 地點建檔表單（設計架構書 §10.3）
 *
 * 「表單要能快速填，用滑桿／選項而非打字」——所以 1–5 的評級一律做成
 * 一排可點的按鈕，而不是輸入框或下拉。建 40–60 個地點時，
 * 每個欄位少一次鍵盤切換，累積起來就是「一個晚上」和「數個週末」的差別。
 *
 * 這裡刻意不做即時驗證。驗證只有一份，在 lib/db/place-input.ts，
 * 由 Server Action 呼叫。前端再寫一份會有兩個問題：兩份規則會慢慢分岔，
 * 而且前端那份沒有測試守著。錯誤訊息從伺服器回來慢個幾十毫秒，
 * 換取「規則只有一個來源」是划算的。
 */

const initialState: PlaceFormState = { status: "idle" };

const inputClass =
  "rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2.5 text-base w-full";

function Section({ title, hint, children }: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold tracking-wide opacity-90">{title}</h2>
        {hint && <p className="text-xs opacity-55 leading-relaxed">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs opacity-55 leading-relaxed">{hint}</span>}
    </label>
  );
}

/** 一排可點的數字，取代輸入框。手機上一次點擊就選好，不用叫出鍵盤。 */
function Scale({ name, values, defaultValue, labels }: {
  name: string;
  values: number[];
  defaultValue: number;
  labels?: [string, string];
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1.5">
        {values.map((v) => (
          <label key={v} className="flex-1">
            <input
              type="radio"
              name={name}
              value={v}
              defaultChecked={v === defaultValue}
              className="peer sr-only"
            />
            <span className="block cursor-pointer rounded-lg border border-black/15 dark:border-white/20 py-2 text-center text-base peer-checked:bg-foreground peer-checked:text-background peer-checked:border-transparent">
              {v}
            </span>
          </label>
        ))}
      </div>
      {labels && (
        <div className="flex justify-between text-xs opacity-45">
          <span>{labels[0]}</span>
          <span>{labels[1]}</span>
        </div>
      )}
    </div>
  );
}

/**
 * `value` 對單一布林欄位可以省略（只看有沒有這個 key），
 * 但對 bestTimeSlots 這種同名多選的欄位**必須給**——
 * 沒給的話勾選送出的會是 checkbox 預設的 "on"，四個時段全部變成同一個值。
 * 這是實際跑起來才發現的，型別檢查看不出來。
 */
function Toggle({ name, label, defaultChecked, value }: {
  name: string;
  label: string;
  defaultChecked: boolean;
  value?: string;
}) {
  return (
    <label className="flex items-center gap-2.5 rounded-lg border border-black/10 dark:border-white/15 px-3 py-2.5">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="size-4 accent-current"
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}

export interface PlaceFormProps {
  /** 有值代表編輯，沒有代表新增 */
  place?: Place;
}

/** 表單每一格的預設值，型別統一成字串以免 defaultValue 在數字與空字串之間搖擺 */
interface FormDefaults {
  name: string;
  category: string;
  address: string;
  lat: string;
  lng: string;
  driveMinutes: string;
  parking: string;
  energyBurn: number;
  typicalDurationMin: string;
  bestTimeSlots: string[];
  ageMinMonths: string;
  ageMaxMonths: string;
  sweetSpotMinMonths: string;
  sweetSpotMaxMonths: string;
  indoor: string;
  shadeLevel: number;
  strollerFriendly: boolean;
  hasChangingTable: boolean;
  hasNursingSpace: boolean;
  hasFoodOnSite: boolean;
  hasWaterPlay: boolean;
  needsReservation: boolean;
  crowdWeekday: number;
  crowdWeekend: number;
  quietHours: string;
  costPerFamily: string;
  personalRating: number | null;
  notes: string;
  tags: string;
}

function defaultsFrom(state: PlaceFormState, place?: Place): FormDefaults {
  const r = state.values;
  if (r) {
    return {
      ...r,
      energyBurn: Number(r.energyBurn) || 3,
      shadeLevel: Number(r.shadeLevel) || 0,
      crowdWeekday: Number(r.crowdWeekday) || 2,
      crowdWeekend: Number(r.crowdWeekend) || 4,
      personalRating: r.personalRating === "" ? null : Number(r.personalRating),
    };
  }
  return {
    name: place?.name ?? "",
    category: place?.category ?? "park",
    address: place?.address ?? "",
    lat: place ? String(place.lat) : "",
    lng: place ? String(place.lng) : "",
    driveMinutes: place ? String(place.driveMinutes) : "",
    parking: place?.parking ?? "moderate",
    energyBurn: place?.energyBurn ?? 3,
    typicalDurationMin: place ? String(place.typicalDurationMin) : "120",
    bestTimeSlots: place?.bestTimeSlots ?? [],
    ageMinMonths: place ? String(place.ageRange.minMonths) : "6",
    ageMaxMonths: place ? String(place.ageRange.maxMonths) : "96",
    sweetSpotMinMonths: place?.sweetSpotAge ? String(place.sweetSpotAge.minMonths) : "",
    sweetSpotMaxMonths: place?.sweetSpotAge ? String(place.sweetSpotAge.maxMonths) : "",
    indoor: place?.indoor ?? "outdoor",
    shadeLevel: place?.shadeLevel ?? 2,
    strollerFriendly: place?.strollerFriendly ?? true,
    hasChangingTable: place?.hasChangingTable ?? false,
    hasNursingSpace: place?.hasNursingSpace ?? false,
    hasFoodOnSite: place?.hasFoodOnSite ?? false,
    hasWaterPlay: place?.hasWaterPlay ?? false,
    needsReservation: place?.needsReservation ?? false,
    crowdWeekday: place?.crowdLevel.weekday ?? 2,
    crowdWeekend: place?.crowdLevel.weekend ?? 4,
    quietHours: place?.quietHours ?? "",
    costPerFamily: place?.costPerFamily != null ? String(place.costPerFamily) : "",
    personalRating: place?.personalRating ?? null,
    notes: place?.notes ?? "",
    tags: place?.tags.join(", ") ?? "",
  };
}

export function PlaceForm({ place }: PlaceFormProps) {
  const isEdit = place !== undefined;
  const [state, formAction, pending] = useActionState(
    isEdit ? updatePlaceAction : createPlaceAction,
    initialState,
  );

  /**
   * 欄位預設值的來源，依序：驗證失敗時退回來的值 → 既有地點 → 新增用的預設。
   *
   * React 19 會在 Server Action 完成後重置表單 DOM，所以錯一個欄位就會清空
   * 全部二十幾格。搭配下面 <form> 的 key，失敗後表單會帶著使用者原本填的內容
   * 重新掛載，只需要改錯的那一格。
   */
  const d = defaultsFrom(state, place);

  return (
    <form
      key={state.attempt ?? 0}
      action={formAction}
      className="flex flex-col gap-8"
    >
      {isEdit && <input type="hidden" name="id" value={place.id} />}

      <Section title="基本">
        <Field label="名稱">
          <input name="name" defaultValue={d.name} required className={inputClass} />
        </Field>

        <Field label="分類">
          <select name="category" defaultValue={d.category} className={inputClass}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{LABELS.category[c]}</option>
            ))}
          </select>
        </Field>

        <Field label="地址">
          <input name="address" defaultValue={d.address} className={inputClass} />
        </Field>

        <Field
          label="座標"
          hint="從 Google 地圖長按目標點就能複製。這是即時路況查詢的目的地，也是唯一沒辦法從別的欄位推算出來的資料。"
        >
          <div className="grid grid-cols-2 gap-2">
            <input name="lat" defaultValue={d.lat} placeholder="緯度 25.03" inputMode="decimal" required className={`${inputClass} font-mono`} />
            <input name="lng" defaultValue={d.lng} placeholder="經度 121.54" inputMode="decimal" required className={`${inputClass} font-mono`} />
          </div>
        </Field>
      </Section>

      <Section
        title="車程與停車"
        hint="車程填平常日開過去的實際時間就好，不用很準——有網路時會用即時路況覆蓋它（ADR-0005）。它是離線時的後備值。"
      >
        <Field label="車程（分鐘）">
          <input name="driveMinutes" type="number" min={0} max={600} defaultValue={d.driveMinutes} required className={inputClass} />
        </Field>

        <Field label="停車">
          <select name="parking" defaultValue={d.parking} className={inputClass}>
            {PARKING_RATINGS.map((p) => (
              <option key={p} value={p}>{LABELS.parking[p]}</option>
            ))}
          </select>
        </Field>
      </Section>

      <Section
        title="核心判斷"
        hint="這一區是這個產品和 Google 地圖的差別。其他地方查得到的東西不用填，這裡填的是查不到的。"
      >
        <Field label="放電強度" hint="回家會不會累到秒睡。">
          <Scale name="energyBurn" values={[1, 2, 3, 4, 5]} defaultValue={d.energyBurn} labels={["幾乎不動", "電力全放"]} />
        </Field>

        <Field label="可撐時間（分鐘）" hint="小孩實際待得住多久，不是官方建議的遊玩時間。">
          <input name="typicalDurationMin" type="number" min={1} max={1440} defaultValue={d.typicalDurationMin} required className={inputClass} />
        </Field>

        <Field label="適合時段" hint="可以複選。沒選的話評分會給中性分數，不會被扣分。">
          <div className="grid grid-cols-2 gap-2">
            {TIME_SLOTS.map((slot) => (
              <Toggle
                key={slot}
                name="bestTimeSlots"
                value={slot}
                label={LABELS.timeSlot[slot]}
                defaultChecked={d.bestTimeSlots.includes(slot)}
              />
            ))}
          </div>
        </Field>

        <Field label="適合年齡（月）" hint="超出這個範圍的地點會被直接剔除，不進入評分。">
          <div className="grid grid-cols-2 gap-2">
            <input name="ageMinMonths" type="number" min={0} max={144} defaultValue={d.ageMinMonths} required className={inputClass} />
            <input name="ageMaxMonths" type="number" min={0} max={144} defaultValue={d.ageMaxMonths} required className={inputClass} />
          </div>
        </Field>

        <Field
          label="最適年齡（月，可留空）"
          hint="關於「你的小孩」的判斷，不是關於地點的事實。還沒把握就留空，評分會給中性分數而不是扣分。"
        >
          <div className="grid grid-cols-2 gap-2">
            <input name="sweetSpotMinMonths" type="number" min={0} max={144} defaultValue={d.sweetSpotMinMonths} className={inputClass} />
            <input name="sweetSpotMaxMonths" type="number" min={0} max={144} defaultValue={d.sweetSpotMaxMonths} className={inputClass} />
          </div>
        </Field>
      </Section>

      <Section title="環境條件">
        <Field label="室內外">
          <select name="indoor" defaultValue={d.indoor} className={inputClass}>
            {INDOOR_TYPES.map((i) => (
              <option key={i} value={i}>{LABELS.indoor[i]}</option>
            ))}
          </select>
        </Field>

        <Field label="遮蔽程度" hint="影響高溫時會不會被剔除。0 是全無遮蔽。">
          <Scale name="shadeLevel" values={[0, 1, 2, 3]} defaultValue={d.shadeLevel} labels={["曬到不行", "幾乎全遮"]} />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Toggle name="strollerFriendly" label="推車可進" defaultChecked={d.strollerFriendly} />
          <Toggle name="hasChangingTable" label="有尿布台" defaultChecked={d.hasChangingTable} />
          <Toggle name="hasNursingSpace" label="有哺乳室" defaultChecked={d.hasNursingSpace} />
          <Toggle name="hasFoodOnSite" label="現場有得吃" defaultChecked={d.hasFoodOnSite} />
          <Toggle name="hasWaterPlay" label="有玩水" defaultChecked={d.hasWaterPlay} />
          <Toggle name="needsReservation" label="需要預約" defaultChecked={d.needsReservation} />
        </div>
      </Section>

      <Section title="實務情報">
        <Field label="平日人潮">
          <Scale name="crowdWeekday" values={[1, 2, 3, 4, 5]} defaultValue={d.crowdWeekday} labels={["沒什麼人", "擠爆"]} />
        </Field>

        <Field label="假日人潮">
          <Scale name="crowdWeekend" values={[1, 2, 3, 4, 5]} defaultValue={d.crowdWeekend} labels={["沒什麼人", "擠爆"]} />
        </Field>

        <Field label="人少的時段（可留空）">
          <input name="quietHours" defaultValue={d.quietHours} placeholder="平日 14:00-16:00" className={inputClass} />
        </Field>

        <Field label="一家人花費（元，可留空）">
          <input name="costPerFamily" type="number" min={0} defaultValue={d.costPerFamily} className={inputClass} />
        </Field>

        <Field label="個人評分（可留空）" hint="還沒去過就留空。">
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((v) => (
              <label key={v} className="flex-1">
                <input type="radio" name="personalRating" value={v} defaultChecked={d.personalRating === v} className="peer sr-only" />
                <span className="block cursor-pointer rounded-lg border border-black/15 dark:border-white/20 py-2 text-center text-base peer-checked:bg-foreground peer-checked:text-background peer-checked:border-transparent">
                  {v}
                </span>
              </label>
            ))}
          </div>
        </Field>

        <Field label="標籤" hint="用逗號或空白分隔。">
          <input name="tags" defaultValue={d.tags} placeholder="近捷運, 有沙坑" className={inputClass} />
        </Field>

        <Field label="備註">
          <textarea name="notes" defaultValue={d.notes} rows={3} className={`${inputClass} resize-y`} />
        </Field>
      </Section>

      <div className="sticky bottom-0 -mx-5 flex items-center gap-3 border-t border-black/10 dark:border-white/15 bg-background px-5 py-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-foreground px-5 py-2.5 text-background text-base font-medium disabled:opacity-50"
        >
          {pending ? "儲存中…" : isEdit ? "儲存" : "新增地點"}
        </button>
        {state.status === "saved" && (
          <span className="text-sm text-green-700 dark:text-green-400">已儲存</span>
        )}
        {state.status === "error" && (
          <span className="text-sm text-red-700 dark:text-red-400">{state.message}</span>
        )}
      </div>
    </form>
  );
}

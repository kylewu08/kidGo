"use client";

import { useActionState, useState } from "react";

import type { Rating } from "@/lib/db/schema";
import {
  saveFamilyPreferenceAction,
  type SaveFamilyPreferenceState,
} from "./actions";

/**
 * 家庭偏好初始三題（設計架構書 §6.2）——**目前只問其中兩題**
 *
 * 三題各自對應一個欄位，沒有第四題。§6.2 表格裡「類別權重」的來源寫的是
 * 「回饋累積學習」而不是初始三題——問使用者喜歡哪一類會得到審美偏好，
 * 而真正該學的是行為偏好（ADR-0018 的同一個論證）。
 *
 * ⚠️ **「是否需含用餐」暫時不問**（2026-08-31）。
 *
 * 它在設計架構書裡只出現一次——§6.2 表格第 187 行，意義欄是一個破折號。
 * §7 的過濾表沒有它，§6.2 的地點語彙表也沒有任何「附近有得吃」的欄位，
 * 所以推薦引擎讀不到它、就算讀得到也沒有資料可判斷。grep 全 lib/ 確認：
 * requiresMeal 只出現在 schema 與驗證，沒有任何規則消費它。
 *
 * 這與 ADR-0016 記的兩個缺口是同一個形狀。留在畫面上會讓人以為有用，
 * 所以先撤下——**欄位與驗證都保留**，等餐飲資料進來就放回去。
 * 補法已經寫好了：需求補充 01 §A 的 Google Places 匯入，
 * 那張表裡 `menuForChildren` 的用途欄寫的正是「對應是否需含用餐偏好」。
 *
 * **家長負擔上限是三題裡唯一的硬過濾條件**（§7.1），填錯會直接砍掉一批
 * 候選，而且推薦照樣出得來、沒有任何跡象。所以它問的是「撐得住到哪」這個
 * 上限，不是「喜歡哪種」的偏好，五個選項也各自綁一個具體場景——
 * 「1 到 5 分」對使用者沒有意義，綁不上真實地點就選不準。
 *
 * ⚠️ React 19 會在 Server Action 完成後自動重置表單 DOM，受控欄位的
 * state 不會跟著變。解法同出發點表單：page.tsx 用 `key` 讓儲存成功後整個
 * 表單重掛載，見那裡的註解。
 */

/** −2…+2。五段而非連續值，UI 才講得清楚（ADR-0014）。 */
const OUTDOOR_TENDENCY_OPTIONS: { value: number; label: string }[] = [
  { value: -2, label: "幾乎都室內" },
  { value: -1, label: "偏室內" },
  { value: 0, label: "都可以" },
  { value: 1, label: "偏戶外" },
  { value: 2, label: "幾乎都戶外" },
];

const PARENT_EFFORT_OPTIONS: { value: Rating; label: string; hint: string }[] = [
  { value: 1, label: "坐得住就好", hint: "大人可以坐著，小孩自己玩" },
  { value: 2, label: "走走停停", hint: "要看著，但不用一直跟在旁邊" },
  { value: 3, label: "全程跟著跑", hint: "爬上爬下都得在下面接" },
  { value: 4, label: "要準備也要收拾", hint: "裝備、換洗、事前查路線" },
  { value: 5, label: "一整天的體力活", hint: "回到家大人先躺平" },
];

export interface PreferencesFormProps {
  initial: {
    outdoorTendency: number;
    maxParentEffort: Rating;
  };
  /** 從未設定過時為 true，用來調整按鈕文字 */
  isNew: boolean;
}

const initialState: SaveFamilyPreferenceState = { status: "idle" };

export function PreferencesForm({ initial, isNew }: PreferencesFormProps) {
  const [state, formAction, pending] = useActionState(
    saveFamilyPreferenceAction,
    initialState,
  );

  const [outdoorTendency, setOutdoorTendency] = useState(initial.outdoorTendency);
  const [maxParentEffort, setMaxParentEffort] = useState<Rating>(
    initial.maxParentEffort,
  );

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <fieldset className="flex flex-col gap-2.5">
        <legend className="text-sm font-medium">你們家平常比較常往哪裡去？</legend>
        <div className="grid grid-cols-5 gap-1.5">
          {OUTDOOR_TENDENCY_OPTIONS.map((o) => (
            <label
              key={o.value}
              className={`cursor-pointer rounded-lg border px-1 py-2.5 text-center text-xs leading-snug ${
                outdoorTendency === o.value
                  ? "border-foreground bg-foreground/10 font-medium"
                  : "border-black/15 dark:border-white/20 opacity-70"
              }`}
            >
              <input
                type="radio"
                name="outdoorTendency"
                value={o.value}
                checked={outdoorTendency === o.value}
                onChange={() => setOutdoorTendency(o.value)}
                className="sr-only"
              />
              {o.label}
            </label>
          ))}
        </div>
        <p className="text-xs opacity-60">
          影響排序，不會排除任何地點——下雨或高溫時仍然會推室內選項。
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-2.5">
        <legend className="text-sm font-medium">
          一趟出門，你們家大概能撐到哪裡？
        </legend>
        <div className="flex flex-col gap-1.5">
          {PARENT_EFFORT_OPTIONS.map((o) => (
            <label
              key={o.value}
              className={`flex cursor-pointer items-baseline gap-3 rounded-lg border px-3.5 py-3 ${
                maxParentEffort === o.value
                  ? "border-foreground bg-foreground/10"
                  : "border-black/15 dark:border-white/20"
              }`}
            >
              <input
                type="radio"
                name="maxParentEffort"
                value={o.value}
                checked={maxParentEffort === o.value}
                onChange={() => setMaxParentEffort(o.value)}
                className="sr-only"
              />
              <span
                className={`text-sm ${maxParentEffort === o.value ? "font-medium" : ""}`}
              >
                {o.label}
              </span>
              <span className="text-xs opacity-60">{o.hint}</span>
            </label>
          ))}
        </div>
        <p className="text-xs opacity-60">
          這是<span className="font-medium opacity-100">上限不是偏好</span>
          ：超過的地點會被直接剔除，不進入評分。選寬一點不會讓你被迫去爬山，
          選窄了卻會讓你看不到本來合適的地點。
        </p>
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-foreground px-5 py-2.5 text-background text-base font-medium disabled:opacity-50"
        >
          {pending ? "儲存中…" : isNew ? "完成設定" : "儲存"}
        </button>
        {state.status === "saved" && (
          <span className="text-sm text-green-700 dark:text-green-400">已儲存</span>
        )}
        {state.status === "error" && (
          <span className="text-sm text-red-700 dark:text-red-400">
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}

"use client";

import { useActionState, useMemo, useState } from "react";

import {
  COUNTY_DATASET_IDS,
  TOWNSHIPS,
  type CountyName,
} from "@/lib/weather/townships";
import { saveHomeBaseAction, type SaveHomeBaseState } from "./actions";

/**
 * 出發點設定（設計架構書 §10.3、ADR-0006）
 *
 * 兩段式下拉：368 個鄉鎮攤平成一個選單無法使用，而且鄉鎮名稱不唯一
 * （東區橫跨新竹市／嘉義市／臺中市／臺南市），必須連同縣市一起選。
 *
 * 用原生 <select> 而不是自製下拉：手機上會叫出系統的選單元件，
 * 那比任何自己刻的都好用，而且 368 個選項也不需要搜尋功能——
 * 使用者知道自己住哪裡。
 *
 * TOWNSHIPS 這份資料（約 22KB）會被打包進客戶端。這是設定頁面，
 * 不在「今天去哪」的關鍵路徑上，換取選鄉鎮時零延遲是划算的。
 *
 * ⚠️ **React 19 會在 Server Action 完成後自動重置表單 DOM。**
 * 受控欄位的 React state 不會跟著變，所以如果沒有重新 render，
 * DOM 就會停在被重置的值上而 state 還是舊的——兩邊脫鉤。
 * 解法是 page.tsx 用 `key` 讓儲存成功後整個表單重掛載，見那裡的註解。
 * 這不是理論上的顧慮，是實際跑起來之後看到的：儲存完縣市跳回「宜蘭縣」，
 * 鄉鎮卻停在「三峽區」，而那是新北市的區。
 */

const COUNTIES = Object.keys(COUNTY_DATASET_IDS) as CountyName[];

export interface HomeBaseFormProps {
  initial: {
    county: CountyName;
    township: string;
    lat: number;
    lng: number;
    maxDriveMinutes: number;
  };
  /** 沒有既有設定時為 true，用來調整說明文字 */
  isNew: boolean;
}

const initialState: SaveHomeBaseState = { status: "idle" };

export function HomeBaseForm({ initial, isNew }: HomeBaseFormProps) {
  const [state, formAction, pending] = useActionState(
    saveHomeBaseAction,
    initialState,
  );

  /**
   * 縣市與鄉鎮放在同一個 state。
   *
   * 它們本來就不是獨立的兩個值——「宜蘭縣 + 三峽區」是一個不存在的組合。
   * 拆成兩個 useState 就有辦法讓它們各自更新到互相矛盾，
   * 而那正是這個表單第一版真的發生過的 bug。合成一個之後，
   * 不合法的組合連表示都表示不出來。
   */
  const [place, setPlace] = useState({
    county: initial.county,
    township: initial.township,
  });
  const [lat, setLat] = useState(String(initial.lat));
  const [lng, setLng] = useState(String(initial.lng));
  const [maxDrive, setMaxDrive] = useState(String(initial.maxDriveMinutes));

  const townships = useMemo(
    () => TOWNSHIPS.filter((t) => t.county === place.county),
    [place.county],
  );

  /** 選了鄉鎮就把座標帶出來。使用者仍可手動覆寫，見下方說明。 */
  function applyTownship(name: string) {
    const found = townships.find((t) => t.name === name);
    if (!found) return;
    setPlace({ county: found.county, township: found.name });
    setLat(String(found.lat));
    setLng(String(found.lng));
  }

  function changeCounty(next: CountyName) {
    // 換縣市時原本的鄉鎮一定不屬於新縣市，直接跳到第一個而不是留著空值——
    // 留空值會讓使用者以為「還沒選」，但表單其實處於不合法狀態。
    const first = TOWNSHIPS.find((t) => t.county === next);
    if (!first) return;
    setPlace({ county: first.county, township: first.name });
    setLat(String(first.lat));
    setLng(String(first.lng));
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">縣市</span>
          <select
            name="cwaCountyName"
            value={place.county}
            onChange={(e) => changeCounty(e.target.value as CountyName)}
            className="rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2.5 text-base"
          >
            {COUNTIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">鄉鎮市區</span>
          <select
            name="cwaLocationName"
            value={place.township}
            onChange={(e) => applyTownship(e.target.value)}
            className="rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2.5 text-base"
          >
            {townships.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="-mt-3 text-xs opacity-60">
        決定要抓哪一份中央氣象署鄉鎮預報。
      </p>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">座標</legend>
        <div className="grid grid-cols-2 gap-3">
          <input
            name="lat"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            inputMode="decimal"
            aria-label="緯度"
            className="rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2.5 font-mono text-base"
          />
          <input
            name="lng"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            inputMode="decimal"
            aria-label="經度"
            className="rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2.5 font-mono text-base"
          />
        </div>
        <p className="text-xs opacity-60">
          選完鄉鎮會自動帶入該區的預報代表點。這個座標同時是{" "}
          <span className="font-medium opacity-100">車程的起點</span>
          ，想更準的話可以從 Google 地圖複製你家的實際座標貼上來——
          差幾公里在車程上是差得出來的。
        </p>
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">車程上限</span>
        <div className="flex items-center gap-2">
          <input
            name="maxDriveMinutes"
            type="number"
            min={1}
            step={1}
            value={maxDrive}
            onChange={(e) => setMaxDrive(e.target.value)}
            className="w-28 rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2.5 text-base"
          />
          <span className="text-sm opacity-70">分鐘</span>
        </div>
        <p className="text-xs opacity-60">
          超過這個車程的地點會被直接剔除，不進入評分。
        </p>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-foreground px-5 py-2.5 text-background text-base font-medium disabled:opacity-50"
        >
          {pending ? "儲存中…" : isNew ? "建立出發點" : "儲存"}
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

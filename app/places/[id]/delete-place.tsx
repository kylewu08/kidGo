"use client";

import { useActionState, useState } from "react";

import { deletePlaceAction, type PlaceFormState } from "../actions";

const initialState: PlaceFormState = { status: "idle" };

/**
 * 刪除地點。
 *
 * 兩段式確認不是為了防手滑，是因為刪除在這個產品裡幾乎總是錯的做法——
 * 有紀錄的地點根本刪不掉（§12.3），而沒紀錄的地點刪掉也只是省下一列資料。
 * 想讓某個地點不再被推薦，改條件比刪掉它好。
 */
export function DeletePlace({ id, name }: { id: string; name: string }) {
  const [state, formAction, pending] = useActionState(
    deletePlaceAction,
    initialState,
  );
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start text-sm text-red-700 dark:text-red-400 underline underline-offset-4"
        >
          刪除這個地點
        </button>
        {state.status === "error" && (
          <p className="text-sm text-red-700 dark:text-red-400 leading-relaxed">
            {state.message}
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-xl border border-red-700/30 dark:border-red-400/30 p-4">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm leading-relaxed">
        確定要刪除「{name}」嗎？有出遊紀錄的地點會被拒絕刪除。
      </p>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-red-700 dark:bg-red-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "刪除中…" : "確定刪除"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-sm opacity-70"
        >
          取消
        </button>
      </div>
      {state.status === "error" && (
        <p className="text-sm text-red-700 dark:text-red-400 leading-relaxed">
          {state.message}
        </p>
      )}
    </form>
  );
}

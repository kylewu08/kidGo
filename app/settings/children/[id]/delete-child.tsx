"use client";

import { useActionState, useState } from "react";

import { deleteChildAction, type ChildFormState } from "../actions";

const initialState: ChildFormState = { status: "idle" };

export function DeleteChild({ id, name }: { id: string; name: string }) {
  const [state, formAction, pending] = useActionState(deleteChildAction, initialState);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="self-start text-sm text-red-700 dark:text-red-400 underline underline-offset-4"
      >
        刪除
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-xl border border-red-700/30 dark:border-red-400/30 p-4">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm leading-relaxed">
        確定要刪除「{name}」嗎？過去的出遊紀錄不受影響——
        紀錄裡存的是當時的月齡快照，不是回頭去查生日算的（§5.3）。
      </p>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-red-700 dark:bg-red-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "刪除中…" : "確定刪除"}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="text-sm opacity-70">
          取消
        </button>
      </div>
      {state.status === "error" && (
        <p className="text-sm text-red-700 dark:text-red-400">{state.message}</p>
      )}
    </form>
  );
}

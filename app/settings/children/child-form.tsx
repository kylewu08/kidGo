"use client";

import { useActionState, useState } from "react";

import { CHILD_LABELS, MOBILITIES, NAP_STAGES } from "@/lib/db/child-input";
import type { Child, NapStage } from "@/lib/db/schema";
import { defaultNapWindows } from "@/lib/schedule/napStage";
import {
  createChildAction,
  updateChildAction,
  type ChildFormState,
} from "./actions";

/**
 * 小孩設定（設計架構書 §5.1、§10.3）
 *
 * 選作息階段時自動帶出附錄對照表的預設午睡窗。那張表明講是「預設起點，
 * 實際以手動設定為準」——所以是帶出來讓人改，不是鎖死。
 */

const initialState: ChildFormState = { status: "idle" };

const inputClass =
  "rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2.5 text-base w-full";

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

interface Defaults {
  name: string;
  birthDate: string;
  napStage: NapStage;
  wakeTime: string;
  bedTime: string;
  mobility: string;
  naps: { start: string; end: string }[];
  notes: string;
}

/** 午睡窗最多兩段（two_naps 階段的上限），固定兩組欄位比動態增減簡單也夠用 */
const NAP_SLOTS = 2;

function padNaps(windows: { start: string; end: string }[]) {
  const out = [...windows];
  while (out.length < NAP_SLOTS) out.push({ start: "", end: "" });
  return out.slice(0, NAP_SLOTS);
}

function defaultsFrom(state: ChildFormState, child?: Child): Defaults {
  const r = state.values;
  if (r) {
    return {
      name: r.name,
      birthDate: r.birthDate,
      napStage: r.napStage as NapStage,
      wakeTime: r.wakeTime,
      bedTime: r.bedTime,
      mobility: r.mobility,
      naps: padNaps(
        r.napStarts.map((start, i) => ({ start, end: r.napEnds[i] ?? "" })),
      ),
      notes: r.notes,
    };
  }
  return {
    name: child?.name ?? "",
    birthDate: child?.birthDate ?? "",
    napStage: child?.napStage ?? "one_nap",
    wakeTime: child?.wakeTime ?? "07:00",
    bedTime: child?.bedTime ?? "20:30",
    mobility: child?.mobility ?? "stroller",
    naps: padNaps(child?.napWindows ?? defaultNapWindows("one_nap")),
    notes: child?.notes ?? "",
  };
}

export function ChildForm({ child }: { child?: Child }) {
  const isEdit = child !== undefined;
  const [state, formAction, pending] = useActionState(
    isEdit ? updateChildAction : createChildAction,
    initialState,
  );

  const d = defaultsFrom(state, child);
  const [napStage, setNapStage] = useState<NapStage>(d.napStage);
  const [naps, setNaps] = useState(d.naps);

  /** 換作息階段時帶出附錄的預設午睡窗，使用者可以再改 */
  function changeNapStage(next: NapStage) {
    setNapStage(next);
    setNaps(padNaps(defaultNapWindows(next)));
  }

  function setNap(index: number, key: "start" | "end", value: string) {
    setNaps((prev) =>
      prev.map((n, i) => (i === index ? { ...n, [key]: value } : n)),
    );
  }

  return (
    <form key={state.attempt ?? 0} action={formAction} className="flex flex-col gap-6">
      {isEdit && <input type="hidden" name="id" value={child.id} />}

      <Field label="名字">
        <input name="name" defaultValue={d.name} required className={inputClass} />
      </Field>

      <Field label="生日" hint="月齡是推薦的核心輸入，會隨時間自動推進。">
        <input name="birthDate" type="date" defaultValue={d.birthDate} required className={inputClass} />
      </Field>

      <Field
        label="作息階段"
        hint="換階段會自動帶出常見的午睡時間，下面可以再改成實際的。"
      >
        <select
          name="napStage"
          value={napStage}
          onChange={(e) => changeNapStage(e.target.value as NapStage)}
          className={inputClass}
        >
          {NAP_STAGES.map((s) => (
            <option key={s} value={s}>{CHILD_LABELS.napStage[s]}</option>
          ))}
        </select>
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">午睡時間</legend>
        {naps.map((nap, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              name="napStart"
              type="time"
              value={nap.start}
              onChange={(e) => setNap(i, "start", e.target.value)}
              className={inputClass}
            />
            <span className="opacity-50">–</span>
            <input
              name="napEnd"
              type="time"
              value={nap.end}
              onChange={(e) => setNap(i, "end", e.target.value)}
              className={inputClass}
            />
          </div>
        ))}
        <p className="text-xs opacity-55 leading-relaxed">
          行程若和這段時間重疊，作息分數會被扣一半（ADR-0004）。不睡午覺的話兩段都留空。
        </p>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <Field label="起床">
          <input name="wakeTime" type="time" defaultValue={d.wakeTime} required className={inputClass} />
        </Field>
        <Field label="就寢">
          <input name="bedTime" type="time" defaultValue={d.bedTime} required className={inputClass} />
        </Field>
      </div>

      <Field
        label="行動能力"
        hint="選「主要靠推車」的話，推車進不去的地點會被直接剔除。"
      >
        <select name="mobility" defaultValue={d.mobility} className={inputClass}>
          {MOBILITIES.map((m) => (
            <option key={m} value={m}>{CHILD_LABELS.mobility[m]}</option>
          ))}
        </select>
      </Field>

      <Field label="備註">
        <textarea name="notes" defaultValue={d.notes} rows={2} className={`${inputClass} resize-y`} />
      </Field>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-foreground px-5 py-2.5 text-background text-base font-medium disabled:opacity-50"
        >
          {pending ? "儲存中…" : isEdit ? "儲存" : "新增"}
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

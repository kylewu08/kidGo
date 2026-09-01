"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { validateChildInput, type RawChildInput } from "@/lib/db/child-input";
import { createChild, deleteChild, updateChild } from "@/lib/db/queries";

export interface ChildFormState {
  status: "idle" | "saved" | "error";
  message?: string;
  /** 驗證失敗時帶回使用者填的內容，見 app/places/actions.ts 的同名欄位 */
  values?: RawChildInput;
  attempt?: number;
}

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "");

function readChildForm(fd: FormData): RawChildInput {
  return {
    name: text(fd, "name"),
    birthDate: text(fd, "birthDate"),
    napStage: text(fd, "napStage"),
    wakeTime: text(fd, "wakeTime"),
    bedTime: text(fd, "bedTime"),
    mobility: text(fd, "mobility"),
    attentionSpanMinutes: text(fd, "attentionSpanMinutes"),
    napStarts: fd.getAll("napStart").map(String),
    napEnds: fd.getAll("napEnd").map(String),
    notes: text(fd, "notes"),
  };
}

function invalid(prev: ChildFormState, values: RawChildInput, message: string): ChildFormState {
  return { status: "error", message, values, attempt: (prev.attempt ?? 0) + 1 };
}

export async function createChildAction(
  prev: ChildFormState,
  formData: FormData,
): Promise<ChildFormState> {
  const values = readChildForm(formData);
  const result = validateChildInput(values);
  if (!result.ok) return invalid(prev, values, result.message);

  await createChild(result.value);
  revalidatePath("/settings/children");
  revalidatePath("/");
  redirect("/settings/children");
}

export async function updateChildAction(
  prev: ChildFormState,
  formData: FormData,
): Promise<ChildFormState> {
  const id = String(formData.get("id") ?? "");
  if (id === "") return { status: "error", message: "缺少小孩 id" };

  const values = readChildForm(formData);
  const result = validateChildInput(values);
  if (!result.ok) return invalid(prev, values, result.message);

  await updateChild(id, result.value);
  revalidatePath("/settings/children");
  revalidatePath("/");
  return { status: "saved" };
}

export async function deleteChildAction(
  _prev: ChildFormState,
  formData: FormData,
): Promise<ChildFormState> {
  const id = String(formData.get("id") ?? "");
  if (id === "") return { status: "error", message: "缺少小孩 id" };

  await deleteChild(id);
  revalidatePath("/settings/children");
  revalidatePath("/");
  redirect("/settings/children");
}

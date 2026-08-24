import Link from "next/link";
import { notFound } from "next/navigation";

import { getChild } from "@/lib/db/queries";
import { ageInMonths } from "@/lib/schedule/napStage";
import { ChildForm } from "../child-form";
import { DeleteChild } from "./delete-child";

export const dynamic = "force-dynamic";

export default async function ChildDetailPage({
  params,
}: PageProps<"/settings/children/[id]">) {
  const { id } = await params;
  const child = await getChild(id);
  if (!child) notFound();

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8 flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href="/settings/children" className="text-sm opacity-60 hover:opacity-100">
          ← 小孩列表
        </Link>
        <h1 className="text-2xl font-semibold">{child.name}</h1>
        <p className="text-sm opacity-60">
          現在 {ageInMonths(child.birthDate, new Date())} 個月
        </p>
      </header>

      <ChildForm child={child} />

      <div className="border-t border-black/10 dark:border-white/15 pt-6">
        <DeleteChild id={child.id} name={child.name} />
      </div>
    </main>
  );
}

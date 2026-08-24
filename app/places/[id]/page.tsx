import Link from "next/link";
import { notFound } from "next/navigation";

import { countVisitsForPlace, getPlace } from "@/lib/db/queries";
import { PlaceForm } from "../place-form";
import { DeletePlace } from "./delete-place";

export const dynamic = "force-dynamic";

export default async function PlaceDetailPage({
  params,
}: PageProps<"/places/[id]">) {
  const { id } = await params;
  const place = await getPlace(id);
  if (!place) notFound();

  const visitCount = await countVisitsForPlace(id);

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8 flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href="/places" className="text-sm opacity-60 hover:opacity-100">
          ← 地點列表
        </Link>
        <h1 className="text-2xl font-semibold">{place.name}</h1>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm opacity-65">
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4"
          >
            開啟導航
          </a>
          <span>·</span>
          <span>{visitCount} 筆出遊紀錄</span>
        </div>
      </header>

      {/*
        設計架構書 §10.2 的「歷史紀錄摘要」是這個畫面最重要的部分——
        它讓填錯的靜態欄位肉眼可見。但 Visit 的建立功能屬於 Phase 2，
        現在沒有資料可以摘要，所以先不做空殼。
      */}
      <div className="rounded-xl border border-dashed border-black/20 dark:border-white/25 p-4 text-sm leading-relaxed opacity-65">
        歷史紀錄摘要（§10.2）要等出遊紀錄功能做完才有東西可看。
        那個畫面的價值在於讓「可撐時間填太長」這類錯誤浮現出來。
      </div>

      <PlaceForm place={place} />

      <div className="border-t border-black/10 dark:border-white/15 pt-6">
        <DeletePlace id={place.id} name={place.name} />
      </div>
    </main>
  );
}

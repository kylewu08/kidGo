import Link from "next/link";

import { PlaceForm } from "../place-form";

export const metadata = { title: "新增地點 · KidGo" };

export default function NewPlacePage() {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-8 flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href="/places" className="text-sm opacity-60 hover:opacity-100">
          ← 地點列表
        </Link>
        <h1 className="text-2xl font-semibold">新增地點</h1>
        <p className="text-sm opacity-70 leading-relaxed">
          只記錄 Google 地圖和懶人包查不到的東西。營業時間、電話那些不用填——
          需要的時候用導航開出去就看得到了。
        </p>
      </header>

      <PlaceForm />
    </main>
  );
}

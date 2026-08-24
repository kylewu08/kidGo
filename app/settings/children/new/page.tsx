import Link from "next/link";

import { ChildForm } from "../child-form";

export const metadata = { title: "新增小孩 · KidGo" };

export default function NewChildPage() {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-8 flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href="/settings/children" className="text-sm opacity-60 hover:opacity-100">
          ← 小孩列表
        </Link>
        <h1 className="text-2xl font-semibold">新增小孩</h1>
      </header>
      <ChildForm />
    </main>
  );
}

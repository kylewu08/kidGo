import type { SuggestionResponse } from "@/lib/db/schema";
import { respondToSuggestionAction } from "./actions";

/**
 * 回饋按鈕（§9.3 最輕層）
 *
 * 沒有「沒去」這個選項是刻意的。ADR-0011：原本的「沒去」混合了三種
 *完全不同的事——今天根本沒出門（生活的問題，不該影響推薦）、去了別的
 * 地方（比較性訊號，該小幅降權）、看了覺得不適合（資料品質問題，
 * 不該影響偏好）。混在一起餵給最重要的長期訊號，等於把雜訊當成學習依據。
 *
 * 「看了覺得不適合」暫未提供：它要標記的是**某一個地點**的 dataSuspect，
 * 而這一頁有三個槽位，得先決定標哪一個。留給之後處理。
 */

const OPTIONS: { value: SuggestionResponse; label: string; hint: string }[] = [
  { value: "went", label: "去了", hint: "採納率 ↑" },
  { value: "stayed_home", label: "今天沒出門", hint: "不影響推薦" },
  { value: "went_elsewhere", label: "去了別的地方", hint: "小幅降權" },
];

const ANSWERED: Record<string, string> = {
  went: "已記錄：去了",
  stayed_home: "已記錄：今天沒出門——這不影響之後的推薦",
  went_elsewhere: "已記錄：去了別的地方",
  looked_unsuitable: "已記錄：看了覺得不適合",
};

export function ResponseButtons({
  suggestionId,
  response,
}: {
  suggestionId: string;
  response: SuggestionResponse | null;
}) {
  if (response) {
    return (
      <p className="rounded-xl bg-surface px-4 py-3 text-sm text-muted">
        {ANSWERED[response] ?? "已記錄"}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium tracking-[0.08em] text-muted">後來呢？</p>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => (
          <form key={o.value} action={respondToSuggestionAction}>
            <input type="hidden" name="suggestionId" value={suggestionId} />
            <input type="hidden" name="response" value={o.value} />
            <button
              type="submit"
              className="rounded-full border border-surface-line px-4 py-2 text-sm hover:border-accent hover:text-accent"
              title={o.hint}
            >
              {o.label}
            </button>
          </form>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-muted">
        這是系統唯一的長期學習訊號（§9.3）。跳過也沒關係，它不依賴你的勤勞。
      </p>
    </div>
  );
}

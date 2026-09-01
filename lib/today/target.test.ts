/**
 * 跨日規則的規格。
 *
 * 這段邏輯全是時間邊界，而邊界錯了不會有任何錯誤訊息——
 * 只會在某個時刻默默算錯一天，然後使用者照著一個過期的答案出門。
 */

import { describe, expect, it } from "vitest";

import { resolveTarget, TOMORROW_WINDOW_START } from "./target";

const at = (h: number, m = 0) => new Date(2026, 8, 1, h, m, 0, 0);
const UNTIL = "18:00";

describe("還在可用時間窗內：算今天", () => {
  it("早上打開，從現在起算", () => {
    const t = resolveTarget(at(9, 15), UNTIL);
    expect(t.kind).toBe("today");
    expect(t.window).toEqual({ start: "09:15", end: "18:00" });
    expect(t.timestamp).toEqual(at(9, 15));
  });

  it("窗口結束前一分鐘仍算今天", () => {
    expect(resolveTarget(at(17, 59), UNTIL).kind).toBe("today");
  });
});

describe("窗口過了：算明天", () => {
  it("晚上打開改算明天，出發時間用明天的窗口起點", () => {
    const t = resolveTarget(at(22, 25), UNTIL);
    expect(t.kind).toBe("tomorrow");
    expect(t.window).toEqual({ start: TOMORROW_WINDOW_START, end: "18:00" });
    expect(t.timestamp).toEqual(new Date(2026, 8, 2, 8, 30));
  });

  /** 邊界：剛好等於窗口結束的那一刻，今天已經結束了 */
  it("正好 18:00 算明天，不是今天", () => {
    expect(resolveTarget(at(18, 0), UNTIL).kind).toBe("tomorrow");
  });

  it("跨月也對", () => {
    const t = resolveTarget(new Date(2026, 8, 30, 23, 0), UNTIL);
    expect(t.timestamp).toEqual(new Date(2026, 9, 1, 8, 30));
  });
});

describe("跨過午夜自己回到今天", () => {
  /**
   * 這是整個設計最省事的地方：不需要記住「剛才顯示的是明天」。
   * 23:00 算的「明天」與 00:30 算的「今天」是同一個日曆日，
   * 只是名字換了——答案的內容是連續的。
   */
  it("23:00 看到的明天，與 00:30 看到的今天是同一天", () => {
    const night = resolveTarget(new Date(2026, 8, 1, 23, 0), UNTIL);
    const afterMidnight = resolveTarget(new Date(2026, 8, 2, 0, 30), UNTIL);

    expect(night.kind).toBe("tomorrow");
    expect(afterMidnight.kind).toBe("today");
    expect(night.timestamp.getDate()).toBe(afterMidnight.timestamp.getDate());
  });

  it("午夜之後從現在起算，不是從 08:30", () => {
    const t = resolveTarget(new Date(2026, 8, 2, 0, 30), UNTIL);
    expect(t.window.start).toBe("00:30");
  });
});

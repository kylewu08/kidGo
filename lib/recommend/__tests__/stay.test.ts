/**
 * 停留時長的規格（ADR-0025）。
 *
 * 這個數字同時決定「時間夠不夠來回」（硬過濾）與「幾點到家」（午睡判斷）。
 * 高估它會讓遠一點但其實可行的地方被剔除，而那正是使用者實際會去的那種。
 */

import { describe, expect, it } from "vitest";

import { effectiveStayMinutes } from "../stay";

const place = (typicalDurationMinutes: number) => ({ typicalDurationMinutes });
const child = (attentionSpanMinutes: number | null) => ({ attentionSpanMinutes });

describe("停留時長", () => {
  it("沒填專注度就沿用地點的先驗——選填欄位不該改變行為", () => {
    expect(effectiveStayMinutes(place(90), [child(null)])).toBe(90);
    expect(effectiveStayMinutes(place(90), [])).toBe(90);
  });

  /** 20 個月的小孩去哪都是一小時，那是小孩的上限不是地點的性質 */
  it("專注度比地點先驗短時，用專注度", () => {
    expect(effectiveStayMinutes(place(90), [child(60)])).toBe(60);
  });

  /** 有些地方待太短沒意義（導覽制的農場），地點先驗仍然是上限 */
  it("專注度比地點先驗長時，用地點先驗", () => {
    expect(effectiveStayMinutes(place(60), [child(120)])).toBe(60);
  });

  /**
   * §7.2 是「取最低分而非平均」的保守原則，這裡同理：
   * **你是在最小的那個崩潰時離開的**，不是在平均值離開。
   */
  it("多小孩取最短的那一個", () => {
    expect(effectiveStayMinutes(place(120), [child(90), child(45)])).toBe(45);
  });

  it("有人沒填時只看有填的那些", () => {
    expect(effectiveStayMinutes(place(120), [child(null), child(50)])).toBe(50);
  });

  it("0 或負數視為沒填，不會讓停留時間變成 0", () => {
    expect(effectiveStayMinutes(place(90), [child(0)])).toBe(90);
    expect(effectiveStayMinutes(place(90), [child(-30)])).toBe(90);
  });
});

describe("對推薦的實際影響（ADR-0025）", () => {
  /**
   * 使用者的真實行程：8:00 出門、開一小時到和平島、玩一小時、12:00 到家。
   * 單程 60 分、停留 60 分、回程 60 分 = 180 分。
   *
   * 若用遊戲場的先驗 90 分算，總共要 210 分——時間窗剩 200 分時就會被
   * not_enough_time 剔除，而那是一趟他**實際做得到而且做過**的行程。
   */
  it("專注度較短時，遠一點的地點才不會被誤判為時間不夠", () => {
    const farPlace = place(90);
    const window = 200; // 分鐘

    const withoutSpan =
      60 + effectiveStayMinutes(farPlace, [child(null)]) + 60;
    const withSpan = 60 + effectiveStayMinutes(farPlace, [child(60)]) + 60;

    expect(withoutSpan).toBeGreaterThan(window); // 會被剔除
    expect(withSpan).toBeLessThanOrEqual(window); // 來得及
  });
});

/**
 * 小孩資料驗證的規格（設計架構書 §5.1）
 *
 * napStage 與 mobility 是推薦邏輯的支點，所以這裡擋的不是格式錯誤，
 * 是會讓決策層拿到矛盾輸入的組合。
 */

import { describe, expect, it } from "vitest";

import { validateChildInput, type RawChildInput } from "./child-input";

const valid: RawChildInput = {
  name: "小寶",
  birthDate: "2024-10-22",
  napStage: "one_nap",
  wakeTime: "07:00",
  bedTime: "20:30",
  mobility: "stroller",
  napStarts: ["12:30", ""],
  napEnds: ["14:30", ""],
  notes: "",
};

const check = (o: Partial<RawChildInput> = {}) =>
  validateChildInput({ ...valid, ...o });

function expectError(o: Partial<RawChildInput>, pattern: RegExp) {
  const r = check(o);
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.message).toMatch(pattern);
}

describe("合法輸入", () => {
  it("通過並收集午睡窗", () => {
    const r = check();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.napWindows).toEqual([{ start: "12:30", end: "14:30" }]);
    expect(r.value.napStage).toBe("one_nap");
  });

  it("兩段午睡都收得起來，涵蓋 two_naps 階段", () => {
    const r = check({
      napStage: "two_naps",
      napStarts: ["09:30", "13:00"],
      napEnds: ["10:30", "14:30"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.napWindows).toHaveLength(2);
  });

  it("整組留空的午睡段被忽略，不會變成空窗", () => {
    const r = check({ napStarts: ["12:30", "  "], napEnds: ["14:30", ""] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.napWindows).toHaveLength(1);
  });

  it("備註留白存成 null", () => {
    const r = check({ notes: "   " });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.notes).toBeNull();
  });
});

describe("作息階段與午睡時段必須一致", () => {
  it("選了「不睡午覺」卻填午睡時段被擋下", () => {
    // 放行的話 Stage 2 會拿那個窗去判斷衝突，
    // 使用者卻以為自己已經設成不睡了——症狀是「推薦莫名其妙避開下午」。
    expectError({ napStage: "no_nap" }, /清空/);
  });

  it("「不睡午覺」且午睡時段留空是合法的", () => {
    const r = check({ napStage: "no_nap", napStarts: ["", ""], napEnds: ["", ""] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.napWindows).toEqual([]);
  });

  it("會睡午覺卻沒填任何時段被擋下", () => {
    expectError({ napStarts: ["", ""], napEnds: ["", ""] }, /至少一段/);
  });
});

describe("時間格式", () => {
  it("非 HH:MM 被擋下", () => {
    expectError({ wakeTime: "7:00" }, /HH:MM/);
    expectError({ bedTime: "25:00" }, /HH:MM/);
    expectError({ napStarts: ["1230", ""] }, /HH:MM/);
  });

  it("午睡結束早於開始被擋下", () => {
    expectError({ napStarts: ["14:30", ""], napEnds: ["12:30", ""] }, /晚於開始/);
  });

  it("只填一半的午睡段被擋下", () => {
    expectError({ napStarts: ["12:30", ""], napEnds: ["", ""] }, /HH:MM/);
  });
});

describe("生日", () => {
  it("未來的日期被擋下", () => {
    expectError({ birthDate: "2099-01-01" }, /未來/);
  });

  it("格式不對被擋下", () => {
    expectError({ birthDate: "2024/10/22" }, /YYYY-MM-DD/);
  });
});

describe("列舉欄位", () => {
  it("不認得的作息階段被擋下", () => {
    expectError({ napStage: "睡很多" }, /作息階段/);
  });

  it("不認得的行動能力被擋下", () => {
    expectError({ mobility: "會飛" }, /行動能力/);
  });
});

describe("名字", () => {
  it("空白被擋下", () => {
    expectError({ name: "  " }, /名字/);
  });
});

import { describe, expect, it } from "vitest";

import { parseCsv, parseCsvRows } from "./csv";

describe("CSV 解析", () => {
  it("解析基本的逗號分隔", () => {
    expect(parseCsvRows("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("引號內的逗號不算分隔符", () => {
    // 新北市公園的「南山公園 (公兒三)」與桃園的設施清單都有這種。
    expect(parseCsvRows('a,b\n"含,逗號",2')).toEqual([["a", "b"], ["含,逗號", "2"]]);
  });

  it("引號內的換行不算換列", () => {
    expect(parseCsvRows('a\n"第一行\n第二行"')).toEqual([["a"], ["第一行\n第二行"]]);
  });

  it("兩個雙引號代表一個雙引號", () => {
    expect(parseCsvRows('a\n"他說""你好"""')).toEqual([["a"], ['他說"你好"']]);
  });

  it("吃掉 BOM，否則第一個欄位名會多一個看不見的字元", () => {
    expect(parseCsv("﻿name,x\n甲,1")[0].name).toBe("甲");
  });

  it("CRLF 換行", () => {
    expect(parseCsvRows("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("欄位數少於表頭時補空字串", () => {
    expect(parseCsv("a,b,c\n1,2")).toEqual([{ a: "1", b: "2", c: "" }]);
  });

  it("空白列被略過", () => {
    expect(parseCsvRows("a\n\n1\n")).toEqual([["a"], ["1"]]);
  });

  it("空字串回傳空陣列", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

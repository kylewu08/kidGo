import { describe, expect, it } from "vitest";

import { ageBandsFromEquipment, runnableSpaceFromAreaSqm } from "./derivation";

describe("遊具 → 適齡層", () => {
  it("搖搖馬與沙坑推出嬰幼兒", () => {
    expect(ageBandsFromEquipment(["搖搖馬", "戲沙坑"])).toEqual(["infant", "toddler"]);
  });

  it("攀岩牆推出學齡前與學齡，不含嬰兒", () => {
    expect(ageBandsFromEquipment(["攀岩牆"])).toEqual(["preschool", "school_age"]);
  });

  it("組合遊具涵蓋學步兒到學齡，因為它是多段式的籠統詞", () => {
    // 305 座公園有這個詞，是最大宗。放窄會讓大量合適的地點被硬過濾剔除。
    expect(ageBandsFromEquipment(["組合遊具"])).toEqual(["toddler", "preschool", "school_age"]);
  });

  it("多項遊具取聯集而非交集", () => {
    // 「放寬」的具體意思：一座同時有沙坑與攀岩牆的公園，兩端年齡都適合。
    expect(ageBandsFromEquipment(["戲沙坑", "攀岩牆"])).toEqual([
      "infant",
      "toddler",
      "preschool",
      "school_age",
    ]);
  });

  it("一筆遊具命中多條規則時同樣取聯集", () => {
    // 「共融式組合遊具-愛的搖籃」同時是組合遊具與搖籃。
    expect(ageBandsFromEquipment(["共融式組合遊具-愛的搖籃"])).toEqual([
      "infant",
      "toddler",
      "preschool",
      "school_age",
    ]);
  });

  it("英文遊具名不分大小寫", () => {
    expect(ageBandsFromEquipment(["MONKEY BAR"])).toEqual(["preschool", "school_age"]);
    expect(ageBandsFromEquipment(["曲型monkey bar"])).toEqual(["preschool", "school_age"]);
  });

  it("回傳的年齡層依月齡由小到大排序，不依命中順序", () => {
    expect(ageBandsFromEquipment(["攀岩牆", "搖搖馬"])).toEqual([
      "infant",
      "toddler",
      "preschool",
      "school_age",
    ]);
  });

  it("沒有任何遊具命中規則時回傳 null，代表推不出來", () => {
    // 「推不出來」與「確認無遊具」是不同的事：前者該讓類別先驗接手，
    // 後者是 facilityAgeBands = null 的那個語意。混為一談會讓
    // 無法辨識的遊具變成「這裡沒有遊具」，而那是會影響硬過濾的錯誤。
    expect(ageBandsFromEquipment(["公園名稱牌"])).toBeNull();
    expect(ageBandsFromEquipment([])).toBeNull();
  });
});

describe("場地面積 → 可奔跑空間", () => {
  it("五千平方公尺以上算可自由奔跑", () => {
    expect(runnableSpaceFromAreaSqm(6558)).toBe(3);
  });

  it("一千到五千之間給 2", () => {
    // 臺北公園面積中位數 2313，落在這一格。
    expect(runnableSpaceFromAreaSqm(2313)).toBe(2);
  });

  it("不到一千的社區小綠地給 1", () => {
    expect(runnableSpaceFromAreaSqm(400)).toBe(1);
  });

  it("面積推導多半會調低分數，而這正是它的用處", () => {
    // category-priors 給 park 的先驗值是 3。若面積推導總是給 3，
    // 這條規則就沒有存在意義——它要能分出先驗值分不出來的差別。
    expect(runnableSpaceFromAreaSqm(2313)).toBeLessThan(3);
  });

  it("沒有面積或面積為零時回傳 null，交給類別先驗", () => {
    expect(runnableSpaceFromAreaSqm(0)).toBeNull();
    expect(runnableSpaceFromAreaSqm(Number.NaN)).toBeNull();
  });
});

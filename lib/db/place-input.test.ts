/**
 * 地點輸入驗證的規格（設計架構書 §5.2）
 *
 * 這裡的每一條不是通用的表單檢查，而是對應某個欄位的語意。
 * 例如「最適年齡必須落在適合年齡範圍內」——不是因為感覺比較整齊，
 * 是因為 scoring.ts 的年齡因子會在兩者之間做線性內插，
 * sweet spot 跑到 ageRange 外面會算出負的距離。
 */

import { describe, expect, it } from "vitest";

import { validatePlaceInput, type RawPlaceInput } from "./place-input";

const valid: RawPlaceInput = {
  name: "大安森林公園",
  category: "park",
  address: "台北市大安區新生南路二段1號",
  lat: "25.0299",
  lng: "121.5361",
  driveMinutes: "20",
  parking: "hard",
  energyBurn: "4",
  typicalDurationMin: "120",
  bestTimeSlots: ["early_morning", "post_nap"],
  ageMinMonths: "6",
  ageMaxMonths: "96",
  sweetSpotMinMonths: "18",
  sweetSpotMaxMonths: "48",
  indoor: "outdoor",
  shadeLevel: "2",
  strollerFriendly: true,
  hasChangingTable: true,
  hasNursingSpace: false,
  hasFoodOnSite: false,
  hasWaterPlay: true,
  needsReservation: false,
  crowdWeekday: "2",
  crowdWeekend: "5",
  quietHours: "平日 14:00-16:00 人最少",
  costPerFamily: "",
  personalRating: "4",
  notes: "沙坑很大",
  tags: "近捷運, 有沙坑",
};

const check = (o: Partial<RawPlaceInput> = {}) =>
  validatePlaceInput({ ...valid, ...o });

function expectError(o: Partial<RawPlaceInput>, pattern: RegExp) {
  const result = check(o);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.message).toMatch(pattern);
}

describe("合法輸入", () => {
  it("通過並把字串轉成正確的型別", () => {
    const result = check();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.lat).toBe(25.0299);
    expect(result.value.driveMinutes).toBe(20);
    expect(result.value.energyBurn).toBe(4);
    expect(result.value.ageRange).toEqual({ minMonths: 6, maxMonths: 96 });
    expect(result.value.crowdLevel).toEqual({ weekday: 2, weekend: 5 });
    expect(result.value.strollerFriendly).toBe(true);
  });

  it("標籤用逗號或空白分隔，前後空白會被去掉", () => {
    const result = check({ tags: "近捷運,  有沙坑 ，遮蔭多" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tags).toEqual(["近捷運", "有沙坑", "遮蔭多"]);
  });

  it("空白的選填欄位存成 null 而不是空字串", () => {
    const result = check({ quietHours: "  ", notes: "", costPerFamily: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.quietHours).toBeNull();
    expect(result.value.notes).toBeNull();
    expect(result.value.costPerFamily).toBeNull();
  });

  it("所有欄位都標記為 manual——v1 沒有 AI 建檔", () => {
    // 設計架構書 §12.6：fieldSources 從第一天就存在，
    // Phase 2 導入 AI 建檔時不需要 migration。
    const result = check();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fieldSources.energyBurn).toBe("manual");
    expect(result.value.fieldSources.driveMinutes).toBe("manual");
  });
});

describe("最適年齡（sweetSpotAge）", () => {
  it("可以整個留空——空著代表還沒判斷過", () => {
    // §7.2：sweetSpotAge 是 AI 不得填寫的欄位。留空時評分給中性分數，
    // 不是零分，否則新建檔的地點永遠排不上來。
    const result = check({ sweetSpotMinMonths: "", sweetSpotMaxMonths: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sweetSpotAge).toBeNull();
  });

  it("只填一半被擋下", () => {
    expectError({ sweetSpotMaxMonths: "" }, /兩個都填|兩個都留空/);
  });

  it("必須落在適合年齡的範圍內", () => {
    // scoring.ts 的年齡因子在 sweet spot 邊界與 ageRange 邊界之間線性內插，
    // sweet spot 跑到外面會算出負的距離。
    expectError({ sweetSpotMinMonths: "3" }, /落在適合年齡的範圍內/);
    expectError({ sweetSpotMaxMonths: "120" }, /落在適合年齡的範圍內/);
  });

  it("下限大於上限被擋下", () => {
    expectError(
      { sweetSpotMinMonths: "48", sweetSpotMaxMonths: "18" },
      /下限不能大於上限/,
    );
  });
});

describe("適合年齡（ageRange）", () => {
  it("下限大於上限被擋下", () => {
    expectError({ ageMinMonths: "96", ageMaxMonths: "6" }, /下限不能大於上限/);
  });

  it("超過 144 個月被擋下——12 歲以上不是這個產品的對象", () => {
    expectError({ ageMaxMonths: "200" }, /月齡/);
  });

  it("下限與上限相同是合法的", () => {
    expect(check({ ageMinMonths: "24", ageMaxMonths: "24", sweetSpotMinMonths: "24", sweetSpotMaxMonths: "24" }).ok).toBe(true);
  });
});

describe("座標", () => {
  it("緯度經度填反時被擋下", () => {
    expectError({ lat: "121.5361", lng: "25.0299" }, /填反/);
  });

  it("臺灣以外的座標被擋下", () => {
    expectError({ lat: "35.6762", lng: "139.6503" }, /臺灣範圍/);
  });

  it("非數字被擋下", () => {
    expectError({ lat: "abc" }, /數字/);
  });
});

describe("列舉欄位", () => {
  it("不認得的分類被擋下", () => {
    expectError({ category: "遊樂園" }, /分類/);
  });

  it("不認得的室內外類型被擋下", () => {
    expectError({ indoor: "半室內" }, /室內外/);
  });

  it("不認得的時段被擋下", () => {
    expectError({ bestTimeSlots: ["morning", "midnight"] }, /時段/);
  });

  it("沒有選任何時段是合法的——評分時會給中性分數", () => {
    expect(check({ bestTimeSlots: [] }).ok).toBe(true);
  });
});

describe("數值範圍", () => {
  it("放電強度超出 1–5 被擋下", () => {
    expectError({ energyBurn: "0" }, /放電強度/);
    expectError({ energyBurn: "6" }, /放電強度/);
  });

  it("遮蔽程度超出 0–3 被擋下", () => {
    expectError({ shadeLevel: "4" }, /遮蔽/);
  });

  it("遮蔽程度 0 是合法的——全無遮蔽是一種真實狀態", () => {
    expect(check({ shadeLevel: "0" }).ok).toBe(true);
  });

  it("車程 0 分是合法的——走路就到的地方", () => {
    expect(check({ driveMinutes: "0" }).ok).toBe(true);
  });

  it("可撐時間 0 分被擋下", () => {
    expectError({ typicalDurationMin: "0" }, /可撐時間/);
  });

  it("小數被擋下", () => {
    expectError({ driveMinutes: "20.5" }, /整數/);
  });

  it("個人評分可以留空——還沒去過就還沒有評價", () => {
    const result = check({ personalRating: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.personalRating).toBeNull();
  });
});

describe("名稱", () => {
  it("空白被擋下", () => {
    expectError({ name: "   " }, /名稱/);
  });

  it("前後空白會被去掉", () => {
    const result = check({ name: "  碧潭  " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("碧潭");
  });
});

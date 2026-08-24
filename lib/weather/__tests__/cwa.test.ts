/**
 * CWA 回應解析的規格（設計架構書 §9）
 *
 * 用的是 2026-08-24 從 CWA 真實抓回來的板橋區回應（banqiao-sample.json），
 * 不是我編的假資料。這一點很重要：這個模組的價值幾乎全在「能不能正確吃下
 * 對方實際吐出來的東西」，用手寫的假 payload 測等於在測自己的想像。
 */

import { describe, expect, it } from "vitest";

import { CwaError, fetchCwaForecast, parseCwaForecast, type CwaPayload } from "../cwa";
import { COUNTY_DATASET_IDS, TOWNSHIPS, findTownship } from "../townships";
import sample from "./banqiao-sample.json";

const payload = sample as CwaPayload;

/** 深拷貝，讓每個測試都能安全地破壞 payload */
const mutable = () => structuredClone(payload) as CwaPayload;

describe("解析真實回應", () => {
  it("解析出逐三小時的預報時段", () => {
    const forecast = parseCwaForecast(payload, "板橋區");
    expect(forecast.slots).toHaveLength(4);
  });

  it("時段依時間遞增排序", () => {
    const { slots } = parseCwaForecast(payload, "板橋區");
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].startsAt.getTime()).toBeGreaterThan(
        slots[i - 1].startsAt.getTime(),
      );
    }
  });

  it("降雨機率與天氣現象取自同一個時間區間", () => {
    const [first] = parseCwaForecast(payload, "板橋區").slots;
    // 真實資料：2026-08-24 18:00 起，降雨 70%，短暫陣雨或雷雨
    expect(first.rainProbability).toBe(70);
    expect(first.condition).toBe("短暫陣雨或雷雨");
  });

  it("逐時的體感溫度併進三小時區間時取最大值", () => {
    // 真實資料 18:00/19:00/20:00 的體感溫度是 31/30/30 → 該區間取 31。
    // 取最大不取平均：三小時內只要有一小時 35 度，那一小時就足以毀掉整趟。
    const [first] = parseCwaForecast(payload, "板橋區").slots;
    expect(first.apparentTempC).toBe(31);
  });

  it("第二個區間取自它自己的那三小時，不是沿用前一段", () => {
    // 21:00/22:00/23:00 的體感溫度是 29/30/30 → 取 30
    const [, second] = parseCwaForecast(payload, "板橋區").slots;
    expect(second.apparentTempC).toBe(30);
    expect(second.rainProbability).toBe(80);
  });

  it("產出的形狀正好是推薦引擎吃的 WeatherForecast", () => {
    const { slots } = parseCwaForecast(payload, "板橋區");
    for (const slot of slots) {
      expect(slot.startsAt).toBeInstanceOf(Date);
      expect(typeof slot.rainProbability).toBe("number");
      expect(typeof slot.apparentTempC).toBe("number");
      expect(typeof slot.condition).toBe("string");
    }
  });
});

describe("壞掉的回應", () => {
  it("success 不是 true 時丟出可讀的錯誤，並指向授權碼", () => {
    const broken = mutable();
    broken.success = "false";
    expect(() => parseCwaForecast(broken, "板橋區")).toThrow(CwaError);
    expect(() => parseCwaForecast(broken, "板橋區")).toThrow(/授權碼/);
  });

  it("找不到指定鄉鎮時，錯誤訊息列出這個資料集裡有哪些鄉鎮", () => {
    // 這是為了讓「新北市的資料集裡找臺北市的區」這種錯誤一眼看得出來。
    expect(() => parseCwaForecast(payload, "大安區")).toThrow(/板橋區/);
  });

  it("缺少氣象要素時指出是哪一個", () => {
    const broken = mutable();
    const location = broken.records!.Locations![0].Location![0];
    location.WeatherElement = location.WeatherElement.filter(
      (e) => e.ElementName !== "體感溫度",
    );
    expect(() => parseCwaForecast(broken, "板橋區")).toThrow(/體感溫度/);
  });

  it("降雨機率是 CWA 的空值符號時，整個區間被捨棄而不是當成 0", () => {
    // 把 0 當成「不會下雨」會讓 Stage 1 放行一個其實不該去的戶外地點。
    const broken = mutable();
    const rain = broken.records!.Locations![0].Location![0].WeatherElement.find(
      (e) => e.ElementName === "3小時降雨機率",
    )!;
    rain.Time[0].ElementValue[0].ProbabilityOfPrecipitation = "-";

    const forecast = parseCwaForecast(broken, "板橋區");
    expect(forecast.slots).toHaveLength(3);
    expect(forecast.slots[0].rainProbability).toBe(80); // 第一段被丟掉了
  });

  it("完全沒有可用區間時丟錯，而不是回傳空的預報", () => {
    // 空的預報會讓推薦引擎的天氣因子全部落到「沒有資料」的中性分數，
    // 使用者看到的是一份看似正常但其實沒考慮天氣的清單。那比報錯糟。
    const broken = mutable();
    const rain = broken.records!.Locations![0].Location![0].WeatherElement.find(
      (e) => e.ElementName === "3小時降雨機率",
    )!;
    rain.Time = [];
    expect(() => parseCwaForecast(broken, "板橋區")).toThrow(CwaError);
  });
});

describe("鄉鎮對照表", () => {
  it("涵蓋全臺 368 個鄉鎮市區與 22 個縣市", () => {
    expect(TOWNSHIPS).toHaveLength(368);
    expect(Object.keys(COUNTY_DATASET_IDS)).toHaveLength(22);
  });

  it("每個鄉鎮的縣市都對得到一個資料集代號", () => {
    for (const township of TOWNSHIPS) {
      expect(COUNTY_DATASET_IDS[township.county], township.name).toBeDefined();
    }
  });

  it("鄉鎮名稱不是唯一鍵——有 8 個名稱橫跨多個縣市", () => {
    // 這條測試存在的理由是把這個事實釘住。若哪天有人想拿 name 當主鍵，
    // 這個測試會提醒他 HomeBase 只存「東區」是不夠的。
    const byName = new Map<string, number>();
    for (const t of TOWNSHIPS) byName.set(t.name, (byName.get(t.name) ?? 0) + 1);
    const duplicated = [...byName.entries()].filter(([, n]) => n > 1);

    expect(duplicated.map(([name]) => name).sort()).toEqual(
      ["中山區", "中正區", "北區", "南區", "信義區", "大安區", "東區", "西區"].sort(),
    );
  });

  it("縣市加鄉鎮名稱合起來才是唯一鍵", () => {
    const keys = TOWNSHIPS.map((t) => `${t.county}/${t.name}`);
    expect(new Set(keys).size).toBe(TOWNSHIPS.length);
  });

  it("所有座標都落在臺灣的範圍內", () => {
    for (const t of TOWNSHIPS) {
      expect(t.lat, `${t.county}${t.name}`).toBeGreaterThan(21);
      expect(t.lat, `${t.county}${t.name}`).toBeLessThan(26.5);
      expect(t.lng, `${t.county}${t.name}`).toBeGreaterThan(118);
      expect(t.lng, `${t.county}${t.name}`).toBeLessThan(122.5);
    }
  });
});

describe("送出請求前的本地檢查", () => {
  /**
   * 這一組測試不需要網路：檢查發生在 fetch 之前就丟錯。
   *
   * 這個順序本身就是重點——CWA 是在伺服器端過濾 LocationName 的，
   * 縣市與鄉鎮對不起來時它回一份「成功但空的」回應，
   * 從那份回應生不出有用的訊息。本地表可以。
   */
  const call = (county: string, township: string) =>
    fetchCwaForecast({
      county: county as never,
      township,
      apiKey: "不會被用到",
    });

  it("鄉鎮不屬於指定縣市時，直接告訴你它屬於哪裡", () => {
    // 大安區在臺北市與臺中市，不在新北市。這是最容易犯又最難察覺的錯。
    return expect(call("新北市", "大安區")).rejects.toThrow(/臺北市、臺中市/);
  });

  it("鄉鎮完全不存在時，列出該縣市有哪些鄉鎮", () =>
    expect(call("新北市", "不存在區")).rejects.toThrow(/板橋區/));

  it("縣市不認得時直接說不認得", () =>
    expect(call("火星省", "板橋區")).rejects.toThrow(/不認得的縣市/));

  it("重複的鄉鎮名稱在指定縣市後不會被誤判", () => {
    // 嘉義市東區是合法的，不該因為「東區」也存在於其他縣市而被擋下。
    //
    // 這裡直接測 findTownship 而不是 fetchCwaForecast：後者通過本地檢查後
    // 會真的送出請求，單元測試不該依賴網路（也不該依賴有效的金鑰）。
    expect(findTownship("嘉義市", "東區")).toBeDefined();
    expect(findTownship("嘉義市", "東區")?.county).toBe("嘉義市");
    expect(findTownship("新北市", "東區")).toBeUndefined();
  });
});


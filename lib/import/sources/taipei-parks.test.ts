import { describe, expect, it } from "vitest";

import { admit } from "../admission";
import {
  categoryOf,
  CumulativeShapeChangedError,
  recoverEquipment,
  toSourceRecords,
  type TaipeiParkRow,
} from "./taipei-parks";

/** 取自真實資料的前三筆，保留累積形狀。 */
const cumulativeRows: TaipeiParkRow[] = [
  { SeqNo: "157", pm_name: "七虎公園", pm_playeq: "彈跳床,搖滾盤,攀爬組,磨石滑梯" },
  { SeqNo: "158", pm_name: "八仙公園", pm_playeq: "彈跳床,搖滾盤,攀爬組,磨石滑梯,搖搖樂,翹翹板" },
  {
    SeqNo: "159",
    pm_name: "中庸1號公園",
    pm_playeq: "彈跳床,搖滾盤,攀爬組,磨石滑梯,搖搖樂,翹翹板,組合遊具,搖搖樂",
  },
];

describe("還原被累積的遊具欄位", () => {
  it("每座公園只留下自己那一段", () => {
    const recovered = recoverEquipment(cumulativeRows);
    expect(recovered.get("157")).toEqual(["彈跳床", "搖滾盤", "攀爬組", "磨石滑梯"]);
    expect(recovered.get("158")).toEqual(["搖搖樂", "翹翹板"]);
    expect(recovered.get("159")).toEqual(["組合遊具", "搖搖樂"]);
  });

  it("沒有遊具欄位的公園不進入還原結果", () => {
    // 「沒有兒童遊戲場」與「有遊戲場但遊具辨識不出來」是不同的事。
    const recovered = recoverEquipment([{ SeqNo: "1", pm_name: "某綠地" }, ...cumulativeRows]);
    expect(recovered.has("1")).toBe(false);
  });

  it("前綴關係一旦不成立就中止，不退化成拿累積值當真值", () => {
    // 臺北哪天把這個 bug 修好，或改了排序，匯入器必須大聲失敗。
    // 這是本檔案最重要的一個測試：它守的是一個會安靜壞掉的假設。
    const fixed: TaipeiParkRow[] = [
      { SeqNo: "157", pm_name: "七虎公園", pm_playeq: "彈跳床,搖滾盤" },
      { SeqNo: "158", pm_name: "八仙公園", pm_playeq: "搖搖樂,翹翹板" },
    ];
    expect(() => recoverEquipment(fixed)).toThrow(CumulativeShapeChangedError);
  });

  it("中止時的錯誤訊息指出是哪一筆破壞了前綴", () => {
    const fixed: TaipeiParkRow[] = [
      { SeqNo: "157", pm_name: "七虎公園", pm_playeq: "彈跳床" },
      { SeqNo: "158", pm_name: "八仙公園", pm_playeq: "搖搖樂" },
    ];
    expect(() => recoverEquipment(fixed)).toThrow(/八仙公園/);
  });
});

describe("類別判定", () => {
  it("共融與特色遊戲場都算共融遊戲場", () => {
    expect(categoryOf({ pm_playtype: "共融" })).toBe("inclusive_playground");
    expect(categoryOf({ pm_playtype: "特色" })).toBe("inclusive_playground");
  });

  it("一般遊戲場算公園", () => {
    expect(categoryOf({ pm_playtype: "一般", pm_type: "公園" })).toBe("park");
  });

  it("綠地算公園", () => {
    expect(categoryOf({ pm_type: "綠地" })).toBe("park");
  });

  it("廣場整筆略過，因為 Category 的 11 個值裡沒有它的位置", () => {
    expect(categoryOf({ pm_type: "廣場" })).toBeNull();
  });

  it("廣場上若有兒童遊戲場則以遊戲場論", () => {
    expect(categoryOf({ pm_type: "廣場", pm_playtype: "共融" })).toBe("inclusive_playground");
  });
});

describe("轉成 SourceRecord", () => {
  const rows: TaipeiParkRow[] = [
    {
      SeqNo: "157",
      pm_name: "七虎公園",
      pm_location: "育仁路108號（薇閣小學旁）",
      pm_Latitude: "25.1361650000",
      pm_Longitude: "121.5015500000",
      pm_type: "公園",
      pm_playtype: "共融",
      pm_LandPublicArea: "10098",
      pm_playeq: "彈跳床,搖滾盤,攀爬組,磨石滑梯",
    },
    { SeqNo: "900", pm_name: "某廣場", pm_type: "廣場", pm_LandPublicArea: "800" },
  ];

  it("座標與名稱被帶出來", () => {
    const [park] = toSourceRecords(rows);
    expect(park).toMatchObject({
      sourceDataset: "park_facility",
      sourceId: "157",
      name: "七虎公園",
      lat: 25.136165,
      lng: 121.50155,
      category: "inclusive_playground",
    });
  });

  it("一萬平方公尺的公園推出可奔跑空間 3", () => {
    expect(toSourceRecords(rows)[0].observed.runnableSpace).toBe(3);
  });

  it("遊具推出適齡層，且是還原後的那一段", () => {
    // 彈跳床與攀爬組給到學齡，搖滾盤是低重心設備所以下探到嬰兒——
    // 聯集的結果涵蓋四段，這正是「放寬」的意思。
    expect(toSourceRecords(rows)[0].observed.facilityAgeBands).toEqual([
      "infant",
      "toddler",
      "preschool",
      "school_age",
    ]);
  });

  it("廣場不會出現在結果裡", () => {
    expect(toSourceRecords(rows).map((r) => r.name)).toEqual(["七虎公園"]);
  });

  it("轉出來的地點通過入場測試", () => {
    // adapter 與入場測試的接縫：adapter 有責任填 observed，
    // 否則辛苦解析出來的地點會在下一步被擋掉。
    expect(admit(toSourceRecords(rows)[0]).admitted).toBe(true);
  });
});

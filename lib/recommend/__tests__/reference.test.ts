import { describe, expect, it } from "vitest";

import { pickReferenceNote, TRANSIENT_REJECTIONS } from "../reference";
import type { FilterResult, RejectionReason } from "../types";
import type { Category, Place } from "@/lib/db/schema";

function rejected(
  name: string,
  category: Category,
  rejectedBy: RejectionReason,
  outboundMinutes = 20,
): FilterResult {
  return {
    place: { id: name, name, category } as Place,
    passed: false,
    rejectedBy,
    warnings: [],
    drive: { outboundMinutes, returnMinutes: outboundMinutes, source: "coarse", baselineMinutes: outboundMinutes },
  } as FilterResult;
}

describe("參考欄", () => {
  it("高溫剔除的地點可以當參考——改天涼了就能去", () => {
    const note = pickReferenceNote([rejected("共融公園", "inclusive_playground", "heat")], []);
    expect(note?.result.place.name).toBe("共融公園");
    expect(note?.rejectedBy).toBe("heat");
  });

  it("安全封閉性不足的地點永遠不會出現", () => {
    // 緊鄰車道或開放水域。這不是「今天不行」，是不該被看到。
    // 參考欄是硬過濾的唯一出口，出口一寬它就變成後門。
    expect(pickReferenceNote([rejected("河堤邊", "park", "unsafe_for_toddler")], [])).toBeNull();
  });

  it("有遊具但不適齡的地點不會出現——那要等小孩長大，不是改天", () => {
    expect(pickReferenceNote([rejected("大童公園", "park", "facility_age_mismatch")], [])).toBeNull();
  });

  it("車程過遠的地點不會出現——距離不會因為換一天而變近", () => {
    expect(pickReferenceNote([rejected("宜蘭某處", "park", "drive_too_long")], [])).toBeNull();
  });

  it("優先挑三個槽位沒用到的類別", () => {
    // 推一個跟主建議同類別的沒有增加任何資訊。
    const note = pickReferenceNote(
      [rejected("某公園", "park", "heat", 10), rejected("共融公園", "inclusive_playground", "heat", 30)],
      ["park", "library"],
    );
    expect(note?.result.place.name).toBe("共融公園");
  });

  it("沒有新類別可挑時退而取用已用過的類別", () => {
    const note = pickReferenceNote([rejected("某公園", "park", "heat")], ["park"]);
    expect(note?.result.place.name).toBe("某公園");
  });

  it("同類別內取車程最近的——那是最可能改天真的會去的", () => {
    const note = pickReferenceNote(
      [
        rejected("遠的共融", "inclusive_playground", "heat", 40),
        rejected("近的共融", "inclusive_playground", "heat", 12),
      ],
      [],
    );
    expect(note?.result.place.name).toBe("近的共融");
  });

  it("沒有任何暫時性剔除時回傳 null", () => {
    expect(pickReferenceNote([], [])).toBeNull();
  });

  it("可進參考欄的理由維持三項", () => {
    // 這個測試守的是 ADR-0021 的約束：清單每長一項，
    // 硬過濾的出口就寬一分。判準是「明天會不會不一樣」。
    expect(TRANSIENT_REJECTIONS).toEqual(["heat", "rain", "not_enough_time"]);
  });
});

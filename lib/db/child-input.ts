/**
 * 小孩資料的驗證（純函式）
 *
 * `napStage` 與 `mobility` 是推薦邏輯的支點（設計架構書 §5.1），
 * 也是本產品相對於一般旅遊 App 的結構性優勢：它們每 3–6 個月改變一次，
 * 推薦結果必須跟著變，這本身就構成回訪理由。
 *
 * 所以這裡的驗證不是表單禮貌，是在保護決策的輸入。
 */

import type { Mobility, NapStage, NewChild, TimeWindow } from "./schema";

export const NAP_STAGES: NapStage[] = [
  "two_naps", "one_nap", "transitioning", "no_nap",
];

export const MOBILITIES: Mobility[] = [
  "carried", "stroller", "walks_short", "walks_full",
];

export const CHILD_LABELS = {
  napStage: {
    two_naps: "睡兩次（約 6–14 個月）",
    one_nap: "睡一次（約 14–36 個月）",
    transitioning: "過渡期（正在減少）",
    no_nap: "不睡午覺（約 3 歲以上）",
  } satisfies Record<NapStage, string>,
  mobility: {
    carried: "需要揹或抱",
    stroller: "主要靠推車",
    walks_short: "能走但續航短",
    walks_full: "能自己走完全程",
  } satisfies Record<Mobility, string>,
} as const;

export interface RawChildInput {
  name: string;
  birthDate: string;
  napStage: string;
  wakeTime: string;
  bedTime: string;
  mobility: string;
  /** 成對的午睡窗，長度相同；兩個都空白的那一組會被忽略 */
  napStarts: string[];
  napEnds: string[];
  attentionSpanMinutes: string;
  notes: string;
}

export type ChildValidation =
  | { ok: true; value: Omit<NewChild, "id"> }
  | { ok: false; message: string };

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateChildInput(raw: RawChildInput): ChildValidation {
  const name = raw.name.trim();
  if (name === "") return { ok: false, message: "名字不能空白" };

  if (!ISO_DATE.test(raw.birthDate)) {
    return { ok: false, message: "生日格式要是 YYYY-MM-DD" };
  }
  const birth = new Date(`${raw.birthDate}T00:00:00`);
  if (Number.isNaN(birth.getTime())) {
    return { ok: false, message: "看不懂這個生日" };
  }
  if (birth.getTime() > Date.now()) {
    return { ok: false, message: "生日不能是未來的日期" };
  }

  if (!NAP_STAGES.includes(raw.napStage as NapStage)) {
    return { ok: false, message: `不認得的作息階段「${raw.napStage}」` };
  }
  if (!MOBILITIES.includes(raw.mobility as Mobility)) {
    return { ok: false, message: `不認得的行動能力「${raw.mobility}」` };
  }

  if (!CLOCK.test(raw.wakeTime)) return { ok: false, message: "起床時間格式要是 HH:MM" };
  if (!CLOCK.test(raw.bedTime)) return { ok: false, message: "就寢時間格式要是 HH:MM" };

  const napWindows: TimeWindow[] = [];
  for (let i = 0; i < raw.napStarts.length; i++) {
    const start = (raw.napStarts[i] ?? "").trim();
    const end = (raw.napEnds[i] ?? "").trim();
    if (start === "" && end === "") continue; // 整組留空 = 沒有這一段午睡

    if (!CLOCK.test(start) || !CLOCK.test(end)) {
      return { ok: false, message: `第 ${i + 1} 段午睡的時間格式要是 HH:MM` };
    }
    if (start >= end) {
      // "HH:MM" 字串比較與時間順序一致，不需要轉成數字
      return { ok: false, message: `第 ${i + 1} 段午睡的結束時間要晚於開始時間` };
    }
    napWindows.push({ start, end });
  }

  // 不睡午覺的階段卻填了午睡窗，是矛盾的輸入。放行的話 Stage 2 會用那個窗去
  // 判斷衝突，使用者卻以為自己已經設成不睡了。
  if (raw.napStage === "no_nap" && napWindows.length > 0) {
    return { ok: false, message: "已選「不睡午覺」，請把午睡時段清空" };
  }
  if (raw.napStage !== "no_nap" && napWindows.length === 0) {
    return { ok: false, message: "這個作息階段需要至少一段午睡時間" };
  }

  /*
   * 專注時長是**選填**（ADR-0025）：留空表示不設限，沿用地點的先驗時長。
   *
   * 上限訂 480 分（8 小時）——超過那個數字不是專注度，是填錯了。
   * 下限 5 分同理：填 1 分鐘會讓每個地點的停留時間都變成 1 分鐘，
   * 而那不會有任何錯誤訊息，只會讓推薦悄悄失真。
   */
  const spanRaw = raw.attentionSpanMinutes.trim();
  let attentionSpanMinutes: number | null = null;
  if (spanRaw !== "") {
    const n = Number(spanRaw);
    if (!Number.isInteger(n) || n < 5 || n > 480) {
      return { ok: false, message: "專注時長請填 5 到 480 之間的整數分鐘，或留空" };
    }
    attentionSpanMinutes = n;
  }

  return {
    ok: true,
    value: {
      name,
      birthDate: raw.birthDate,
      napStage: raw.napStage as NapStage,
      wakeTime: raw.wakeTime,
      napWindows,
      bedTime: raw.bedTime,
      mobility: raw.mobility as Mobility,
      attentionSpanMinutes,
      notes: raw.notes.trim() || null,
    },
  };
}

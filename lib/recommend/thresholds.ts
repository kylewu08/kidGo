/**
 * Stage 1 硬性過濾的門檻值（設計架構書 §6.2、§12.4）
 *
 * 這些值編碼的是**育兒常識**，不是技術參數。它們來自 L1 判斷力那一層——
 * 開發者腦中既有的知識，第一天就具備，不需要任何歷史紀錄。
 *
 * 集中在這裡的理由：調門檻是長期持續的工作。散落在 filters.ts 裡的魔術數字
 * 半年後沒人知道是怎麼來的，而且改一個值要翻三個檔案。
 *
 * **改動這裡的值時，commit 訊息必須寫出觸發調整的實際觀察**（CONTRIBUTING.md §1 的 `tune`）。
 */

import type { TimeSlot } from "@/lib/db/schema";

export const THRESHOLDS = {
  /**
   * 降雨機率超過此值（%），純戶外地點直接剔除。
   *
   * 60 而不是 50：台灣的午後雷陣雨預報常態性偏高，門檻訂太低會在夏天把
   * 所有戶外地點清空，那時這個 App 就只會推薦室內遊樂場，失去意義。
   */
  rainProbabilityExcludeOutdoor: 60,

  /**
   * 體感溫度超過此值（°C）且遮蔽不足時，戶外地點剔除。
   *
   * 用體感溫度不是氣溫：33°C 加上高濕度，對還不會自己說「我熱」的小孩是危險的。
   */
  apparentTempExcludeOutdoor: 33,

  /**
   * 上一條的但書：遮蔽程度大於此值的地點不受高溫剔除。
   * shadeLevel 0=全無遮蔽 1=少量 2=不少 3=幾乎全遮，所以 <=1 才剔除。
   */
  heatExemptShadeLevelAbove: 1,

  /**
   * 可用時間必須至少能容納：來回車程 + 典型停留時間 × 此係數。
   *
   * 0.6 的意思是「至少待得到六成的典型時長才值得去」。
   * 開 40 分鐘車去玩 30 分鐘，小孩還沒進入狀況就要走，通常以崩潰收場。
   */
  minimumStayRatio: 0.6,
} as const;

/**
 * 時段的時鐘定義（設計架構書 §5.2 的 TimeSlot）
 *
 * ⚠️ 這組區間是**推測值**，設計架構書沒有明確定義 TimeSlot 對應的時鐘範圍。
 * 起點取自附錄「月齡 → 作息階段對照」的建議出遊窗。
 * 實際使用後應該會需要調整，屆時請照 `tune` 的規則寫 commit。
 *
 * 端點採前閉後開 [start, end)，所以不會有某個時刻同時屬於兩個時段。
 * 邊界不是懸崖：離開區間後於 SCORING.schedule.softEdgeMinutes 內線性遞減
 * （見 timeline.ts 的 slotProximity）。
 *
 * ⚠️ **已知問題：11:30–14:30 這段不屬於任何時段，柔化邊界也蓋不滿。**
 * 後果是這段時間出發的行程，作息因子的兩半會因為同一個事實各扣一次：
 * 時段配對拿 0（不屬於任何時段），午睡相容也拿 0（撞到午睡）。
 *
 * 對還在睡午覺的小孩，這個雙重扣分只是加強了本來就正確的訊號；
 * 但對已經不睡午覺的 3 歲以上小孩就不合理——他們午睡那半拿滿分，
 * 卻仍因為「12:00 不屬於任何時段」被扣掉 15 分，而中午帶四歲小孩出門並沒有不對。
 *
 * 已與使用者討論過（2026-08-24），當時選擇先做柔化邊界、保留這個空白。
 * 若實際使用時發現大小孩的中午時段推薦明顯偏低，處理方式是把四個時段
 * 改成連續覆蓋，而不是再加一個補償係數。
 */
export const TIME_SLOT_RANGES: Record<
  TimeSlot,
  { startHour: number; endHour: number }
> = {
  /** 出門避開人潮與日曬的窗口，對 two_naps 階段幾乎是唯一選項 */
  early_morning: { startHour: 6, endHour: 9 },
  /** one_nap 階段的主要出遊窗，午睡前要回得了家 */
  morning: { startHour: 9, endHour: 11.5 },
  /** 午睡後的第二個窗口 */
  post_nap: { startHour: 14.5, endHour: 16.5 },
  /** 體力下降但暑氣已退，適合低強度地點 */
  late_afternoon: { startHour: 16.5, endHour: 18.5 },
};

/** `excludeRecentDays` 未指定時的預設值（設計架構書 §6.1） */
export const DEFAULT_EXCLUDE_RECENT_DAYS = 14;

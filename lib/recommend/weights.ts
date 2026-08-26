/**
 * Stage 2 加權評分的權重與調參常數（設計架構書 v1.0 §7.2、§13.2.10）
 *
 * P7 說評分規則是本產品最有價值的資產。這個檔案就是那份資產的本體。
 *
 * **改動任何一個值，commit 訊息必須寫出觸發調整的實際觀察。**
 * 「感覺這樣比較好」不是理由——那正是會讓權重越調越亂的東西。
 */

/** §7.2 的七個因子。總和必須為 1，由 weights.test.ts 守住。 */
export const WEIGHTS = {
  /** 現在時段是否適合；能否在午睡前完成或午睡後開始 */
  schedule: 0.25,
  /** 落在最適齡區間給滿分；可奔跑空間可補償無適齡設施 */
  age: 0.2,
  /** 晴天戶外加分；遮蔭對高溫的補償 */
  weather: 0.15,
  /**
   * 類別權重與戶外傾向。
   *
   * ⚠️ 這個因子在受限情境下會被**整個歸零**（§7.4 防線一），
   * 見 scoring.ts 的 preferenceSuppressed。
   * **偏好只能調整排序，永遠不能覆蓋硬過濾。**
   */
  familyPreference: 0.15,
  /** 距上次造訪越久越高；近期造訪大幅降權 */
  freshness: 0.1,
  /** 非線性；壅塞另計超線性懲罰 */
  drive: 0.1,
  /**
   * 過往回饋。**刻意壓低至 5%**——少量紀錄算不出可信平均值，
   * 過度加權只會產生雜訊（§3）。紀錄真正的價值是讓使用者發現
   * 靜態欄位填錯了，不是自動調整排序。
   */
  history: 0.05,
} as const;

export type ScoreFactor = keyof typeof WEIGHTS;

export const SCORING = {
  schedule: {
    /** 時段吻合佔作息分數的比例 */
    slotMatchShare: 0.5,
    /** 剩下的比例由午睡相容性決定 */
    napFitShare: 0.5,
    /**
     * 行程與午睡窗重疊時的分數。給 0 而不是部分分：
     * 午睡被打斷的那個下午，後面所有事情都會走樣。
     */
    napConflictScore: 0,
    /**
     * 時段邊界的柔化寬度（分鐘）。區間內滿分，離開後線性遞減到 0。
     * 不用硬邊界的理由：差兩分鐘差掉一半分數，不對應任何真實的育兒經驗。
     */
    softEdgeMinutes: 30,
    /** 地點沒填 bestTimeSlots 時的中性分數，新建檔的地點不會永遠排不上來 */
    unknownSlotsScore: 0.5,
  },

  age: {
    /** 遊具涵蓋小孩年齡層 */
    facilityMatches: 1,
    /**
     * 無遊具設施、但可奔跑空間充足時的分數（§7.2
     * 「可奔跑空間可補償無適齡設施」）。
     *
     * §6.2 的美術館就是這一格：沒有遊具，但可跑、家長不累、有冷氣、
     * 跑不掉，對 20 個月幼兒是好選擇。
     */
    runnableCompensation: 0.8,
    /** 無遊具且可跑空間也不足 */
    noFacilityNoSpace: 0.35,
    /** 有遊具但不含小孩年齡層（能走到評分代表可跑空間補償過了） */
    facilityMismatch: 0.5,
  },

  weather: {
    /** 各 IndoorType 的天氣暴露程度 0–1 */
    exposure: { indoor: 0, covered_outdoor: 0.3, mixed: 0.5, outdoor: 1 },
    comfortableMaxTempC: 30,
    comfortableMinTempC: 16,
    /** 超出舒適區這麼多度時，暴露帶來的扣分達到滿額 */
    tempPenaltySpanC: 6,
    /** 遮蔭對高溫的補償上限。不給滿 1：樹蔭再多，35 度就是 35 度。 */
    maxShadeCompensation: 0.8,
    /** 有冷氣的室內地點在高溫時的加成 */
    airConditioningBonus: 0.15,
    /** 天氣好時戶外地點的加分上限 */
    sunnyOutdoorBonus: 0.15,
    sunnyMaxRainProbability: 20,
  },

  familyPreference: {
    /** 類別權重（−1…+1）換算成 0–1 分數時的中點 */
    neutralScore: 0.5,
    /** 類別權重對分數的影響幅度 */
    categoryInfluence: 0.4,
    /** 戶外傾向（−2…+2）對分數的影響幅度 */
    outdoorInfluence: 0.25,
    /**
     * **少於這麼多筆時不套用學習權重**（§6.3）。
     * 樣本不足的學習值是雜訊，不是偏好。
     */
    minSampleCount: 8,
    /** 家長負擔超過偏好上限雖已被硬過濾，接近上限仍略微扣分 */
    parentEffortSlack: 1,
  },

  /**
   * §7.4 防線一：**偏好權重在受限情境下歸零。**
   *
   * 偏好學習會持續壓低不偏好的類別，使得雨天——正是最需要室內選項的時刻——
   * 系統手上只剩從未驗證的牌。偏好學習的失效點，恰好落在產品最該發揮價值的情境。
   *
   * 觸發任一條件即歸零，所有存活選項以原始分數競爭。
   */
  preferenceSuppression: {
    rainProbabilityAtLeast: 40,
    apparentTempAtLeast: 32,
    /** 硬過濾後存活數量少於此值時，沒有本錢再挑偏好 */
    survivorsFewerThan: 5,
  },

  freshness: {
    /** 在 excludeRecentDays 內造訪過的分數上限 */
    recentVisitCeiling: 0.3,
    /** 超過 excludeRecentDays 後，經過這麼多天回到滿分 */
    fullRecoveryDays: 60,
  },

  drive: {
    /** 此車程（分）以內視為幾乎無成本 */
    freeMinutes: 30,
    scoreAtFreeBoundary: 0.9,
    /** 超過 freeMinutes 後，每過這麼多分鐘分數衰減為 1/e */
    decayMinutes: 20,
    /**
     * **壅塞的超線性懲罰**（§7.2）。
     *
     * 塞車的成本不只是時間。在國道塞 40 分鐘與在一般道路開 40 分鐘，
     * 對小孩是完全不同的事——前者伴隨額外的車上崩潰風險。
     *
     * 以「實際車程 ÷ 基準車程」的比值計算，且僅在明顯壅塞後才生效。
     */
    congestionOnsetRatio: 1.3,
    congestionExponent: 2,
    congestionPenaltyPerUnit: 0.6,
  },

  history: {
    /**
     * 沒有任何紀錄時的分數。中性偏正：沒去過不代表不好，
     * 否則新匯入的地點永遠出不了頭，而匯入之後全部都是新的。
     */
    noVisitsScore: 0.6,
    /** outcome 三個等級各自的分數 */
    outcomeScore: { smooth: 1, ok: 0.6, meltdown: 0.1 },
  },
} as const;

/**
 * Stage 3 多樣性（§7.3、§7.4）
 */
export const DIVERSITY = {
  /** 輸出固定三項：主建議、備案、探索槽 */
  slotCount: 3,
  /**
   * 探索槽的分數下限（相對主建議）。
   *
   * 太低的話探索槽會推出明顯不合適的地點；但門檻訂太高又會讓它
   * 退化成「第三名」，失去防同溫層的作用。
   */
  exploreMinScoreRatio: 0.6,
} as const;

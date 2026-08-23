/**
 * Stage 2 加權評分的權重與調參常數（設計架構書 §6.3、§12.4）
 *
 * 設計架構書 P7 說評分規則是本產品最有價值的資產。這個檔案就是那份資產的本體。
 *
 * 兩類數值分開放：
 * - `WEIGHTS`：六個因子的佔比，總和必須為 1
 * - `SCORING`：各因子內部的曲線參數
 *
 * **改動任何一個值，commit 訊息必須寫出觸發調整的實際觀察**（CONTRIBUTING.md §1 的 `tune`）。
 * 「感覺這樣比較好」不是理由——那正是會讓權重越調越亂的東西。
 */

/** 六個評分因子的權重。總和為 1，由 weights.test.ts 守住。 */
export const WEIGHTS = {
  /** 現在時段是否合適、能否避開午睡衝突 */
  schedule: 0.3,
  /** 落在 sweetSpotAge 滿分，僅落在 ageRange 給部分分 */
  age: 0.25,
  /** 晴天戶外加分，遮蔽對高溫的補償 */
  weather: 0.2,
  /** 距上次造訪越久越高 */
  freshness: 0.1,
  /** 非線性，30 分鐘內差異不大，超過後急降 */
  drive: 0.1,
  /**
   * 歷史成效。**刻意壓低至 5%。**
   *
   * 理由（設計架構書 §2）：三筆紀錄算不出可信平均值，過度加權只會產生雜訊。
   * 紀錄真正的價值不在自動調整排序，而在讓開發者發現自己填錯了靜態欄位。
   *
   * **紀錄筆數少於 20 筆前不得調高此值。** 由 weights.test.ts 守住上限。
   */
  history: 0.05,
} as const;

export type ScoreFactor = keyof typeof WEIGHTS;

export const SCORING = {
  schedule: {
    /** 現在時段落在 bestTimeSlots 內時，作息分數的這個比例先到手 */
    slotMatchShare: 0.5,
    /** 剩下的比例由午睡相容性決定（能在午睡前回家、或午睡後才出發） */
    napFitShare: 0.5,
    /**
     * 行程與午睡窗重疊時的分數。給 0 而不是部分分：
     * 午睡被打斷的那個下午，後面所有事情都會走樣，這不是「稍微扣一點」的情況。
     */
    napConflictScore: 0,
    /**
     * 時段邊界的柔化寬度（分鐘）。
     *
     * 在 bestTimeSlots 區間內拿滿分；離開區間後於此寬度內線性遞減到 0。
     * 例如 morning 到 11:30 結束、softEdge 30 分，則 11:45 出發拿一半分數。
     *
     * 不用硬邊界的理由：11:29 出發拿 15 分、11:31 出發拿 0 分，
     * 差兩分鐘差 15 分。那個懸崖不對應任何真實的育兒經驗。
     */
    softEdgeMinutes: 30,
    /**
     * 地點沒有填 bestTimeSlots 時，時段配對這一項的分數。
     * 與 age.unknownSweetSpot 同樣的道理：未知不等於不適合，
     * 否則剛建檔的地點永遠排不上來，而 P3「窄而深」意味著清單裡隨時都有新地點。
     */
    unknownSlotsScore: 0.5,
  },

  age: {
    /** 落在 sweetSpotAge 內 */
    inSweetSpot: 1,
    /**
     * 落在 ageRange 但在 sweetSpotAge 之外，且已到 ageRange 邊緣時的分數。
     * 從 sweet spot 邊界到 ageRange 邊界之間線性內插。
     */
    atRangeEdge: 0.3,
    /**
     * 地點沒有填 sweetSpotAge 時的分數。
     *
     * 給 0.6 而不是 1：sweetSpotAge 是 AI 不得填寫的欄位（§7.2），
     * 空著代表「還沒判斷過」。未知不該和「確認適合」拿一樣的分數，
     * 但也不該被當成不適合——那會讓新建的地點永遠排不上來。
     */
    unknownSweetSpot: 0.6,
  },

  weather: {
    /**
     * 各 IndoorType 的天氣暴露程度 0–1。
     * 用一個係數統一處理下雨與高溫，避免為四種類型寫四組分支。
     */
    exposure: {
      indoor: 0,
      covered_outdoor: 0.3,
      mixed: 0.5,
      outdoor: 1,
    },
    /** 體感溫度高於此值（°C）開始扣分 */
    comfortableMaxTempC: 30,
    /** 體感溫度低於此值（°C）開始扣分。小孩對冷的耐受比大人差。 */
    comfortableMinTempC: 16,
    /** 超出舒適區這麼多度時，暴露帶來的扣分達到滿額 */
    tempPenaltySpanC: 6,
    /**
     * 遮蔽對高溫的補償上限。shadeLevel 3 時抵銷這個比例的暴露。
     * 不給滿 1：樹蔭再多，35 度就是 35 度。
     */
    maxShadeCompensation: 0.8,
    /** 天氣好時，戶外地點的加分上限（設計架構書 §6.3「晴天戶外加分」） */
    sunnyOutdoorBonus: 0.15,
    /** 低於此降雨機率（%）才算「晴天」 */
    sunnyMaxRainProbability: 20,
  },

  freshness: {
    /** 在 excludeRecentDays 內造訪過的分數上限——「大幅降權」的具體值 */
    recentVisitCeiling: 0.3,
    /** 超過 excludeRecentDays 後，經過這麼多天回到滿分 */
    fullRecoveryDays: 60,
  },

  drive: {
    /** 此車程（分）以內視為幾乎無成本 */
    freeMinutes: 30,
    /** freeMinutes 邊界上的分數，之後才開始急降 */
    scoreAtFreeBoundary: 0.9,
    /** 超過 freeMinutes 後，每過這麼多分鐘分數衰減為 1/e */
    decayMinutes: 20,
  },

  history: {
    /**
     * 沒有任何紀錄時的分數。
     * 0.6 是刻意的中性偏正：沒去過不代表不好，否則新建檔的地點永遠出不了頭，
     * 而 P3「窄而深」意味著清單裡隨時都有剛建檔的地點。
     */
    noVisitsScore: 0.6,
    /**
     * 崩潰率的扣分係數。三次去有兩次崩潰，扣 0.667 × 此值。
     *
     * meltdown 是最誠實的訊號（§5.3），但它只在 5% 的權重裡作用，
     * 所以這裡可以扣得比較狠而不會扭曲整體排序。
     */
    meltdownPenalty: 0.5,
  },
} as const;

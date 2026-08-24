/**
 * 中央氣象署開放資料平臺的鄉鎮天氣預報（設計架構書 §9）
 *
 * 這個模組把 CWA 的回應轉成推薦引擎已經在吃的 `WeatherForecast` 形狀。
 * 方向是「轉接器順應介面」——推薦引擎定義它要什麼，這裡負責湊出來，
 * 而不是讓 CWA 的資料結構滲透進決策層。
 *
 * 解析（`parseCwaForecast`）與抓取（`fetchCwaForecast`）刻意分開：
 * 解析是純函式，測試不需要網路也不需要金鑰，用 __tests__/banqiao-sample.json
 * 這份真實回應就能跑。
 */

import type { WeatherForecast, WeatherSlot } from "@/lib/recommend";
import {
  COUNTY_DATASET_IDS,
  findTownship,
  townshipsIn,
  type CountyName,
} from "./townships";

const CWA_BASE_URL = "https://opendata.cwa.gov.tw/api/v1/rest/datastore";

/** 我們需要的三個氣象要素。名稱是 CWA 的中文原名，必須完全相符。 */
const REQUIRED_ELEMENTS = ["體感溫度", "3小時降雨機率", "天氣現象"] as const;

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

const COUNTY_NAMES = Object.keys(COUNTY_DATASET_IDS) as CountyName[];

// ---------------------------------------------------------------------------
// CWA 回應的形狀
// ---------------------------------------------------------------------------

/**
 * 只宣告我們實際會讀的欄位。CWA 回傳的欄位遠多於此，
 * 全部宣告一遍只會在他們新增欄位時製造假的型別錯誤。
 *
 * 注意所有數值都是**字串**（"31"、"70"），這是 CWA 的慣例不是筆誤。
 */
interface CwaTimeEntry {
  /** 逐時要素（體感溫度）用這個 */
  DataTime?: string;
  /** 逐三小時要素（降雨機率、天氣現象）用這一組 */
  StartTime?: string;
  EndTime?: string;
  ElementValue: Array<Record<string, string>>;
}

interface CwaElement {
  ElementName: string;
  Time: CwaTimeEntry[];
}

interface CwaLocation {
  LocationName: string;
  Latitude: string;
  Longitude: string;
  WeatherElement: CwaElement[];
}

export interface CwaPayload {
  success?: string;
  records?: {
    Locations?: Array<{
      LocationsName?: string;
      Location?: CwaLocation[];
    }>;
  };
}

export class CwaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CwaError";
  }
}

// ---------------------------------------------------------------------------
// 解析（純函式）
// ---------------------------------------------------------------------------

/** CWA 用 "-" 或空字串表示沒有資料，不是 0。 */
function parseNumeric(raw: string | undefined): number | null {
  if (raw === undefined || raw === "" || raw === "-") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function findElement(location: CwaLocation, name: string): CwaElement {
  const element = location.WeatherElement.find((e) => e.ElementName === name);
  if (!element) {
    throw new CwaError(
      `CWA 回應缺少「${name}」這個氣象要素。可能是 ElementName 參數拼錯，或 CWA 改了名稱。`,
    );
  }
  return element;
}

/**
 * 把逐「小時」的體感溫度併進逐「三小時」的桶子裡，取桶內**最大值**。
 *
 * CWA 的體感溫度是逐時的（56 筆），降雨機率與天氣現象是逐三小時的（32 筆），
 * 兩者粒度不同，必須對齊。
 *
 * 取最大而非平均，與 timeline.ts 的 forecastPeak 同一個道理：
 * 三小時內只要有一小時是 35 度，那一小時就足以讓整趟出遊變成災難，
 * 平均會把它稀釋成看起來可以接受的數字。
 */
function peakApparentTemp(
  hourly: CwaTimeEntry[],
  slotStart: Date,
  slotEnd: Date,
): number | null {
  const values = hourly
    .filter((entry) => {
      if (!entry.DataTime) return false;
      const at = new Date(entry.DataTime);
      return at >= slotStart && at < slotEnd;
    })
    .map((entry) => parseNumeric(entry.ElementValue[0]?.ApparentTemperature))
    .filter((v): v is number => v !== null);

  return values.length > 0 ? Math.max(...values) : null;
}

/**
 * 把 CWA 的回應轉成 `WeatherForecast`。
 *
 * 以「3小時降雨機率」的時間區間為骨架，因為那是推薦引擎 Stage 1 最關鍵的欄位
 * （降雨機率 > 60% 直接剔除純戶外）。體感溫度與天氣現象往這個骨架上對齊。
 *
 * 任何一個三小時區間若缺降雨機率或體感溫度，整段**捨棄不用**，不填補預設值。
 * 理由與 lib/ai 的規則一致：寧可讓上層知道「這段沒資料」，
 * 也不要塞一個看起來合理的猜測值——推薦引擎會拿它去做剔除判斷。
 */
export function parseCwaForecast(
  payload: CwaPayload,
  townshipName: string,
): WeatherForecast {
  if (payload.success !== "true") {
    throw new CwaError(
      "CWA 回應的 success 不是 \"true\"，通常代表授權碼無效或已過期。",
    );
  }

  const locations = payload.records?.Locations?.[0]?.Location ?? [];
  const location = locations.find((l) => l.LocationName === townshipName);
  if (!location) {
    // CWA 是在伺服器端依 LocationName 過濾的，名稱不符時它回傳的是空清單，
    // 所以這裡列不出「有哪些可選」。真正該擋下這種錯誤的是 fetchCwaForecast
    // 送出請求前的本地檢查——走到這裡代表對方回了非預期的內容。
    const available = locations.map((l) => l.LocationName).join("、");
    throw new CwaError(
      `CWA 回應裡找不到「${townshipName}」。` +
        (available
          ? `這個資料集包含的鄉鎮是：${available}`
          : "回應是空的，通常代表縣市與鄉鎮對不起來（例如在新北市的資料集裡找大安區）。"),
    );
  }

  const rain = findElement(location, "3小時降雨機率");
  const weather = findElement(location, "天氣現象");
  const apparent = findElement(location, "體感溫度");

  // 天氣現象與降雨機率共用同一組時間區間，用起始時間對起來。
  const conditionByStart = new Map<number, string>();
  for (const entry of weather.Time) {
    if (!entry.StartTime) continue;
    const value = entry.ElementValue[0]?.Weather;
    if (value) conditionByStart.set(new Date(entry.StartTime).getTime(), value);
  }

  const slots: WeatherSlot[] = [];
  for (const entry of rain.Time) {
    if (!entry.StartTime) continue;

    const startsAt = new Date(entry.StartTime);
    const endsAt = entry.EndTime
      ? new Date(entry.EndTime)
      : new Date(startsAt.getTime() + THREE_HOURS_MS);

    const rainProbability = parseNumeric(
      entry.ElementValue[0]?.ProbabilityOfPrecipitation,
    );
    const apparentTempC = peakApparentTemp(apparent.Time, startsAt, endsAt);

    // 缺任何一項就整段跳過，不猜測。
    if (rainProbability === null || apparentTempC === null) continue;

    slots.push({
      startsAt,
      rainProbability,
      apparentTempC,
      condition: conditionByStart.get(startsAt.getTime()) ?? "",
    });
  }

  if (slots.length === 0) {
    throw new CwaError(
      `「${townshipName}」沒有任何完整的三小時預報區間。CWA 的資料可能正在更新。`,
    );
  }

  slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return { slots };
}

// ---------------------------------------------------------------------------
// 抓取（有副作用）
// ---------------------------------------------------------------------------

export interface FetchForecastOptions {
  county: CountyName;
  township: string;
  apiKey: string;
  signal?: AbortSignal;
}

/**
 * 向 CWA 取得某個鄉鎮的預報。
 *
 * **只能在伺服器端呼叫。** 授權碼絕不可以出現在瀏覽器，
 * 對外入口是 app/api/weather/route.ts 這個代理（設計架構書 §13）。
 *
 * 需要 county 是因為 CWA 把鄉鎮預報拆成 22 個縣市各自的資料集，
 * 而且鄉鎮名稱本身不唯一（東區橫跨四個縣市）。見 townships.ts。
 */
export async function fetchCwaForecast({
  county,
  township,
  apiKey,
  signal,
}: FetchForecastOptions): Promise<WeatherForecast> {
  const datasetId = COUNTY_DATASET_IDS[county];
  if (!datasetId) {
    throw new CwaError(`不認得的縣市「${county}」。可用的縣市見 townships.ts。`);
  }

  // 在送出請求之前先用本地對照表擋下來。
  //
  // 這不只是省一次網路往返：CWA 是在伺服器端過濾 LocationName 的，
  // 縣市與鄉鎮對不起來時它回傳的是一份「成功但空的」回應，
  // 從那份回應裡生不出「你是不是要找 X」這種有用的訊息。本地表可以。
  if (!findTownship(county, township)) {
    const elsewhere = COUNTY_NAMES.filter((c) => findTownship(c, township));
    throw new CwaError(
      `${county}沒有「${township}」。` +
        (elsewhere.length > 0
          ? `這個名稱屬於：${elsewhere.join("、")}。`
          : `該縣市的鄉鎮有：${townshipsIn(county).map((t) => t.name).join("、")}`),
    );
  }

  const url = new URL(`${CWA_BASE_URL}/${datasetId}`);
  url.searchParams.set("Authorization", apiKey);
  url.searchParams.set("LocationName", township);
  url.searchParams.set("ElementName", REQUIRED_ELEMENTS.join(","));

  const response = await fetch(url, {
    signal,
    // CWA 的預報每小時更新一次，逐三小時的粒度也撐得住這個快取時間。
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    throw new CwaError(
      `CWA 回應 HTTP ${response.status}。${
        response.status === 401 ? "授權碼可能無效或已過期。" : ""
      }`,
    );
  }

  return parseCwaForecast((await response.json()) as CwaPayload, township);
}

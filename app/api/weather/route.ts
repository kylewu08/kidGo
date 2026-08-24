/**
 * CWA 代理（設計架構書 §8.2、§13）
 *
 * 存在的唯一理由是**把授權碼留在伺服器端**。CWA 的 API 可以直接從瀏覽器打，
 * 但那樣金鑰就會出現在網路請求裡，任何人打開開發者工具就拿得到。
 *
 * 回應是 JSON，所以 WeatherSlot.startsAt 會被序列化成 ISO 字串。
 * 呼叫端拿去餵推薦引擎前必須轉回 Date——見下方 SerializedForecast。
 */

import { CwaError, fetchCwaForecast } from "@/lib/weather/cwa";
import { COUNTY_DATASET_IDS, type CountyName } from "@/lib/weather/townships";

/** 這條路由每次都要實際執行，不能在建置時預先產生。 */
export const dynamic = "force-dynamic";

/** JSON 化之後的 WeatherForecast。startsAt 是 ISO 字串而非 Date。 */
export interface SerializedForecast {
  slots: Array<{
    startsAt: string;
    rainProbability: number;
    apparentTempC: number;
    condition: string;
  }>;
}

function isKnownCounty(value: string): value is CountyName {
  return value in COUNTY_DATASET_IDS;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const county = searchParams.get("county");
  const township = searchParams.get("township");

  if (!county || !township) {
    return Response.json(
      { error: "需要 county 與 township 兩個查詢參數，例如 ?county=新北市&township=板橋區" },
      { status: 400 },
    );
  }

  // 鄉鎮名稱不唯一（東區橫跨四個縣市），所以縣市不是可選的。
  if (!isKnownCounty(county)) {
    return Response.json(
      { error: `不認得的縣市「${county}」` },
      { status: 400 },
    );
  }

  const apiKey = process.env.CWA_API_KEY;
  if (!apiKey) {
    // 設定問題不是使用者的錯，回 500 並在伺服器日誌留下明確訊息。
    console.error("CWA_API_KEY 未設定。複製 .env.example 成 .env.local 並填入授權碼。");
    return Response.json({ error: "伺服器尚未設定氣象資料來源" }, { status: 500 });
  }

  try {
    const forecast = await fetchCwaForecast({ county, township, apiKey });
    return Response.json(forecast satisfies { slots: unknown[] });
  } catch (error) {
    if (error instanceof CwaError) {
      // CWA 的錯誤訊息是寫給開發者看的，直接透出去——這是單人使用的工具，
      // 沒有需要對使用者隱藏內部細節的理由，看得到原因才修得動。
      return Response.json({ error: error.message }, { status: 502 });
    }
    console.error("向 CWA 取得預報時發生未預期的錯誤", error);
    return Response.json({ error: "取得天氣預報失敗" }, { status: 502 });
  }
}

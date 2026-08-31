/**
 * 路況快取的分桶規則（ADR-0005、ADR-0013）
 *
 * 純函式，與資料庫分開，理由同 home-base-input.ts：分桶規則錯了會導致
 * 「快取永遠打不中」或「打中了不該打中的」，而兩者都不會報錯——
 * 前者只是帳單變高，後者是車程悄悄變成別的時段的值。要測得到。
 *
 * **為什麼要分桶**：route_cache 的鍵包含出發時刻，但那是精確到毫秒的
 * Date。落地頁每重整一次時間就變了，逐毫秒比對等於永遠不命中，
 * 快取形同虛設——而每一次不命中都是一次 Google Routes 的計費呼叫。
 *
 * **為什麼是一小時**：路況以小時為尺度變化。同一個週六早上 9:05 與 9:35
 * 出發，車程差異遠小於估算誤差本身；但 9 點與 11 點就不一樣了。
 * 桶再大就會拿早上的路況當中午用。
 *
 * **為什麼含日期**：週六與週三的同一時刻是完全不同的路況。跨日重用
 * 看似省錢，實際上是把最需要準確的那個數字換成別天的。
 */

/** 快取鍵的時間部分：`YYYY-MM-DDTHH`（本地時間） */
export function departureBucket(departAt: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${departAt.getFullYear()}-${pad(departAt.getMonth() + 1)}-${pad(departAt.getDate())}` +
    `T${pad(departAt.getHours())}`
  );
}

/** route_cache 的主鍵。三者一起才唯一——同一地點的去程與回程是兩筆。 */
export function routeCacheId(
  placeId: string,
  direction: "outbound" | "return",
  bucket: string,
): string {
  return `${placeId}:${direction}:${bucket}`;
}

/**
 * Google Maps Platform 的服務條款不允許無限期保存路況結果，
 * ADR-0013 因此規定 30 天上限。這個函式是「該不該刪」的唯一判準。
 */
export const ROUTE_CACHE_MAX_AGE_DAYS = 30;

export function isExpired(fetchedAt: Date, now: Date): boolean {
  const ageMs = now.getTime() - fetchedAt.getTime();
  return ageMs > ROUTE_CACHE_MAX_AGE_DAYS * 24 * 3600_000;
}

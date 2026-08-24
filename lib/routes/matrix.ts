/**
 * Google Routes API — Compute Route Matrix（ADR-0005）
 *
 * 取得「從家到 N 個地點」的即時路況車程。這份實作推翻了設計架構書 §9
 * 「不要接 Directions API」的決定，完整理由見
 * docs/adr/0005-live-traffic-over-manual-drive-times.md。
 *
 * 用 Route Matrix 而非 Compute Routes：我們的形狀正好是「一個起點對多個目的地」，
 * Route Matrix 一次呼叫算完，Compute Routes 要打 N 次。
 *
 * **這個模組永遠不是必需品。** 任何失敗都應該讓呼叫端退回 Place.driveMinutes
 * 這個基準值——P6「離線可用」不能因為多了一個 API 就被犧牲。
 * 回傳的 Map 只包含成功算出來的地點，缺席即代表「用基準值」。
 */

const ROUTE_MATRIX_URL =
  "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";

/**
 * routingPreference 為 TRAFFIC_AWARE 時的元素上限是 625。
 * v1 只有 40–60 個地點，遠低於此，但還是擋一下——
 * 超過上限的請求會整批失敗，而那時錯誤訊息不會告訴你原因是數量。
 */
const MAX_ELEMENTS = 625;

export class RoutesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoutesError";
  }
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteDestination extends LatLng {
  /** 對應 Place.id，用來把回應對回地點 */
  id: string;
}

/** 只宣告我們實際會讀的欄位 */
interface RouteMatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  /** 形如 "1234s" */
  duration?: string;
  /** ROUTE_EXISTS 才代表算得出來 */
  condition?: string;
  status?: { code?: number; message?: string };
}

/** placeId → 即時車程（分鐘，四捨五入） */
export type DriveMinutesByPlaceId = Map<string, number>;

// ---------------------------------------------------------------------------
// 解析（純函式）
// ---------------------------------------------------------------------------

/** Routes API 的 duration 是 "1234s" 這種字串 */
function parseDurationSeconds(raw: string | undefined): number | null {
  if (!raw) return null;
  const seconds = Number(raw.endsWith("s") ? raw.slice(0, -1) : raw);
  return Number.isFinite(seconds) ? seconds : null;
}

/**
 * 把回應對回 placeId。
 *
 * 回應是一個扁平陣列，靠 destinationIndex 對應請求時的順序，
 * 而且**順序不保證與請求相同**——這是 Route Matrix 的設計，
 * 它會邊算邊回傳。所以一定要用 index 對應，不能靠位置。
 *
 * 算不出路線的地點（condition 不是 ROUTE_EXISTS，例如目的地在外島）
 * 直接不放進 Map，讓呼叫端退回基準值。
 */
export function parseRouteMatrix(
  elements: RouteMatrixElement[],
  destinations: RouteDestination[],
): DriveMinutesByPlaceId {
  const result: DriveMinutesByPlaceId = new Map();

  for (const element of elements) {
    if (element.condition !== "ROUTE_EXISTS") continue;

    const index = element.destinationIndex;
    if (index === undefined) continue;

    const destination = destinations[index];
    if (!destination) continue;

    const seconds = parseDurationSeconds(element.duration);
    if (seconds === null) continue;

    result.set(destination.id, Math.round(seconds / 60));
  }

  return result;
}

// ---------------------------------------------------------------------------
// 抓取（有副作用）
// ---------------------------------------------------------------------------

export interface FetchDriveMinutesOptions {
  origin: LatLng;
  destinations: RouteDestination[];
  /**
   * 預計出發時間。用來取得**預測性**路況，這是連假能算準的關鍵——
   * 週三查週六早上的車程，要的是週六的路況不是現在的。
   *
   * Routes API 不接受過去的時間，早於現在時會自動略過（等同「現在出發」）。
   */
  departAt?: Date;
  apiKey: string;
  signal?: AbortSignal;
}

function toWaypoint({ lat, lng }: LatLng) {
  return { waypoint: { location: { latLng: { latitude: lat, longitude: lng } } } };
}

/**
 * 取得即時路況車程。
 *
 * **只能在伺服器端呼叫。** 金鑰不可以出現在瀏覽器。
 *
 * 呼叫端必須把失敗當成正常狀況處理：catch 之後退回 Place.driveMinutes。
 * 這不是防禦性程式設計，是 ADR-0005 明文的設計——
 * 沒網路時使用者仍然要拿得到建議。
 */
export async function fetchDriveMinutes({
  origin,
  destinations,
  departAt,
  apiKey,
  signal,
}: FetchDriveMinutesOptions): Promise<DriveMinutesByPlaceId> {
  if (destinations.length === 0) return new Map();

  if (destinations.length > MAX_ELEMENTS) {
    throw new RoutesError(
      `一次最多查 ${MAX_ELEMENTS} 個目的地，收到 ${destinations.length} 個。` +
        "應該先用基準 driveMinutes 跑完 Stage 1 的其他條件再查（ADR-0005）。",
    );
  }

  // Routes API 拒絕過去的 departureTime。早於現在就整個略過，
  // 語意上等同「現在出發」，這正是我們要的。
  const useDepartureTime = departAt !== undefined && departAt.getTime() > Date.now();

  const response = await fetch(ROUTE_MATRIX_URL, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      // 只要這幾個欄位。FieldMask 是必填的，而且要得越多計費層級越高。
      "X-Goog-FieldMask":
        "originIndex,destinationIndex,duration,condition,status",
    },
    body: JSON.stringify({
      origins: [toWaypoint(origin)],
      destinations: destinations.map(toWaypoint),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      ...(useDepartureTime ? { departureTime: departAt!.toISOString() } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new RoutesError(
      `Routes API 回應 HTTP ${response.status}。` +
        (response.status === 403
          ? "金鑰無效、未啟用 Routes API，或未綁定帳單帳戶。"
          : "") +
        (detail ? ` 回應內容：${detail.slice(0, 300)}` : ""),
    );
  }

  const payload = (await response.json()) as RouteMatrixElement[];
  if (!Array.isArray(payload)) {
    throw new RoutesError("Routes API 回傳的不是陣列，格式可能已改變。");
  }

  return parseRouteMatrix(payload, destinations);
}

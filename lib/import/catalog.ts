/**
 * 政府資料開放平臺的資料集解析與下載（設計架構書 v1.0 §10.1）
 *
 * 抓取方式與實測結果記於 docs/資料來源盤點.md。兩條規則是從實際踩到的
 * 坑得來的，不是理論上的謹慎：
 *
 * 1. **硬寫資料集編號，執行時查 metadata 取下載網址。**
 *    下載網址含 UUID（例：`data.ntpc.gov.tw/api/datasets/5fe3a136-…/csv/file`），
 *    會隨資料集改版變動；資料集編號不會。
 *
 * 2. **選資源要用名稱比對，不可用陣列索引。**
 *    一個編號底下可以掛多份語意不同的資源——`148726`「桃園市公園」
 *    有「埤塘公園」（10 筆）與「特色遊戲場」（45 筆）兩份 CSV。
 *    用索引會在改版時無聲地換掉抓的內容，而且錯得很像對的。
 */

const METADATA_ENDPOINT = "https://data.gov.tw/api/v2/rest/dataset";

export interface DatasetResource {
  format: string;
  description: string;
  downloadUrl: string;
}

interface MetadataResponse {
  success?: boolean;
  result?: {
    title?: string;
    distribution?: {
      resourceFormat?: string;
      resourceDescription?: string;
      resourceDownloadUrl?: string;
    }[];
  };
}

export class ResourceNotFoundError extends Error {
  constructor(datasetId: string, wanted: string, available: string[]) {
    super(
      `資料集 ${datasetId} 找不到名為「${wanted}」的資源。` +
        `目前有：${available.map((d) => `「${d}」`).join("、") || "（無）"}。` +
        `資料集可能改版了——請確認來源，不要改用索引取用。`,
    );
    this.name = "ResourceNotFoundError";
  }
}

export function parseResources(payload: unknown): DatasetResource[] {
  const distribution = (payload as MetadataResponse)?.result?.distribution ?? [];
  return distribution
    .filter((r) => typeof r.resourceDownloadUrl === "string" && r.resourceDownloadUrl.length > 0)
    .map((r) => ({
      format: (r.resourceFormat ?? "").trim(),
      description: (r.resourceDescription ?? "").trim(),
      downloadUrl: r.resourceDownloadUrl as string,
    }));
}

/**
 * 依資源名稱挑出要下載的那一份。
 *
 * 只有一份資源時允許不指定名稱——多數資料集屬於這種。
 * 有多份時**必須**指定，否則丟錯：那正是 148726 的情況，
 * 靜默取第一份會拿到埤塘公園而不是特色遊戲場。
 */
export function pickResource(
  resources: DatasetResource[],
  datasetId: string,
  wantedDescription?: string,
): DatasetResource {
  if (wantedDescription === undefined) {
    if (resources.length === 1) return resources[0];
    throw new ResourceNotFoundError(
      datasetId,
      "（未指定）",
      resources.map((r) => r.description),
    );
  }

  const match = resources.find((r) => r.description === wantedDescription);
  if (!match) {
    throw new ResourceNotFoundError(
      datasetId,
      wantedDescription,
      resources.map((r) => r.description),
    );
  }
  return match;
}

export async function fetchResources(datasetId: string): Promise<DatasetResource[]> {
  const response = await fetch(`${METADATA_ENDPOINT}/${datasetId}`);
  if (!response.ok) {
    throw new Error(`資料集 ${datasetId} 的 metadata 取得失敗：HTTP ${response.status}`);
  }
  return parseResources(await response.json());
}

/**
 * 下載並依指定編碼解碼。
 *
 * 回傳字串而非 Buffer，因為每個來源的編碼是固定且已知的
 * （基隆海域遊憩是 Big5，其餘目前都是 UTF-8），
 * 讓 adapter 各自處理 Buffer 只會讓每個 adapter 重複同一段解碼邏輯。
 */
/** 下載原始位元組。壓縮檔來源用這個——解碼成字串會毀掉它。 */
export async function downloadBytes(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下載失敗：HTTP ${response.status} ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function downloadText(url: string, encoding = "utf-8"): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下載失敗：HTTP ${response.status} ${url}`);
  }
  const buffer = await response.arrayBuffer();
  // BOM 會讓第一個欄位名多出一個看不見的字元，CSV 解析時對不上 key。
  return new TextDecoder(encoding, { ignoreBOM: false }).decode(buffer);
}

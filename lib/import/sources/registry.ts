/**
 * 資料集清冊（ADR-0019：範圍限北部四縣市）
 *
 * 每個來源一筆。**硬寫的是資料集編號與資源名稱，不是下載網址**——
 * 網址含會變動的 UUID，編號不會（見 catalog.ts）。
 *
 * 加一個縣市 = 加一筆 definition + 一個 adapter + 一組 adapter 測試。
 * 不需要動 upsert、入場測試或執行層，那正是 SourceRecord 這層中介的用意。
 */

import type { SourceDataset } from "@/lib/db/schema";

import { readZipEntry } from "../zip";

import type { SourceRecord } from "../types";
import {
  ATTRACTIONS_DATASET_ID,
  toSourceRecords as attractions,
} from "./attractions";
import { LIBRARIES_DATASET_ID, toSourceRecords as libraries } from "./libraries";
import {
  PARENTING_CENTERS_DATASET_ID,
  toSourceRecords as parentingCenters,
} from "./parenting-centers";
import { toSourceRecords as taipeiParks, TAIPEI_PARKS_DATASET_ID } from "./taipei-parks";

export interface SourceDefinition {
  /** 命令列用的代號 */
  key: string;
  label: string;
  datasetId: string;
  /**
   * 一個資料集掛多份資源時必填。
   * 不填而該資料集有多份資源時，catalog.ts 會丟錯而不是猜。
   */
  resourceDescription?: string;
  /** 基隆海域遊憩是 Big5，其餘目前都是 UTF-8 */
  encoding?: string;
  sourceDataset: SourceDataset;
  /** 文字來源用這個 */
  parse?: (text: string) => SourceRecord[];
  /**
   * 壓縮檔來源用這個。觀光資訊資料庫只提供 zip，
   * 而解壓需要位元組不是解碼過的字串——用 parse 會拿到亂碼。
   */
  parseZip?: (buffer: Buffer) => SourceRecord[];
}

export const SOURCES: readonly SourceDefinition[] = [
  {
    key: "taipei-parks",
    label: "臺北市公園基本資料",
    datasetId: TAIPEI_PARKS_DATASET_ID,
    sourceDataset: "park_facility",
    parse: (text) => taipeiParks(JSON.parse(text)),
  },
  {
    key: "libraries",
    label: "公共圖書館基本資料（全國）",
    datasetId: LIBRARIES_DATASET_ID,
    sourceDataset: "library",
    parse: (text) => libraries(JSON.parse(text)),
  },
  {
    key: "museums",
    label: "觀光資訊資料庫－景點（只收博物館／美術館）",
    datasetId: ATTRACTIONS_DATASET_ID,
    resourceDescription: "觀光資料標準V2.1—景點JSON",
    sourceDataset: "tourism_spot",
    // 唯一一個 zip 來源，所以走 parseZip 而不是 parse。
    parseZip: (buf) => attractions(JSON.parse(readZipEntry(buf, "AttractionList.json").toString("utf8").replace(/^\uFEFF/, ""))),
  },
  {
    key: "parenting-centers",
    label: "全國親子館（托育資源中心）名冊",
    datasetId: PARENTING_CENTERS_DATASET_ID,
    sourceDataset: "parenting_center",
    parse: parentingCenters,
  },
] as const;

export function findSource(key: string): SourceDefinition {
  const source = SOURCES.find((s) => s.key === key);
  if (!source) {
    throw new Error(
      `不認得的來源「${key}」。目前有：${SOURCES.map((s) => s.key).join("、")}`,
    );
  }
  return source;
}

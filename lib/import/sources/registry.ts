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

import type { SourceRecord } from "../types";
import { LIBRARIES_DATASET_ID, toSourceRecords as libraries } from "./libraries";
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
  parse: (text: string) => SourceRecord[];
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

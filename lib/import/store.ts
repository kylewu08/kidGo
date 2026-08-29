/**
 * 匯入器與資料庫之間的接縫。
 *
 * 為什麼不直接用 `lib/db/queries.ts`：那個模組是 `server-only` 的，
 * 綁在 Next.js 的伺服器執行環境上。**匯入器是批次工作**——現在由
 * 命令列觸發，將來推播也要在無使用者互動下跑（§13.2 第 1 條的理由二）。
 * 讓它依賴 Next 的執行環境，等於讓一個離線工作依賴一個線上框架。
 *
 * 抽成介面還有第二個好處：可以用一個純記憶體的實作，
 * **在單元測試裡驗證真正的落地流程是冪等的**，而不只是驗證計畫是對的。
 */

import type { NewPlace, Place, SourceDataset } from "@/lib/db/schema";

export interface PlaceStore {
  findBySource(dataset: SourceDataset, sourceId: string): Promise<Place | null>;
  create(values: Omit<NewPlace, "id">): Promise<string>;
  updateFields(id: string, values: Partial<NewPlace>): Promise<void>;
  /**
   * 標記來源已移除，**但不刪除**——那筆地點可能已有造訪紀錄，
   * 刪掉會讓紀錄變成孤兒（§6.4 紀錄永不刪除）。回傳受影響筆數。
   */
  markRemoved(
    dataset: SourceDataset,
    stillPresentSourceIds: readonly string[],
    removedAt: string,
  ): Promise<number>;
  /** 曾被標記移除、這次又回到來源裡的，把標記清掉。回傳受影響筆數。 */
  clearRemoved(dataset: SourceDataset, sourceIds: readonly string[]): Promise<number>;
}

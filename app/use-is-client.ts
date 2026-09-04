import { useSyncExternalStore } from "react";

/** 伺服器端沒有瀏覽器可問，訂閱函式什麼事也不用做。 */
const noopSubscribe = () => () => {};

/**
 * 「現在是否已經在瀏覽器裡」。
 *
 * 這個產品的頁面是伺服器渲染的，而「有沒有加入主畫面」「支不支援推播」
 * 這類問題只有瀏覽器答得出來。掛載前一律不畫東西——猜錯會造成
 * hydration 不一致，而症狀是整塊區域悄悄變成空白，很難聯想到原因。
 *
 * 用 `useSyncExternalStore` 而不是 `useEffect` + `setState`：後者會被
 * `react-hooks/set-state-in-effect` 擋下來，而那條規則是對的——
 * 這是外部狀態，不是 React 的狀態。
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

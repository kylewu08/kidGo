"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * 「加入主畫面」引導（設計架構書 §9.4）
 *
 * §9.4 是規格裡少數標示「必讀」的一節，而且用了「必須」：
 *
 * > 首次設定流程**必須**引導使用者完成此步驟，並在未完成前明確告知
 * > 推播無法運作。若略過，整個產品形態對 iPhone 使用者失效。
 *
 * 所以這不是一個可以忽略的小提示，是設定流程的一部分。
 *
 * **關於誠實（P8）**：現在推播不會運作有**兩個獨立原因**——伺服器端的
 * 推播還沒實作，以及這台裝置沒加入主畫面。只講後者會讓人以為「加了就
 * 收得到」，那是假的。兩個都講，而且分開講，這樣推播上線時只要拿掉一段。
 */

/** Chrome 系的安裝提示事件。TS 的 lib 沒有這個型別。 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Situation =
  | "unknown" // 還沒判斷完（SSR 與掛載前）
  | "installed"
  | "ios" // 只能手動加，沒有安裝 API
  | "promptable" // 抓到 beforeinstallprompt
  | "manual"; // 沒裝、也沒有可用的提示

function detectInstalled(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari 用的是這個非標準屬性，其餘瀏覽器看 display-mode
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone;
  return (
    iosStandalone === true || window.matchMedia("(display-mode: standalone)").matches
  );
}

function detectIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iphone|ipod/i.test(ua)) return true;
  // iPadOS 13 起 UA 偽裝成 Macintosh，得靠觸控點數才分得出來
  return /ipad/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

/**
 * 已安裝與否是**外部狀態**（瀏覽器的顯示模式），不是 React 的狀態。
 *
 * 一開始寫成 useEffect + setState，被 react-hooks/set-state-in-effect 擋下來，
 * 而那條規則是對的：用 useSyncExternalStore 才拿得到正確的 SSR 快照，
 * 也才會在使用者裝好的當下自己更新，不必等重新整理。
 */
function subscribeInstalled(onChange: () => void) {
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", onChange);
  window.addEventListener("appinstalled", onChange);
  return () => {
    mq.removeEventListener("change", onChange);
    window.removeEventListener("appinstalled", onChange);
  };
}

/** 伺服器端沒有瀏覽器可問，一律回 false，掛載後由 client 快照修正。 */
const noopSubscribe = () => () => {};

export function AddToHomeScreen() {
  /*
   * 這個產品的頁面是伺服器渲染的，而「有沒有加入主畫面」只有瀏覽器知道。
   * 用這一組把「是否已在瀏覽器裡」變成可讀的值，掛載前一律不畫東西——
   * 猜錯會造成 hydration 不一致，而症狀是整塊區域悄悄變成空白。
   */
  const isClient = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const installed = useSyncExternalStore(subscribeInstalled, detectInstalled, () => false);

  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [declined, setDeclined] = useState(false);

  useEffect(() => {
    /*
     * beforeinstallprompt 可能在這個元件掛載之前就觸發過，那樣就抓不到，
     * 於是退回 "manual" 的手動說明。不為此加全域的早期監聽——
     * 手動說明本來就得存在（iOS 沒有這個事件），多一條路徑只是多一個
     * 會壞掉的地方，而退化的結果只是「多兩句說明」而不是功能失效。
     */
    const onPrompt = (e: Event) => {
      e.preventDefault(); // 不讓瀏覽器自己跳，改由下面那顆按鈕觸發
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  // 掛載前不畫任何東西。伺服器無從得知是否已安裝，硬猜會造成 hydration 不一致。
  if (!isClient) return null;

  const situation: Situation = installed
    ? "installed"
    : promptEvent && !declined
      ? "promptable"
      : detectIos()
        ? "ios"
        : "manual";

  if (situation === "installed") {
    return (
      <p className="rounded-xl border border-accent/30 bg-accent/[0.07] px-4 py-3 text-sm leading-relaxed">
        <span className="font-medium text-accent">✓ 已加入主畫面</span>
        <span className="opacity-75">
          　推播的平台前置條件已滿足。功能上線後這台裝置就收得到。
        </span>
      </p>
    );
  }

  return (
    <section className="rounded-xl border border-warn/40 bg-warn/[0.07] p-4 flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-warn">推播需要先加入主畫面</h2>

      <p className="text-sm leading-relaxed opacity-80">
        {situation === "ios" ? (
          <>
            iOS <strong>只在 App 被加到主畫面之後</strong>才允許送出推播。
            這是 Apple 的平台限制，不是設定問題——少了這一步，
            iPhone 永遠收不到週末早晨那則建議。
          </>
        ) : (
          <>
            裝起來之後才收得到推播，也才能離線開啟。
          </>
        )}
      </p>

      {situation === "ios" && (
        <ol className="text-sm leading-relaxed opacity-80 flex flex-col gap-1 pl-4 list-decimal">
          <li>按 Safari 底部的「分享」</li>
          <li>往下捲，選「加入主畫面」</li>
        </ol>
      )}

      {situation === "promptable" && (
        <button
          type="button"
          onClick={async () => {
            if (!promptEvent) return;
            await promptEvent.prompt();
            await promptEvent.userChoice;
            /*
             * 提示只能用一次，用掉就得丟掉，否則第二次點會拋錯。
             * 不看 outcome 決定要顯示什麼——**接受了也不代表裝好了**，
             * 真正裝好時 appinstalled 會觸發，上面那個 store 會自己更新。
             * 這裡只負責讓畫面退回手動說明，使用者反悔了還找得到路。
             */
            setPromptEvent(null);
            setDeclined(true);
          }}
          className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
        >
          安裝 KidGo
        </button>
      )}

      {situation === "manual" && (
        <p className="text-sm leading-relaxed opacity-80">
          在瀏覽器選單裡找「安裝應用程式」或「加入主畫面」。
        </p>
      )}

      {/*
        P8：不能讓人以為做完這一步就會收到推播。
        推播上線後刪掉這一段即可，其餘不用動。
      */}
      <p className="border-t border-warn/25 pt-3 text-sm leading-relaxed opacity-70">
        ⚠️ <strong>推播功能本身還在開發中。</strong>
        這一步是它的前置條件，現在先做不會白做。
      </p>
    </section>
  );
}

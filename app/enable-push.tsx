"use client";

import { useEffect, useState } from "react";

import { base64UrlToBytes } from "@/lib/push/base64url";
import {
  sendTestPushAction,
  subscribeToPushAction,
  unsubscribeFromPushAction,
  type PushActionResult,
} from "./push-actions";
import { useIsClient } from "./use-is-client";

/**
 * 開啟推播（設計架構書 §9.4）
 *
 * 訂閱只有瀏覽器做得到，但訂閱的內容必須存到伺服器——週末早晨那則推播
 * 是伺服器在無人互動下送出的，它得知道要送去哪裡。這個元件就是那一段。
 *
 * **順序不能反**：iOS 必須先加入主畫面，`window.PushManager` 才存在。
 * 所以這張卡片放在 `AddToHomeScreen` 下面，而且在不支援時直接說明原因，
 * 不假裝可以試試看。
 */

interface Props {
  /**
   * VAPID 公鑰，由伺服器元件在請求時讀出來傳進來。
   *
   * **不用 `NEXT_PUBLIC_`**：那是建置期替換，而映像在 GitHub Actions 上建，
   * 那裡沒有 NAS 的 `.env`——理由寫在 `lib/push/vapid.ts`。
   * 沒設定時是 `null`，此時誠實顯示「伺服器還沒設定」而不是給一顆會壞的按鈕。
   */
  vapidPublicKey: string | null;
}

type Notice = { ok: boolean; text: string };

function noticeFrom(result: PushActionResult): Notice {
  return result.ok ? { ok: true, text: result.message } : { ok: false, text: result.error };
}

export function EnablePush({ vapidPublicKey }: Props) {
  const isClient = useIsClient();

  const [supported, setSupported] = useState(false);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    let cancelled = false;

    void (async () => {
      try {
        /*
         * `updateViaCache: "none"` 讓瀏覽器每次檢查更新時都重新抓 sw.js，
         * 不吃 HTTP 快取。刻意用這個而不是在 next.config.ts 設 Cache-Control：
         * **執行期的映像裡沒有 next.config.ts**（Dockerfile 明講不複製），
         * 在那裡設的標頭在正式環境不會生效。
         */
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        const existing = await registration.pushManager.getSubscription();
        if (cancelled) return;
        setSupported(true);
        setEndpoint(existing?.endpoint ?? null);
      } catch (error) {
        if (cancelled) return;
        // 註冊失敗最常見的原因是非 HTTPS。說出來，否則畫面只會一片安靜。
        setNotice({
          ok: false,
          text: `Service Worker 註冊失敗：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function subscribe() {
    if (!vapidPublicKey) return;
    setBusy(true);
    setNotice(null);
    try {
      /*
       * 權限要求必須由使用者的點擊觸發，不能在載入時自己跳——
       * 除了瀏覽器會擋，這也是 §9.4 的順序：先讓人知道為什麼要開，再問。
       */
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setNotice({ ok: false, text: "沒有通知權限就收不到推播。可以稍後再開。" });
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        // 硬性條件：收到 push 就必須顯示通知，否則瀏覽器會撤銷權限。
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(vapidPublicKey),
      });

      // toJSON() 才拿得到 keys；直接傳 subscription 物件過不了序列化。
      const result = await subscribeToPushAction(subscription.toJSON());
      if (!result.ok) {
        // 伺服器沒存起來的話，瀏覽器這邊留著訂閱只會造成「以為訂了」。
        await subscription.unsubscribe();
        setNotice(noticeFrom(result));
        return;
      }
      setEndpoint(subscription.endpoint);
      setNotice(noticeFrom(result));
    } catch (error) {
      setNotice({
        ok: false,
        text: `訂閱失敗：${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    setBusy(true);
    setNotice(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      const target = subscription?.endpoint ?? endpoint;
      await subscription?.unsubscribe();
      // 兩邊都要清。只清瀏覽器的話，伺服器會一直往一個沒人收的位址送。
      if (target) setNotice(noticeFrom(await unsubscribeFromPushAction(target)));
      setEndpoint(null);
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setNotice(null);
    try {
      setNotice(noticeFrom(await sendTestPushAction()));
    } finally {
      setBusy(false);
    }
  }

  // 掛載前不畫任何東西：伺服器無從得知這台裝置的支援情況與訂閱狀態。
  if (!isClient) return null;

  return (
    <section className="rounded-xl border border-black/10 dark:border-white/15 p-4 flex flex-col gap-3">
      <h2 className="text-sm font-semibold">週末早晨的推播</h2>

      {!supported ? (
        <p className="text-sm leading-relaxed opacity-75">
          這個瀏覽器沒有提供推播介面。
          <strong>iPhone 要先把 KidGo 加入主畫面</strong>，
          從主畫面的圖示打開之後這裡才會出現訂閱按鈕（iOS 的平台限制，見上面那張卡片）。
        </p>
      ) : !vapidPublicKey ? (
        <p className="text-sm leading-relaxed opacity-75">
          伺服器還沒設定推播金鑰，所以現在無法訂閱。
          需要在 <code className="text-xs">.env</code> 填入 VAPID_PUBLIC_KEY 與
          VAPID_PRIVATE_KEY（<code className="text-xs">node scripts/generate-vapid-keys.mjs</code> 產生）。
        </p>
      ) : endpoint ? (
        <>
          <p className="text-sm leading-relaxed">
            <span className="font-medium text-accent">✓ 這台裝置已訂閱</span>
            <span className="opacity-75">
              　但週末早晨那則<strong>還不會自動送出</strong>——排程尚未實作。
              可以先送一則測試通知，確認這台裝置真的收得到。
            </span>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={sendTest}
              disabled={busy}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
            >
              送一則測試通知
            </button>
            <button
              type="button"
              onClick={unsubscribe}
              disabled={busy}
              className="rounded-lg border border-black/15 dark:border-white/25 px-4 py-2 text-sm disabled:opacity-50"
            >
              取消訂閱
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm leading-relaxed opacity-75">
            開啟後，週末早晨會收到一則帶著具體建議的通知。
            現在只會存下這台裝置的訂閱——排程還沒做，所以還不會自動送。
          </p>
          <button
            type="button"
            onClick={subscribe}
            disabled={busy}
            className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
          >
            開啟推播
          </button>
        </>
      )}

      {notice && (
        <p
          className={`text-sm leading-relaxed ${notice.ok ? "text-accent" : "text-warn"}`}
        >
          {notice.text}
        </p>
      )}
    </section>
  );
}

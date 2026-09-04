/**
 * base64url → Uint8Array
 *
 * `pushManager.subscribe()` 的 `applicationServerKey` 只吃位元組，
 * 而 VAPID 公鑰是 base64url 字串（標準 base64 把 `+/` 換成 `-_`、去掉補位的 `=`）。
 * 中間這一步沒有內建 API，每個 Web Push 實作都自己寫一次。
 *
 * 這個模組刻意不 import 任何東西：它同時跑在瀏覽器（訂閱時）與 Node（測試時）。
 *
 * 回傳型別寫成 `Uint8Array<ArrayBuffer>` 而不是 `Uint8Array`：後者的緩衝區
 * 是 `ArrayBufferLike`（含 `SharedArrayBuffer`），而 `applicationServerKey`
 * 只收 `BufferSource`，型別對不上。從明確的 `ArrayBuffer` 建構就沒有這個問題。
 */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  // `atob` 需要標準 base64：補回被去掉的 `=`，並換回 `+/`
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");

  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

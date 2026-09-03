/**
 * 產生 PWA 圖示（設計架構書 §9.4）
 *
 *   node scripts/generate-icons.mjs
 *
 * **為什麼是一支腳本而不是幾個二進位檔**：圖示要能重新產生。
 * 半年後想改色或改比例時，若只有 PNG，唯一的辦法是找一個設計工具重畫，
 * 而「當初的綠色是哪一個綠」不會有人記得。有腳本就只是改一個常數。
 * 產出的 PNG 仍然進版控——建置時不跑這支，它是一次性的產生器。
 *
 * **為什麼不引依賴**：PNG 需要的只有「zlib deflate」與「CRC32」，
 * 而 Node 內建了前者。同 lib/import/zip.ts 的判斷——
 * 為六十行函式引入依賴，對一個要離線跑在 NAS 上的專案不划算。
 *
 * CRC32 自己實作而不用 node:zlib 的 crc32()：後者要 Node 22.2+，
 * 而這支腳本的價值就在「換一台機器也跑得起來」。
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 取自 app/globals.css 的色票。**改這裡要同步改那裡**——
 * 圖示與 App 用同一個綠是刻意的，主畫面上的圖示是這個產品的第一印象。
 */
const BG = [0x1f, 0x4d, 0x3f]; // --accent 深松綠
const FG = [0xf4, 0xf2, 0xee]; // --accent-ink

// --- PNG 編碼 ---------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** rgba 是 Uint8Array，長度 size*size*4 */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10=compression, 11=filter, 12=interlace，全部 0

  // 每條掃描線前面要加一個 filter byte。全用 0（None）——
  // 圖示是大面積色塊，deflate 本來就壓得很好，選 filter 的複雜度不值得。
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const src = y * size * 4;
    const dst = y * (size * 4 + 1);
    raw[dst] = 0;
    Buffer.from(rgba.buffer, src, size * 4).copy(raw, dst + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- 幾何（全部用 0–1 的正規化座標，跟尺寸無關）-----------------------------

const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

function inRoundedRect(x, y, left, top, right, bottom, r) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const nx = Math.max(left + r, Math.min(right - r, x));
  const ny = Math.max(top + r, Math.min(bottom - r, y));
  return (x - nx) ** 2 + (y - ny) ** 2 <= r * r || (x >= left + r && x <= right - r) || (y >= top + r && y <= bottom - r);
}

/**
 * 標誌：地平線上的太陽。
 *
 * 不是隨手挑的圖形。§1.3 說這個產品的主介面是**週六早晨的一則推播**，
 * 而「早晨」正是它唯一的時刻。畫一個地圖圖釘反而是錯的——
 * 憲法第一句就寫著這**不是**景點資料庫。
 *
 * scale < 1 時整個標誌向中心縮，給 maskable 的安全區用。
 */
function markCoverage(x, y, scale) {
  const s = (v) => 0.5 + (v - 0.5) * scale;
  const horizonTop = s(0.655);

  /*
   * 太陽**被地平線切掉下緣**，不是浮在線上方。
   *
   * 第一版兩者分開，結果讀起來像一個抽象人形（頭＋肩），語意是空的。
   * 讓圓沉進線後面，「日出」就沒有其他解讀了——而這個產品只有一個時刻。
   */
  if (y <= horizonTop && inCircle(x, y, s(0.5), s(0.5), 0.21 * scale)) return true;

  // 地平線左右都比太陽寬，才讀得出是地平線而不是底線
  if (inRoundedRect(x, y, s(0.12), horizonTop, s(0.88), s(0.735), 0.04 * scale)) return true;

  return false;
}

/**
 * 4×4 超取樣。沒有反鋸齒的話，192px 的圓在主畫面上會是鋸齒狀的——
 * 而主畫面圖示旁邊都是原生 App，一眼就看得出來。
 */
function render(size, { rounded, markScale }) {
  const rgba = new Uint8Array(size * size * 4);
  const SS = 4;
  const corner = 0.22;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bgHits = 0;
      let fgHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          const inBg = rounded ? inRoundedRect(x, y, 0, 0, 1, 1, corner) : true;
          if (!inBg) continue;
          bgHits++;
          if (markCoverage(x, y, markScale)) fgHits++;
        }
      }
      const total = SS * SS;
      const i = (py * size + px) * 4;
      if (bgHits === 0) continue; // 圓角外：全透明

      // 先把標誌疊到底色上，再乘上底色本身的覆蓋率當 alpha。
      // 反過來做的話圓角邊緣會出現一圈底色的殘影。
      const fg = fgHits / bgHits;
      rgba[i] = Math.round(BG[0] * (1 - fg) + FG[0] * fg);
      rgba[i + 1] = Math.round(BG[1] * (1 - fg) + FG[1] * fg);
      rgba[i + 2] = Math.round(BG[2] * (1 - fg) + FG[2] * fg);
      rgba[i + 3] = Math.round((bgHits / total) * 255);
    }
  }
  return rgba;
}

// --- 產出 -------------------------------------------------------------------

const OUTPUTS = [
  // manifest 用。圓角，因為多數 launcher 直接照原樣顯示
  { path: "public/icon-192.png", size: 192, rounded: true, markScale: 1 },
  { path: "public/icon-512.png", size: 512, rounded: true, markScale: 1 },
  /*
   * Android 的 adaptive icon 會自行裁切成任意形狀（圓、方、水滴），
   * 所以底色必須滿版、內容必須縮在中央 80% 的安全區內。
   * 少了這一張，圖示在部分 Android launcher 上會被裁掉一角。
   */
  { path: "public/icon-maskable-512.png", size: 512, rounded: false, markScale: 0.8 },
  /*
   * iOS 主畫面用這一張，而 §9.4 說 iOS 的 Web Push 只在加入主畫面後可用——
   * **所以這張圖示是推播的前置條件的前置條件。**
   * 滿版不圓角：iOS 會自己套用它的圓角遮罩，先圓一次會出現雙重圓角。
   * 檔名是 Next 的 app/apple-icon.png 慣例，會自動產生 link 標籤。
   */
  { path: "app/apple-icon.png", size: 180, rounded: false, markScale: 1 },
];

for (const { path, size, rounded, markScale } of OUTPUTS) {
  const png = encodePng(size, render(size, { rounded, markScale }));
  const full = resolve(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, png);
  console.log(`${path.padEnd(34)}${size}×${size}  ${(png.length / 1024).toFixed(1)} KB`);
}

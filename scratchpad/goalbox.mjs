#!/usr/bin/env node
// ゴール枠 (クロスバー+ポスト、POST_COLOR不透明線) の見かけの幅:高さを実測する。
// 単純なバウンディングボックスだと、ゴールラインのピッチマーキング(白・全幅)を
// 巻き込んで幅を過大評価するため、以下の手順で狙い撃ちする:
//   1. 探索範囲内で「横に長い近似白の連続run」を上から探し、最初に見つかった行を
//      クロスバーの行とみなす → その行の左端/右端が「幅」
//   2. 左右のポストのX位置で列を下方向に走査し、白が途切れる行を「接地Y」とする
//      (クロスバー行との差が「高さ」)
// 使い方: node scratchpad/goalbox.mjs <file.png> <x0> <y0> <w> <h> [label]

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idatChunks = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (type === 'IHDR') {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf.readUInt8(dataStart + 8);
      colorType = buf.readUInt8(dataStart + 9);
    } else if (type === 'IDAT') {
      idatChunks.push(buf.subarray(dataStart, dataStart + len));
    } else if (type === 'IEND') break;
    offset = dataStart + len + 4;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const raw = inflateSync(Buffer.concat(idatChunks));
  const bpp = channels;
  const stride = width * bpp;
  const pixels = Buffer.alloc(height * stride);
  let rawOffset = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawOffset];
    rawOffset += 1;
    const lineStart = y * stride;
    const prevLineStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const raw_x = raw[rawOffset + x];
      const a = x >= bpp ? pixels[lineStart + x - bpp] : 0;
      const b = y > 0 ? pixels[prevLineStart + x] : 0;
      const c = y > 0 && x >= bpp ? pixels[prevLineStart + x - bpp] : 0;
      let value;
      switch (filterType) {
        case 0: value = raw_x; break;
        case 1: value = raw_x + a; break;
        case 2: value = raw_x + b; break;
        case 3: value = raw_x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          value = raw_x + pred;
          break;
        }
        default: throw new Error(`unsupported filter ${filterType}`);
      }
      pixels[lineStart + x] = value & 0xff;
    }
    rawOffset += stride;
  }
  return { width, height, channels, pixels };
}

function pixelAt(img, x, y) {
  const idx = (y * img.width + x) * img.channels;
  return [img.pixels[idx], img.pixels[idx + 1], img.pixels[idx + 2]];
}

function isNearWhite(r, g, b) {
  return r > 195 && g > 195 && b > 195 && Math.abs(r - g) < 20 && Math.abs(g - b) < 20;
}

/**
 * 指定行の近似白ピクセルの「外側の広がり」({start,end,len} | null) を返す。
 * 最長連続ランではなく外縁を見るのは、キーパーの選手スプライトがクロスバーの一部を
 * 隠して白ランを分断するケースがあるため (実測で発覚)。
 */
function outerWhiteExtent(img, y, x0, x1) {
  let start = -1, end = -1;
  for (let x = x0; x <= x1; x++) {
    const [r, g, b] = pixelAt(img, x, y);
    if (isNearWhite(r, g, b)) {
      if (start === -1) start = x;
      end = x;
    }
  }
  if (start === -1) return null;
  return { start, end, len: end - start };
}

/** 指定列(x)を y0から下方向に走査し、白ランが終わる行を返す (接地Y)。 */
function columnWhiteBottom(img, x, y0, yMax) {
  let lastWhite = y0;
  let gap = 0;
  for (let y = y0; y <= yMax; y++) {
    const [r, g, b] = pixelAt(img, x, y);
    if (isNearWhite(r, g, b)) {
      lastWhite = y;
      gap = 0;
    } else {
      gap++;
      if (gap > 2) break; // 2行連続で非白 = 途切れたとみなす
    }
  }
  return lastWhite;
}

const [, , file, x0s, y0s, ws, hs, label] = process.argv;
const img = decodePng(readFileSync(file));
const [x0, y0, w, h] = [x0s, y0s, ws, hs].map(Number);

// 1. クロスバーの行を探す (探索範囲を上から走査し、最初に外縁が100px以上ある行)。
let crossbarY = null, crossbarRun = null;
for (let y = y0; y < y0 + h; y++) {
  const run = outerWhiteExtent(img, y, x0, x0 + w);
  if (run && run.len >= 100) {
    crossbarY = y;
    crossbarRun = run;
    break;
  }
}

if (!crossbarY) {
  console.log(`\n=== ${label ?? file}: クロスバーが見つからなかった (探索範囲 ${x0},${y0} ${w}x${h}) ===`);
  process.exit(1);
}

const leftPostX = crossbarRun.start; // ポスト自体の列 (実測: 反アンチエイリアスで1px内側にずらすと列を外す)
const rightPostX = crossbarRun.end;
const leftBottomY = columnWhiteBottom(img, leftPostX, crossbarY, y0 + h + 20);
const rightBottomY = columnWhiteBottom(img, rightPostX, crossbarY, y0 + h + 20);
const groundY = (leftBottomY + rightBottomY) / 2;

const width = crossbarRun.len;
const height = groundY - crossbarY;

console.log(`\n=== ${label ?? file} (探索範囲 ${x0},${y0} ${w}x${h}) ===`);
console.log(`クロスバー行: y=${crossbarY}, x=[${crossbarRun.start},${crossbarRun.end}] (幅${width}px)`);
console.log(`左ポスト接地: y=${leftBottomY} / 右ポスト接地: y=${rightBottomY} → 接地Y=${groundY}`);
console.log(`見かけの幅: ${width}px / 見かけの高さ: ${height.toFixed(1)}px`);
console.log(`幅:高さ比 = ${(width / height).toFixed(2)} : 1  (目標 = 3.00 : 1、実寸7.32m x 2.44m)`);

#!/usr/bin/env node
// 最小限のPNGデコーダ + 領域サンプリングツール (V-4 の色実測用)。
// ブラウザの canvas.toDataURL('image/png') が吐く PNG (8bit, colorType 6=RGBA, フィルタ0,
// インターレースなし) だけを前提にした簡易実装。外部ライブラリ不使用 (node:zlib のみ)。
//
// 使い方: node scratchpad/pngsample.mjs <file.png> <x> <y> <w> <h> [label]
//   指定した矩形領域の頻出色トップNと平均輝度を出す。

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG (bad signature)');
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
    } else if (type === 'IEND') {
      break;
    }
    offset = dataStart + len + 4; // skip CRC
  }
  if (bitDepth !== 8) throw new Error(`unsupported bitDepth ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported colorType ${colorType}`);

  const raw = inflateSync(Buffer.concat(idatChunks));
  const bpp = channels; // bytes per pixel (bitDepth=8)
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
        default: throw new Error(`unsupported filter type ${filterType}`);
      }
      pixels[lineStart + x] = value & 0xff;
    }
    rawOffset += stride;
  }
  return { width, height, channels, pixels };
}

function sampleRegion(img, x0, y0, w, h) {
  const counts = new Map();
  let sumLum = 0, n = 0;
  for (let y = y0; y < y0 + h && y < img.height; y++) {
    for (let x = x0; x < x0 + w && x < img.width; x++) {
      const idx = (y * img.width + x) * img.channels;
      const r = img.pixels[idx], g = img.pixels[idx + 1], b = img.pixels[idx + 2];
      const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
      sumLum += 0.299 * r + 0.587 * g + 0.114 * b;
      n++;
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return { n, colorCount: counts.size, top: sorted.slice(0, 8), avgLum: n ? sumLum / n : 0 };
}

const [, , file, xs, ys, ws, hs, label] = process.argv;
const img = decodePng(readFileSync(file));
const [x, y, w, h] = [xs, ys, ws, hs].map(Number);
const result = sampleRegion(img, x, y, w, h);
console.log(`\n=== ${label ?? file} (${x},${y} ${w}x${h}, n=${result.n}) ===`);
console.log(`色数: ${result.colorCount} / 平均輝度: ${result.avgLum.toFixed(1)}`);
for (const [hex, count] of result.top) {
  console.log(`  ${hex}  ${((count / result.n) * 100).toFixed(1)}%`);
}

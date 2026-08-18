"""2fps抽出フレームからコンタクトシート(時刻ラベル付き)を合成する。場面カタログ用。"""
import cv2
import numpy as np
import os
import sys

src = sys.argv[1]          # e.g. scratchpad/frames/cat01
out_prefix = sys.argv[2]   # e.g. scratchpad/frames/sheet01
fps = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0

files = sorted(f for f in os.listdir(src) if f.endswith('.png'))
COLS, ROWS = 5, 6
TILE_W = 384
per_sheet = COLS * ROWS

img0 = cv2.imread(os.path.join(src, files[0]))
h0, w0 = img0.shape[:2]
TILE_H = int(round(h0 * TILE_W / w0))
LABEL_H = 18

n_sheets = (len(files) + per_sheet - 1) // per_sheet
for s in range(n_sheets):
    sheet = np.zeros((ROWS * (TILE_H + LABEL_H), COLS * TILE_W, 3), np.uint8)
    for i in range(per_sheet):
        k = s * per_sheet + i
        if k >= len(files):
            break
        img = cv2.imread(os.path.join(src, files[k]))
        tile = cv2.resize(img, (TILE_W, TILE_H), interpolation=cv2.INTER_AREA)
        r, c = divmod(i, COLS)
        y = r * (TILE_H + LABEL_H)
        x = c * TILE_W
        sheet[y:y + TILE_H, x:x + TILE_W] = tile
        # ffmpegの連番は f00001 が t=0 に相当 (fps=2 なら 0.5s 刻み)
        idx = int(files[k][1:6]) - 1
        t = idx / fps
        label = f'{files[k][:6]}  t={t:6.1f}s'
        cv2.putText(sheet, label, (x + 4, y + TILE_H + 14),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1, cv2.LINE_AA)
    out = f'{out_prefix}-{s:02d}.png'
    cv2.imwrite(out, sheet)
    print(out)

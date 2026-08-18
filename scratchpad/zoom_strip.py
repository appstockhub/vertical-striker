"""指定区間の指定矩形(ゲーム画面内座標)を30fpsで拡大ストリップ化する。
usage: python scratchpad/zoom_strip.py <video> <start> <dur> <cx> <cy> <cw> <ch> <out.png> [--cols 6] [--step 1] [--zoom 2]
cx,cy,cw,ch はクロップ後ゲーム画面(1246x652)内の矩形。
"""
import cv2
import numpy as np
import subprocess
import os
import sys
import tempfile

video, start, dur = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
cx, cy, cw, ch = map(int, sys.argv[4:8])
out = sys.argv[8]
cols = int(sys.argv[sys.argv.index('--cols') + 1]) if '--cols' in sys.argv else 6
step = int(sys.argv[sys.argv.index('--step') + 1]) if '--step' in sys.argv else 1
zoom = float(sys.argv[sys.argv.index('--zoom') + 1]) if '--zoom' in sys.argv else 2.0

X0, Y0, W, H = 334, 185, 1246, 652  # ゲーム画面クロップ(個人情報排除)

tmp = tempfile.mkdtemp(prefix='zoom_')
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(start), '-t', str(dur), '-i', video,
                '-vf', f'crop={W}:{H}:{X0}:{Y0},crop={cw}:{ch}:{cx}:{cy}', os.path.join(tmp, 'f%04d.png')], check=True)
files = sorted(f for f in os.listdir(tmp) if f.endswith('.png'))[::step]

tile_w, tile_h = int(cw * zoom), int(ch * zoom)
LABEL_H = 16
rows = (len(files) + cols - 1) // cols
sheet = np.zeros((rows * (tile_h + LABEL_H), cols * tile_w, 3), np.uint8)
for i, name in enumerate(files):
    img = cv2.imread(os.path.join(tmp, name))
    tile = cv2.resize(img, (tile_w, tile_h), interpolation=cv2.INTER_NEAREST)
    r, c = divmod(i, cols)
    y, x = r * (tile_h + LABEL_H), c * tile_w
    sheet[y:y + tile_h, x:x + tile_w] = tile
    t = start + (int(name[1:5]) - 1) / 30.0
    cv2.putText(sheet, f'vf{int(round(t*30)):5d} t={t:6.2f}s', (x + 4, y + tile_h + 12),
                cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 255), 1, cv2.LINE_AA)
cv2.imwrite(out, sheet)
print(out, f'{len(files)} tiles, {rows} rows')
for f in os.listdir(tmp):
    os.remove(os.path.join(tmp, f))
os.rmdir(tmp)

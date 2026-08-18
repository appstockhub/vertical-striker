"""指定区間を30fpsで切り出し、1場面=複数行ストリップ(フレーム番号+時刻ラベル付き)に合成する。
usage: python scratchpad/scene_strip.py <video> <start> <dur> <out.png> [--cols 6] [--step 1] [--tile 420]
step=Nで30fpsのNフレームごとに間引く。
"""
import cv2
import numpy as np
import subprocess
import os
import sys
import tempfile

video, start, dur, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
cols = int(sys.argv[sys.argv.index('--cols') + 1]) if '--cols' in sys.argv else 6
step = int(sys.argv[sys.argv.index('--step') + 1]) if '--step' in sys.argv else 1
tile_w = int(sys.argv[sys.argv.index('--tile') + 1]) if '--tile' in sys.argv else 420

# ゲーム画面クロップ(検出済み固定値: 個人情報の写り込みを確実に排除する)
X0, Y0, W, H = 334, 185, 1246, 652

tmp = tempfile.mkdtemp(prefix='scene_')
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(start), '-t', str(dur), '-i', video,
                '-vf', f'crop={W}:{H}:{X0}:{Y0}', os.path.join(tmp, 'f%04d.png')], check=True)
files = sorted(f for f in os.listdir(tmp) if f.endswith('.png'))[::step]

TILE_H = int(round(H * tile_w / W))
LABEL_H = 16
rows = (len(files) + cols - 1) // cols
sheet = np.zeros((rows * (TILE_H + LABEL_H), cols * tile_w, 3), np.uint8)
for i, name in enumerate(files):
    img = cv2.imread(os.path.join(tmp, name))
    tile = cv2.resize(img, (tile_w, TILE_H), interpolation=cv2.INTER_AREA)
    r, c = divmod(i, cols)
    y, x = r * (TILE_H + LABEL_H), c * tile_w
    sheet[y:y + TILE_H, x:x + tile_w] = tile
    fidx = int(name[1:5]) - 1
    t = start + fidx * step / 30.0 if step == 1 else start + (int(name[1:5]) - 1) / 30.0
    t = start + (int(name[1:5]) - 1) / 30.0
    cv2.putText(sheet, f'v-frame {int(round(t*30)):5d}  t={t:7.2f}s', (x + 4, y + TILE_H + 12),
                cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 255), 1, cv2.LINE_AA)
cv2.imwrite(out, sheet)
print(out, f'{len(files)} frames, {rows} rows')
for f in os.listdir(tmp):
    os.remove(os.path.join(tmp, f))
os.rmdir(tmp)

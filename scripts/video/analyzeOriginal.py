"""
原作プレイ動画から挙動の数値を実測するハーネス (23周目)。

★このスクリプトはゲーム本体とは完全に無関係な分析専用ツールである★
- src/ には一切影響しない。決定論とも無関係。
- 入力の動画・生成した連番PNGは .gitignore 済みで、リポジトリにも配布物にも入らない。
- 取り出すのは「挙動の数値」だけ。画像・スプライト・音は一切持ち込まない
  (CLAUDE.md「原作および他の商用ゲームの素材は一切使用しない」)。

言語がPythonなのは、この解析に OpenCV/numpy が要るため (scripts/ の他のツールは .mjs だが、
それらはゲームと同じNode環境で動かす必要があるもの。ここは独立した分析なので分けている)。

使い方:
    python scripts/video/analyzeOriginal.py geometry <video>      # 構図と縮尺を測る
    python scripts/video/analyzeOriginal.py extract  <video> [--fps N] [--start S] [--dur D]
    python scripts/video/analyzeOriginal.py track    <video> [--start S] [--dur D] [--markers]
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
from dataclasses import dataclass, asdict

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# 構図の検出
# ---------------------------------------------------------------------------

# SNESのネイティブ解像度。アップスケール倍率の逆算に使う。
SNES_W, SNES_H = 256, 224


@dataclass
class Geometry:
    """動画フレームの中でゲーム画面が占める矩形と、SNESドットへの換算係数。"""

    x0: int
    y0: int
    x1: int
    y1: int
    scale_x: float  # 動画1px = SNES 1/scale_x ドット
    scale_y: float

    @property
    def width(self) -> int:
        return self.x1 - self.x0 + 1

    @property
    def height(self) -> int:
        return self.y1 - self.y0 + 1

    @property
    def stretch(self) -> float:
        """横方向の引き伸ばし率。1.0 なら等方。"""
        return self.scale_x / self.scale_y

    def to_snes(self, x: float, y: float) -> tuple[float, float]:
        """動画フレーム座標 → SNESドット座標。**横伸びを必ずここで打ち消す**。"""
        return ((x - self.x0) / self.scale_x, (y - self.y0) / self.scale_y)


def detect_geometry(video: str, probe_frames: tuple[int, ...] = (900, 1800, 2700)) -> Geometry:
    """
    ゲーム画面の矩形と、SNESドット→動画pxの倍率を推定する。

    手順:
      1. 芝の緑の最大連結成分から、ゲーム画面の左右端を得る (プレイ画面は必ず芝で埋まる)
      2. その列範囲で上下の黒帯を探し、上下端を得る (スコア表示や選手名バーも含めた画面全体)
      3. 幅/高さを SNES の 256x224 で割ってアップスケール倍率を出す

    ★倍率を縦横それぞれ独立に出すのが要点★ 配信・録画の過程で4:3が16:9へ
    引き伸ばされている場合があり、その時 x と y の倍率が食い違う。これを補正しないと
    横方向の距離が全部間違った値になる。
    """
    cap = cv2.VideoCapture(video)
    lefts, rights, tops, bots = [], [], [], []
    for idx in probe_frames:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            continue
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        green = (
            (hsv[:, :, 0] > 35) & (hsv[:, :, 0] < 85) & (hsv[:, :, 1] > 60) & (hsv[:, :, 2] > 50)
        ).astype(np.uint8)
        n, _, stats, _ = cv2.connectedComponentsWithStats(green, 8)
        if n < 2:
            continue
        i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        gx, _, gw, _ = stats[i, :4]
        lefts.append(int(gx))
        rights.append(int(gx + gw - 1))

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        dark = gray < 40
        inner = slice(int(gx + gw * 0.05), int(gx + gw * 0.95))
        rows = dark[:, inner].mean(axis=1)
        mid = frame.shape[0] // 2
        top = next((y + 1 for y in range(mid, 0, -1) if rows[y] > 0.9), 0)
        bot = next((y - 1 for y in range(mid, frame.shape[0]) if rows[y] > 0.9), frame.shape[0] - 1)
        tops.append(top)
        bots.append(bot)
    cap.release()

    if not lefts:
        raise SystemExit('ゲーム画面を検出できなかった (芝の緑が見つからない)')

    x0, x1 = int(np.median(lefts)), int(np.median(rights))
    y0, y1 = int(np.median(tops)), int(np.median(bots))
    return Geometry(x0, y0, x1, y1, (x1 - x0 + 1) / SNES_W, (y1 - y0 + 1) / SNES_H)


# ---------------------------------------------------------------------------
# フレーム書き出し
# ---------------------------------------------------------------------------


def extract(video: str, geo: Geometry, out_dir: str, fps: int, start: float, dur: float) -> int:
    """ffmpeg でゲーム画面だけを切り出して連番PNGにする。

    ★必ずゲーム画面へクロップする★ 元動画は画面録画なので、ブラウザのタブ・ブックマーク・
    タスクバーなど**利用者の個人情報がフレーム全面に写り込んでいる**。分析に不要なだけでなく、
    そのまま扱うべきものではないので、この段階で確実に落とす。
    """
    os.makedirs(out_dir, exist_ok=True)
    cmd = [
        'ffmpeg', '-v', 'error', '-y',
        '-ss', str(start), '-t', str(dur), '-i', video,
        '-vf', f'crop={geo.width}:{geo.height}:{geo.x0}:{geo.y0},fps={fps}',
        os.path.join(out_dir, 'f%05d.png'),
    ]
    subprocess.run(cmd, check=True)
    return len([n for n in os.listdir(out_dir) if n.endswith('.png')])


# ---------------------------------------------------------------------------
# ボール追跡
# ---------------------------------------------------------------------------

# ボールはSNESで直径4ドット前後の白い点。動画pxでの想定面積を倍率から出す。
BALL_SNES_DIAMETER = 4.0


@dataclass
class Track:
    frame: int
    x: float  # SNESドット座標
    y: float
    area: float
    score: float


def _ball_candidates(bgr: np.ndarray, geo: Geometry, play_top: int, play_bottom: int):
    """
    白く小さい塊を列挙し、**周囲が芝の緑かどうか**で背番号バッジと区別する。

    初回実装は「白くて小さい」だけで拾っており、選手の頭上に出る**背番号バッジを
    ずっと追跡していた** (マーカー画像で発覚)。決め手になったのは背景で:
      - ボール      … 芝の上にあるので、周囲のリングはほぼ緑
      - 背番号バッジ … 黒い角丸の上の白文字なので、周囲のリングは暗い
      - カーソルの逆三角形 … マゼンタが隣接する
    さらにピッチのラインは細長いので形状で落とす。
    """
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h_, s_, v_ = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    white = ((v_ > 175) & (s_ < 70)).astype(np.uint8)
    green = (h_ > 35) & (h_ < 85) & (s_ > 60) & (v_ > 50)
    # プレー領域の外 (スコア表示・選手名バー) は白文字だらけなので最初から除外する
    white[:play_top, :] = 0
    white[play_bottom:, :] = 0
    white = cv2.morphologyEx(white, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))

    n, _, stats, cent = cv2.connectedComponentsWithStats(white, 8)
    exp_w = BALL_SNES_DIAMETER * geo.scale_x
    exp_h = BALL_SNES_DIAMETER * geo.scale_y
    exp_area = exp_w * exp_h
    hh, ww = white.shape
    out = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < exp_area * 0.12 or area > exp_area * 3.0:
            continue
        aspect = (w / geo.scale_x) / max(1e-6, h / geo.scale_y)
        if aspect < 0.45 or aspect > 2.4:
            continue
        fill = area / max(1.0, w * h)
        if fill < 0.42:
            continue

        # 周囲リングの緑率。ボールが選手の足元にある時は選手の体が入るので、
        # しきい値は緩めにして「暗い背景(バッジ)を落とす」ことを主目的にする。
        mx = int(round(w * 0.9)) + 2
        my = int(round(h * 0.9)) + 2
        x0, x1 = max(0, x - mx), min(ww, x + w + mx)
        y0, y1 = max(0, y - my), min(hh, y + h + my)
        ring = green[y0:y1, x0:x1].copy()
        ring[y - y0 : y - y0 + h, x - x0 : x - x0 + w] = False
        ring_total = (x1 - x0) * (y1 - y0) - w * h
        greenness = ring.sum() / max(1, ring_total)
        if greenness < 0.25:
            continue
        out.append((float(cent[i][0]), float(cent[i][1]), float(area), fill, float(greenness)))
    return out


def track_ball(
    video: str, geo: Geometry, start: float, dur: float, markers_dir: str | None
) -> list[Track]:
    """
    フレームごとに白い小塊を拾い、**移動の連続性**で1つに絞ってボールとして追跡する。

    単純な色+サイズだけでは、選手のソックス・短パン・ゴールネットも拾ってしまう。
    そこで「前フレームのボール位置から近いものを優先する」スコアを入れ、
    見失ったフレームは素直に欠測として残す (補間して埋めると速度の実測が嘘になる)。
    """
    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS)
    first = int(round(start * fps))
    count = int(round(dur * fps))
    cap.set(cv2.CAP_PROP_POS_FRAMES, first)

    play_top = int(SNES_H * 0.10 * geo.scale_y)  # スコア表示の下
    play_bottom = int(SNES_H * 0.86 * geo.scale_y)  # 選手名バーの上

    if markers_dir:
        os.makedirs(markers_dir, exist_ok=True)

    tracks: list[Track] = []
    prev: tuple[float, float] | None = None
    for k in range(count):
        ok, frame = cap.read()
        if not ok:
            break
        crop = frame[geo.y0 : geo.y1 + 1, geo.x0 : geo.x1 + 1]
        cands = _ball_candidates(crop, geo, play_top, play_bottom)

        best = None
        best_score = -1e9
        for cx, cy, area, fill, greenness in cands:
            # 芝の上にあるほど、詰まった塊であるほどボールらしい。
            score = greenness * 3.0 + fill * 1.5
            if prev is not None:
                # 1フレームで動ける距離には上限がある。遠すぎる候補は強く減点する。
                d = math.hypot((cx - prev[0]) / geo.scale_x, (cy - prev[1]) / geo.scale_y)
                score -= d * 0.30
            if score > best_score:
                best_score, best = score, (cx, cy, area)

        if best is not None:
            sx, sy = geo.to_snes(best[0] + geo.x0, best[1] + geo.y0)
            tracks.append(Track(first + k, sx, sy, best[2], best_score))
            prev = (best[0], best[1])
        else:
            prev = None

        if markers_dir and k % 3 == 0:
            vis = crop.copy()
            for cx, cy, _a, _f, _g in cands:
                cv2.circle(vis, (int(cx), int(cy)), 14, (0, 200, 255), 1)
            if best is not None:
                cv2.circle(vis, (int(best[0]), int(best[1])), 20, (0, 0, 255), 2)
                cv2.line(vis, (int(best[0]) - 26, int(best[1])), (int(best[0]) - 8, int(best[1])), (0, 0, 255), 2)
            cv2.imwrite(os.path.join(markers_dir, f'm{first + k:05d}.png'), vis)

    cap.release()
    return tracks


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('command', choices=['geometry', 'extract', 'track'])
    ap.add_argument('video')
    ap.add_argument('--fps', type=int, default=15)
    ap.add_argument('--start', type=float, default=0.0)
    ap.add_argument('--dur', type=float, default=10.0)
    ap.add_argument('--out', default='scratchpad/frames/seq')
    ap.add_argument('--markers', action='store_true')
    args = ap.parse_args()

    geo = detect_geometry(args.video)
    if args.command == 'geometry':
        info = asdict(geo)
        info.update(
            width=geo.width, height=geo.height, stretch=round(geo.stretch, 4),
            note='stretch>1 は横方向に引き伸ばされていることを意味する',
        )
        print(json.dumps(info, ensure_ascii=False, indent=2))
        return

    if args.command == 'extract':
        n = extract(args.video, geo, args.out, args.fps, args.start, args.dur)
        print(f'{n} frames -> {args.out}')
        return

    tracks = track_ball(
        args.video, geo, args.start, args.dur,
        'scratchpad/tracked' if args.markers else None,
    )
    total = int(round(args.dur * 30))
    print(f'検出 {len(tracks)}/{total} フレーム ({100*len(tracks)/max(1,total):.0f}%)')
    print(json.dumps([asdict(t) for t in tracks[:12]], ensure_ascii=False, indent=1))


if __name__ == '__main__':
    sys.exit(main())

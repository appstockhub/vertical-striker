"""
原作動画のボール追跡 (テンプレートマッチング版、23周目)。

前2回の失敗の記録 (同じ轍を踏まないため冒頭に書いておく):
  1回目「白い小塊」     → 選手の背番号バッジを追った
  2回目「+周囲の緑率」  → 選手のユニフォームの白ストライプを追った
  原因はどちらも「ボール = 白い塊」という誤った仮定。実物は白黒模様の球で、
  黒い模様が白領域を分断するため連結成分ベースでは拾えない。
  → 3回目 (本実装): 実フレームから切り出したテンプレートの正規化相関で探す。
     スプライトは見た目が固定なので、ヒューリスティクスより桁違いに安定する。

出力は JSONL (1行1フレーム)。画像はマーカー検証用のみ。
ボールの位置は「画面座標」と「カメラ移動を足し戻したワールド座標」の両方を持つ。
★カメラはボールを追従してスクロールするため、画面座標の速度は実速度ではない★
(ボールが等速で転がっていても画面上ではほぼ静止して見える)。カメラ移動は
ピッチ領域の位相相関で毎フレーム推定する。

使い方:
    python scripts/video/trackBall.py cut   <video> <frame> <x0> <y0> <x1> <y1>   # テンプレ切り出し
    python scripts/video/trackBall.py track <video> [--start S] [--dur D] [--step N] [--markers]
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from analyzeOriginal import Geometry, detect_geometry  # noqa: E402

# 浮き球(ブラー気味)と接地球(シャープ)の2枚。どちらも実フレームから切り出したもの。
TEMPLATE_PATHS = ('scratchpad/frames/ball-template.png', 'scratchpad/frames/ball-template2.png')
# しきい値は2段構え (ヒステリシス)。単一しきい値では「動いてブラーした本物(0.5台)」と
# 「スコアボード等の偽物(0.55前後)」が同じ帯に重なって分離できない (実測で確認)。
# → 新規獲得は高スコアのみ / 追跡継続中は前回位置の近傍に限り低スコアも受理する。
SCORE_ACQUIRE = 0.68   # 新規獲得 (全画面探索) に要求するスコア
SCORE_FOLLOW = 0.50    # 追跡継続 (近傍探索) に要求するスコア
FOLLOW_MAX_JUMP = 70.0 # 追跡継続とみなす、予測位置からの最大距離 (動画px)
# 見失っても直前位置を「古いアンカー」として保持する最大フレーム数。
# ドリブル中は選手にボールが隠れて数フレーム見えないのが常態なので、
# 毎回全画面を探し直すと遅いうえ誤獲得のリスクが増える。
STALE_MAX = 6
# 完全に見失った後、全画面探索を打つ間隔 (フレーム)。
REACQUIRE_EVERY = 10
# ボールサイズの揺れ (奥行き・浮きで見かけが変わる) を吸収するスケール群。
SCALES = (0.75, 0.9, 1.0)
# 探索領域: スコア表示(上部)と選手名バー(下部)は白黒文字の塊で偽ヒットの温床なので
# 最初から探索対象外にする (割合はクロップ後の高さ基準)。
SEARCH_Y_MIN_FRAC = 0.09
SEARCH_Y_MAX_FRAC = 0.86
# 直前位置の近傍だけを探す窓の半径 (動画px)。見失ったら全画面を探し直す。
LOCAL_RADIUS = 140


def load_templates() -> list[np.ndarray]:
    out = []
    for path in TEMPLATE_PATHS:
        t = cv2.imread(path)
        if t is None:
            raise SystemExit(f'テンプレートが無い: {path} (先に cut を実行)')
        # 周囲の芝を自動トリム (テンプレに緑が残っていると芝にもそこそこ反応してしまう)
        hsv = cv2.cvtColor(t, cv2.COLOR_BGR2HSV)
        green = (hsv[:, :, 0] > 35) & (hsv[:, :, 0] < 85) & (hsv[:, :, 1] > 60)
        ys, xs = np.where(~green)
        out.append(t[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1])
    return out


def match_ball(gray: np.ndarray, templates: list[np.ndarray], roi=None):
    """ROI内でマルチスケール・マルチテンプレのNCC。 (score, cx, cy) を返す。"""
    hh = gray.shape[0]
    y_min = int(hh * SEARCH_Y_MIN_FRAC)
    y_max = int(hh * SEARCH_Y_MAX_FRAC)
    if roi is not None:
        x0, y0, x1, y1 = roi
        y0, y1 = max(y0, y_min), min(y1, y_max)
    else:
        x0, y0, x1, y1 = 0, y_min, gray.shape[1], y_max
    area = gray[y0:y1, x0:x1]
    best = (0.0, -1.0, -1.0)
    for tmpl in templates:
        for s in SCALES:
            tw = max(8, int(tmpl.shape[1] * s))
            th = max(8, int(tmpl.shape[0] * s))
            t = cv2.resize(tmpl, (tw, th), interpolation=cv2.INTER_AREA)
            if area.shape[0] <= th or area.shape[1] <= tw:
                continue
            res = cv2.matchTemplate(area, t, cv2.TM_CCOEFF_NORMED)
            _, mx, _, loc = cv2.minMaxLoc(res)
            if mx > best[0]:
                best = (float(mx), x0 + loc[0] + tw / 2, y0 + loc[1] + th / 2)
    return best


def find_player_near(bgr: np.ndarray, bx: float, by: float):
    """
    ボール近傍の選手 (最近接の非緑クラスタ) の足元位置と身長を返す。無ければ None。
    ★身長は正規化の要★ 疑似3Dの奥行きで見かけサイズが変わるため、距離の指標は
    「その場に立つ選手の身長」で割って初めて自作ゲームと比較できる。
    """
    R = 110
    x0, y0 = max(0, int(bx - R)), max(0, int(by - R))
    x1, y1 = min(bgr.shape[1], int(bx + R)), min(bgr.shape[0], int(by + R))
    win = bgr[y0:y1, x0:x1]
    hsv = cv2.cvtColor(win, cv2.COLOR_BGR2HSV)
    h_, s_, v_ = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    green = (h_ > 35) & (h_ < 85) & (s_ > 60)
    line = (v_ > 170) & (s_ < 60)  # 白線・ボール自身
    mask = (~green & ~line & (v_ > 30)).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, stats, cent = cv2.connectedComponentsWithStats(mask, 8)
    best = None
    best_d = 1e9
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < 250 or w < 12 or h < 25 or h > 110:
            continue
        cx, cy = cent[i]
        d = ((cx + x0 - bx) ** 2 + (cy + y0 - by) ** 2) ** 0.5
        if d < best_d:
            best_d = d
            best = (x0 + x + w / 2, y0 + y + h, float(h), d)  # 足元中央, 身長, ボールとの距離
    return best


def estimate_camera_shift(prev_gray: np.ndarray, cur_gray: np.ndarray) -> tuple[float, float]:
    """ピッチ領域の位相相関でカメラの移動量 (dx, dy) を推定する (動画px)。"""
    h, w = cur_gray.shape
    # 中央帯 (スコア表示と選手名バーを避ける)。0.5x に縮めて高速化。
    a = cv2.resize(prev_gray[int(h * 0.18) : int(h * 0.82), :], None, fx=0.5, fy=0.5)
    b = cv2.resize(cur_gray[int(h * 0.18) : int(h * 0.82), :], None, fx=0.5, fy=0.5)
    (dx, dy), _resp = cv2.phaseCorrelate(a.astype(np.float64), b.astype(np.float64))
    return dx * 2.0, dy * 2.0


def cmd_track(video: str, start: float, dur: float, step: int, markers: bool) -> None:
    geo = detect_geometry(video)
    templates = [cv2.cvtColor(t, cv2.COLOR_BGR2GRAY) for t in load_templates()]

    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS)
    first = int(round(start * fps))
    count = int(round(dur * fps))
    cap.set(cv2.CAP_PROP_POS_FRAMES, first)

    out_path = f'scratchpad/frames/track_{first}_{count}.jsonl'
    marker_dir = 'scratchpad/tracked'
    if markers:
        os.makedirs(marker_dir, exist_ok=True)

    prev_gray = None
    prev_pos = None  # (x, y) 動画クロップ座標
    prev_vel = (0.0, 0.0)
    stale = 999  # 最後にヒットしてからのフレーム数 (最初は「完全に見失った」扱い)
    cam_x = cam_y = 0.0  # カメラの累積移動 (ワールド復元用)
    n_hit = 0
    with open(out_path, 'w', encoding='utf-8') as fh:
        for k in range(count):
            ok, frame = cap.read()
            if not ok:
                break
            if step > 1 and k % step:
                continue
            crop = frame[geo.y0 : geo.y1 + 1, geo.x0 : geo.x1 + 1]
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

            dx = dy = 0.0
            if prev_gray is not None:
                dx, dy = estimate_camera_shift(prev_gray, gray)
                cam_x += dx
                cam_y += dy
            prev_gray = gray

            hit = False
            score, bx, by = 0.0, -1.0, -1.0
            if prev_pos is not None and stale <= STALE_MAX:
                # 追跡継続: 予測位置 (前回位置 + 前回速度) の近傍を探す
                px = prev_pos[0] + prev_vel[0]
                py = prev_pos[1] + prev_vel[1]
                roi = (
                    max(0, int(px - LOCAL_RADIUS)), max(0, int(py - LOCAL_RADIUS)),
                    min(gray.shape[1], int(px + LOCAL_RADIUS)), min(gray.shape[0], int(py + LOCAL_RADIUS)),
                )
                score, bx, by = match_ball(gray, templates, roi)
                jump = ((bx - px) ** 2 + (by - py) ** 2) ** 0.5
                hit = score >= SCORE_FOLLOW and jump <= FOLLOW_MAX_JUMP
            if not hit and (stale > STALE_MAX) and (k % REACQUIRE_EVERY == 0):
                # 完全に見失っている: 間欠的に全画面から高スコアのみで再獲得
                score, bx, by = match_ball(gray, templates, None)
                hit = score >= SCORE_ACQUIRE
            if hit:
                prev_vel = (bx - prev_pos[0], by - prev_pos[1]) if (prev_pos and stale == 0) else (0.0, 0.0)
                prev_pos = (bx, by)
                stale = 0
                n_hit += 1
            else:
                stale += 1
                prev_vel = (0.0, 0.0)

            sx, sy = geo.to_snes(bx + geo.x0, by + geo.y0) if hit else (None, None)
            player = find_player_near(crop, bx, by) if hit else None
            rec = {
                'f': first + k,
                'hit': hit,
                'score': round(score, 3),
                # 画面座標 (SNESドット) と、カメラ累積移動を足し戻したワールド座標
                'sx': None if sx is None else round(sx, 2),
                'sy': None if sy is None else round(sy, 2),
                'wx': None if sx is None else round(sx + cam_x / geo.scale_x, 2),
                'wy': None if sy is None else round(sy + cam_y / geo.scale_y, 2),
                'cam_dx': round(dx / geo.scale_x, 3),
                'cam_dy': round(dy / geo.scale_y, 3),
                # 最近接選手: 足元(SNESドット)・見かけ身長(ドット)・ボールとの生距離
                'px': None if not player else round(geo.to_snes(player[0] + geo.x0, 0)[0], 2),
                'py': None if not player else round(geo.to_snes(0, player[1] + geo.y0)[1], 2),
                'ph': None if not player else round(player[2] / geo.scale_y, 2),
            }
            fh.write(json.dumps(rec) + '\n')

            if markers and k % 3 == 0:
                vis = crop.copy()
                if hit:
                    cv2.circle(vis, (int(bx), int(by)), 24, (0, 0, 255), 2)
                    cv2.putText(vis, f'{score:.2f}', (int(bx) + 26, int(by)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
                cv2.imwrite(os.path.join(marker_dir, f'm{first + k:05d}.png'), vis)

    cap.release()
    print(f'検出 {n_hit}/{count} ({100 * n_hit / max(1, count):.0f}%) -> {out_path}')


def cmd_cut(video: str, frame: int, x0: int, y0: int, x1: int, y1: int) -> None:
    cap = cv2.VideoCapture(video)
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame)
    ok, f = cap.read()
    cap.release()
    if not ok:
        raise SystemExit('frame read failed')
    os.makedirs(os.path.dirname(TEMPLATE_PATH), exist_ok=True)
    cv2.imwrite(TEMPLATE_PATH, f[y0:y1, x0:x1])
    print(f'template <- frame {frame} [{x0},{y0}..{x1},{y1}]')


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    c = sub.add_parser('cut')
    for a in ('video',):
        c.add_argument(a)
    for a in ('frame', 'x0', 'y0', 'x1', 'y1'):
        c.add_argument(a, type=int)
    t = sub.add_parser('track')
    t.add_argument('video')
    t.add_argument('--start', type=float, default=0.0)
    t.add_argument('--dur', type=float, default=10.0)
    t.add_argument('--step', type=int, default=1)
    t.add_argument('--markers', action='store_true')
    args = ap.parse_args()
    if args.cmd == 'cut':
        cmd_cut(args.video, args.frame, args.x0, args.y0, args.x1, args.y1)
    else:
        cmd_track(args.video, args.start, args.dur, args.step, args.markers)


if __name__ == '__main__':
    main()

"""
ボール追跡結果 (JSONL) から原作の挙動指標を算出する (23周目)。

単位の方針 (docs/motion-reference.md と対):
  - 距離は「その場に写っている選手の見かけ身長」で正規化した無次元値 [身長]
    (疑似3Dの奥行きで見かけサイズが変わるため、隣に立つ選手の身長で割ることで
     奥行きの影響を局所的に打ち消す。解像度の違う自作ゲームとも比較可能になる)
  - 速度は [身長/秒]、摩擦は [1tickあたりの残存率] (60fps tick 換算)
  - 時間は [秒] と [60fps tick] を併記

検出できないフレーム (選手に隠れる等) は欠測のまま扱い、補間しない。
補間すると速度・摩擦の実測が創作値になってしまう。

使い方:
    python scripts/video/metrics.py scratchpad/frames/track_0_5520.jsonl
"""

from __future__ import annotations

import json
import math
import sys

import numpy as np

VIDEO_FPS = 30.0  # 't' フィールドが無い旧JSONL用のフォールバック
SIM_FPS = 60.0

# 正規化に使う選手身長として信用する範囲 [SNESドット]。
# 実測の分布は 9〜32 に広がるが、下側は部分検出 (脚だけ・胴だけ)、上側はクラスタ結合。
# どちらも正規化を大きく歪めるので、全身が取れているとみなせる帯だけを使う
# (SNESの定番スプライト 24 ドット ± 奥行きの見かけ変化)。
PH_MIN, PH_MAX = 18.0, 30.0


def ph_ok(r) -> bool:
    return bool(r.get('ph')) and PH_MIN <= r['ph'] <= PH_MAX


def load(path: str):
    recs = [json.loads(l) for l in open(path, encoding='utf-8')]
    # 24周目: VFR録画対応。重複フレーム (dup=true) は新情報ゼロなので欠測扱いで落とす。
    # 't' (秒) が無い旧形式は f/VIDEO_FPS で補って互換を保つ。
    out = []
    for r in recs:
        if r.get('dup') or not r['hit']:
            continue
        if 't' not in r:
            r['t'] = r['f'] / VIDEO_FPS
        out.append(r)
    return out


MAX_GAP_SEC = 0.10  # 欠測がこの秒数以内なら同一区間とみなす (旧: 2フレーム@30fps ≈ 0.067s)


def contiguous_runs(hits, max_gap_sec=MAX_GAP_SEC):
    """時間が連続している区間 (欠測 max_gap_sec まで許容) に分割する。"""
    runs = []
    cur = [hits[0]]
    for r in hits[1:]:
        if r['t'] - cur[-1]['t'] <= max_gap_sec:
            cur.append(r)
        else:
            if len(cur) >= 3:
                runs.append(cur)
            cur = [r]
    if len(cur) >= 3:
        runs.append(cur)
    return runs


def world_speeds(run):
    """区間内の各フレームの速度 [ドット/(1/30秒)] (ワールド座標、カメラ補正済み)。

    24周目: VFR対応のため dt はタイムスタンプ差から取る。単位を旧実装の
    「ドット/30fpsフレーム」に固定することで、後段のしきい値 (2.0や0.8など、
    30fps録画で調律した値) をそのまま使い続けられる。
    """
    out = []
    for a, b in zip(run, run[1:]):
        dt = b['t'] - a['t']
        if dt <= 0 or a['wx'] is None or b['wx'] is None:
            out.append(None)
            continue
        d = math.hypot(b['wx'] - a['wx'], b['wy'] - a['wy']) / (dt * 30.0)
        out.append(d)
    return out


def analyze(path: str) -> dict:
    hits = load(path)
    runs = contiguous_runs(hits)

    # --- 1. ドリブル: ボールと足元の距離 + タッチ周期 -----------------------
    #   「選手が身長1.2倍以内に居るフレームが8割以上続く区間」を保持区間とみなす
    gaps = []          # 正規化距離 [身長]
    touch_periods = [] # タッチ間隔 [秒] (ボール速度の山→山)
    for run in runs:
        near = [r for r in run if ph_ok(r) and r['px'] is not None]
        if len(near) < 6:
            continue
        g = []
        for r in near:
            d = math.hypot(r['sx'] - r['px'], r['sy'] - r['py'])
            g.append(d / r['ph'])
        g = np.array(g)
        # 保持区間らしさ: 中央値が身長1.2以内
        if np.median(g) > 1.2:
            continue
        gaps.extend(g[g < 2.0].tolist())

        # タッチ周期: 速度の局所ピーク間隔
        sp = world_speeds(near)
        sp = np.array([s if s is not None else np.nan for s in sp])
        if len(sp) < 6:
            continue
        peaks = []
        for i in range(1, len(sp) - 1):
            if not (np.isnan(sp[i - 1]) or np.isnan(sp[i]) or np.isnan(sp[i + 1])):
                if sp[i] > sp[i - 1] and sp[i] >= sp[i + 1] and sp[i] > 0.8:
                    peaks.append(i)
        for a, b in zip(peaks, peaks[1:]):
            dt = near[b]['t'] - near[a]['t']
            if 0.1 < dt < 1.5:
                touch_periods.append(dt)

    # --- 2. キック: 初速 [身長/秒] と、静止→最高速の所要フレーム -----------
    # ★遠近の注意★ 画面の縦方向は地面の距離が圧縮されて写る (俯角が浅いため)。
    # 横方向は圧縮されない。そこで「横成分が支配的なキック」を別枠で出し、
    # そちらを地面上の実速度の最良推定とする。
    kick_speeds = []
    kick_speeds_lateral = []
    accel_frames = []
    for run in runs:
        sp = world_speeds(run)
        for i in range(1, len(sp)):
            a, b = sp[i - 1], sp[i]
            if a is None or b is None:
                continue
            # 速度が1フレームで2ドット/フレーム以上跳ねた = キック
            if b - a > 2.0 and b > 3.0:
                ph = run[i]['ph'] if ph_ok(run[i]) else (run[i - 1]['ph'] if ph_ok(run[i - 1]) else None)
                if ph:
                    v = b * 30.0 / ph  # [身長/秒] (world_speedsはドット/(1/30秒)単位)
                    kick_speeds.append(v)
                    dx = abs(run[i + 1]['wx'] - run[i]['wx']) if i + 1 < len(run) else 0
                    dy = abs(run[i + 1]['wy'] - run[i]['wy']) if i + 1 < len(run) else 1
                    if dx > 2 * dy:
                        kick_speeds_lateral.append(v)
                # 立ち上がりに何秒かかったか (a がすでに動いていたら1サンプル分)
                j = i - 1
                while j > 0 and sp[j] is not None and sp[j] > 0.5:
                    j -= 1
                accel_frames.append(run[i]['t'] - run[j]['t'])

    # --- 2b. ドリブル速度 (=保持者の走速の代理) [身長/秒] -------------------
    carry_speeds = []
    for run in runs:
        near = [r for r in run if ph_ok(r) and r['px'] is not None]
        if len(near) < 8:
            continue
        g = np.array([math.hypot(r['sx'] - r['px'], r['sy'] - r['py']) / r['ph'] for r in near])
        if np.median(g) > 1.2:
            continue
        sp = world_speeds(near)
        for i, s_ in enumerate(sp):
            if s_ is not None and 0.3 < s_ < 4.0 and ph_ok(near[i]):
                carry_speeds.append(s_ * 30.0 / near[i]['ph'])

    # --- 3. 摩擦: 自由転がり区間の指数減衰フィット --------------------------
    frictions = []
    for run in runs:
        # 選手が近くに居ない (px が None か、距離が身長1.5超) 連続フレーム
        sp = world_speeds(run)
        seq = []
        for i, s in enumerate(sp):
            far = run[i]['px'] is None or (
                run[i]['ph']
                and math.hypot(run[i]['sx'] - run[i]['px'], run[i]['sy'] - run[i]['py']) / run[i]['ph'] > 1.5
            )
            if s is not None and far and 0.4 < s < 8.0:
                seq.append((s, run[i]['t']))
            else:
                if len(seq) >= 5:
                    # 各ペアの減衰率を「経過秒あたり」→ 60fps tickあたりへ正規化 (VFR対応)
                    ratios = []
                    for k in range(len(seq) - 1):
                        s0, t0 = seq[k]
                        s1, t1 = seq[k + 1]
                        dt = t1 - t0
                        if s0 > 0.6 and dt > 0:
                            r = s1 / s0
                            if 0.7 < r < 1.1:
                                ratios.append(r ** (1.0 / (dt * SIM_FPS)))
                    if len(ratios) >= 3:
                        frictions.append(float(np.median(ratios)))
                seq = []

    # --- 4. 蹴り出しドリブル: 保持中に距離が大きく開いて戻るパターン --------
    pushes = []   # 蹴り出しの最大距離 [身長]
    push_periods = []
    for run in runs:
        near = [r for r in run if ph_ok(r) and r['px'] is not None]
        if len(near) < 10:
            continue
        g = np.array([math.hypot(r['sx'] - r['px'], r['sy'] - r['py']) / r['ph'] for r in near])
        if np.median(g) > 1.2:
            continue
        # 0.6身長を超えて開き、その後0.4身長以下へ戻る山を数える
        above = g > 0.6
        i = 0
        while i < len(g):
            if above[i]:
                j = i
                while j < len(g) and g[j] > 0.4:
                    j += 1
                if j < len(g):  # 戻ってきた
                    pushes.append(float(g[i:j].max()))
                    push_periods.append(near[min(j, len(near) - 1)]['t'] - near[i]['t'])
                i = j + 1
            else:
                i += 1

    def stats(a):
        if not a:
            return None
        a = np.array(a)
        return {
            'n': int(len(a)),
            'p25': round(float(np.percentile(a, 25)), 3),
            'med': round(float(np.median(a)), 3),
            'p75': round(float(np.percentile(a, 75)), 3),
            'mean': round(float(a.mean()), 3),
        }

    return {
        'frames_hit': len(hits),
        'runs': len(runs),
        'dribble_gap_heights': stats(gaps),
        'touch_period_sec': stats(touch_periods),
        'kick_speed_heights_per_sec': stats(kick_speeds),
        'kick_speed_lateral_heights_per_sec': stats(kick_speeds_lateral),
        'carry_speed_heights_per_sec': stats(carry_speeds),
        'kick_accel_sec': stats(accel_frames),
        'friction_per_60fps_tick': stats(frictions),
        'kickout_push_heights': stats([p for p in pushes if p > 0.7]),
        'kickout_period_sec': stats([t for p, t in zip(pushes, push_periods) if p > 0.7]),
    }


if __name__ == '__main__':
    print(json.dumps(analyze(sys.argv[1]), ensure_ascii=False, indent=2))

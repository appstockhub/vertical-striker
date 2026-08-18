/**
 * ★台帳L-05 (24周目-6)★ GKのセーブポーズの計算部。★描画専用の純関数★
 *
 * 原作のGKは専用のポーズ遷移を持つ (docs/visual-behavior-audit.md 2-5節):
 *   - ダイブ: 水平に倒れる (vf3829)
 *   - 倒れ込みの維持: 約0.5秒 (vf3831-3845)
 *   - 起き上がり: 膝立ちを挟んで復帰 (vf3849-3851)
 * 当実装のGKスプライトはフィールド選手と同じ立ち絵しか無いため、スライディングの
 * 可視化 (PitchScene.renderPlayers) と同じ「足元原点の倒し込み」でダイブを表現する。
 *
 * 入力は GameState.lastEvent (gkCatch / gkPunch、atFrame付き) と現在フレームのみ =
 * 状態の純関数なので、リプレイでも同じ見え方になる (決定論の描画版)。
 */

/** ダイブ姿勢の時間割り (tick)。原作実測: 倒れ維持 約0.5秒 → 起き上がり。 */
const DIVE_FLAT_TICKS = 30; // 水平に倒れている時間 (0.5秒)
const DIVE_RECOVER_TICKS = 14; // 膝立ち〜復帰

export interface GkPose {
  /** スプライトの傾き (度)。0 = 直立。 */
  readonly angle: number;
  /** ポーズ適用中か (falseなら通常の走行アニメに任せる)。 */
  readonly active: boolean;
}

/**
 * @param framesSinceSave セーブイベント (gkCatch/gkPunch) からの経過tick。負なら未発生。
 * @param kind イベント種別。キャッチは倒れず「その場で確保」(原作のGK保持ポーズに相当)、
 *   パンチは水平ダイブ→倒れ維持→起き上がり。
 * @param tiltSign 倒す向き (+1=右、-1=左)。ボールが来た側へ倒す。
 */
export function computeGkPose(
  framesSinceSave: number,
  kind: 'gkCatch' | 'gkPunch',
  tiltSign: 1 | -1,
): GkPose {
  if (framesSinceSave < 0) return { angle: 0, active: false };
  if (kind === 'gkCatch') {
    // キャッチは倒れない (確保して立つ)。gkHold中のボール描画が「持っている」を表す。
    return { angle: 0, active: false };
  }
  if (framesSinceSave < DIVE_FLAT_TICKS) {
    return { angle: tiltSign * 78, active: true }; // 水平ダイブ〜倒れ込み維持
  }
  if (framesSinceSave < DIVE_FLAT_TICKS + DIVE_RECOVER_TICKS) {
    return { angle: tiltSign * 34, active: true }; // 膝立ち (起き上がりかけ)
  }
  return { angle: 0, active: false };
}

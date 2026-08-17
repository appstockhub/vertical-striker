import { fixedAdd, fixedMul, fixedSub, toFixed, vSub, ZERO_FIXED } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import type { RngState } from '../core/rng';
import { nextRangeInt } from '../core/rng';
import { Direction8 } from '../input/types';
import { PITCH_HEIGHT } from '../config/pitch';
import { attackingIsUpward, opponentOf, PLAYERS_PER_TEAM, type Half } from './formations';
import type { Difficulty, PlayerState } from './state';
import { quantizeToDirection8 } from './steering';
import { selectPassTarget } from './cursor';
import { GOAL_CENTER_X_FIXED, GOAL_HALF_WIDTH_FIXED } from './goalkeeperConstants';
import { DIFFICULTY_TIERS } from './difficultyConstants';
import { DRIBBLE_CONTACT_RADIUS_SQ_FIXED } from './ballConstants';

export type CpuAttackAction = 'shoot' | 'pass' | 'dribble';

export interface CpuAttackDecision {
  readonly action: CpuAttackAction;
  /** このtickの実効入力方向 (量子化済み)。shoot/passではキック方向としても使う。 */
  readonly direction: Direction8;
  /** action==='pass' の時のみ、受け手の players[] index。 */
  readonly passTargetIndex: number | null;
  /** シュート照準ノイズでRNGを消費した場合、更新後のstateを返す (消費しなければstateをそのまま返す)。 */
  readonly rngState: RngState;
}

// 0だと目標に完全一致した際にquantizeToDirection8がUpへフォールバックしてしまう
// (goalkeeperAI.tsで踏んだ既知の回帰と同じ理由)。ごく小さい正の値にする。
const CPU_STEER_DEADZONE_SQ: Fixed = fixedMul(toFixed(0.5), toFixed(0.5));

// ゴールポストの際ではなく、ゴール幅のこの割合だけ内側を狙う (幾何誤差でwide判定になるのを避ける仮値)。
const NEAR_POST_INSET_RATIO: Fixed = toFixed(0.85);

// 相互パスの永久ピンポン防止 (Phase 4 バグ修正、観戦シミュレーターの振動検出から遡って発覚):
// 同じライン深度で向かい合った2人のCPUが互いを受け手に選び、2人の間でボールが毎tick
// 往復して試合が180tick以上完全停止するデッドロックがあった。
// 対策は「直前に自分へボールを渡した選手 (prevTouchPlayerIndex) をパス先から除外する」のみ。
// A→B→A の即時往復が構造的に不可能になる一方、パスの頻度・方向の分布は変えない。
// 注意: 「前進パスのみ許可」等のパス頻度を下げる対策も試したが、CPUがドリブル主体になると
// ボールを失う機会 (パスの移動中のインターセプト) が消えて攻撃転換が強くなりすぎ、
// 人間側が陣地を回復できずシュート数が激減するバランス崩れが起きた (観戦シミュレーターで実測)。

/**
 * Team B(CPU)のボール保持者1人ぶんの攻撃判断。CLAUDE.mdの「シュート・パス・崩しの意思決定」に
 * 対応する優先順位: 1.シュート圏内なら遠いポストを狙って強キック 2.ダメならカーソルパスと
 * 同じ前方コーン判定でパス 3.どちらも無ければ相手ゴール方向へドリブル。
 *
 * 決定論の注意: 判断材料は players (このtick開始時点のスナップショット) のみに依存する。
 * RNGを消費するのは「シュート時の照準ノイズ」のみ (難易度が低いほどノイズ幅が広い、
 * Phase 3で初めてrngStateを実消費する箇所)。呼び出し側は必ず戻り値のrngStateを
 * GameStateへ書き戻すこと (忘れるとノイズが決定論的に固定されてしまう)。
 */
export function decideCpuAttack(
  carrierIndex: number,
  players: readonly PlayerState[],
  half: Half,
  difficulty: Difficulty,
  rngState: RngState,
  prevTouchPlayerIndex: number | null = null,
  ballPos: Vec2Fixed | null = null,
): CpuAttackDecision {
  const carrier = players[carrierIndex];
  if (!carrier) {
    return { action: 'dribble', direction: Direction8.None, passTargetIndex: null, rngState };
  }

  // ★24周目サイクル②★ ボールが「足元」(接触半径7px) に無いなら、まず回収に向かう
  // (キック判断もしない)。touch-priority (20px) はプレー権であって足元保持ではない。
  // 旧サーボモデルはボールを常に9px先へ吸着させていたため「holder=足元にある」の仮定が
  // 成立していたが、離散タッチ化でボールが最大20px先を転がるようになると、この仮定のまま
  // 「ゴールへ向かって歩く」ことが追跡権AIの「ボールへ向かう」と2tick周期で衝突し、
  // フリーボールの20px手前で3600tick静止するデッドロックを起こした (実測)。
  //
  // 回収の境界は必ず DRIBBLE_CONTACT_RADIUS (タッチが発火する距離) に一致させること。
  // 初版は9px(接触7pxの少し外)にしていたが、7〜9pxに「触れられないのに攻撃方向へ歩き出す」
  // デッドリングが生まれ、ボールが進行方向に無い局面でキャリアが輪の上を毎tick往復する
  // 系統的な振動 (全セル×全シードで osc=[16] 等) を起こした。
  // さらにタッチのクールダウン中は接触していても蹴り足が出ないため、ボールの上で
  // 静止して次のタッチを待つ (これも往復の芽を摘む)。
  if (ballPos) {
    const toBall = vSub(ballPos, carrier.pos);
    const ballDistSq = fixedAdd(fixedMul(toBall.x, toBall.x), fixedMul(toBall.y, toBall.y)) as number;
    if (ballDistSq > (DRIBBLE_CONTACT_RADIUS_SQ_FIXED as number)) {
      const direction = quantizeToDirection8(toBall, CPU_STEER_DEADZONE_SQ);
      return { action: 'dribble', direction, passTargetIndex: null, rngState };
    }
    if ((carrier.dribbleTouchCooldown ?? 0) > 0) {
      return { action: 'dribble', direction: Direction8.None, passTargetIndex: null, rngState };
    }
  }

  const attacksUp = attackingIsUpward(carrier.team, half);
  const goalY: Fixed = attacksUp ? ZERO_FIXED : (toFixed(PITCH_HEIGHT) as Fixed);
  const goalPos: Vec2Fixed = { x: GOAL_CENTER_X_FIXED, y: goalY };

  const toGoal = vSub(goalPos, carrier.pos);
  const distSq = fixedAdd(fixedMul(toGoal.x, toGoal.x), fixedMul(toGoal.y, toGoal.y));
  const lateral = Math.abs(fixedSub(carrier.pos.x, GOAL_CENTER_X_FIXED) as number);

  const tier = DIFFICULTY_TIERS[difficulty];
  const inShootRange = (distSq as number) <= (tier.shootRangeSq as number);
  const inShootLateral = lateral <= (tier.shootMaxLateral as number);

  if (inShootRange && inShootLateral) {
    const opponentTeam = opponentOf(carrier.team);
    const keeper = players[opponentTeam * PLAYERS_PER_TEAM];
    const nearPostInset = fixedMul(GOAL_HALF_WIDTH_FIXED, NEAR_POST_INSET_RATIO);
    const aimLeft = fixedSub(GOAL_CENTER_X_FIXED, nearPostInset);
    const aimRight = fixedAdd(GOAL_CENTER_X_FIXED, nearPostInset);
    // キーパーの現在x位置から遠い方のポストを狙う (CLAUDE.mdの「ゴール隅を狙う」セオリー)。
    const keeperOnLeft = !keeper || (keeper.pos.x as number) <= (GOAL_CENTER_X_FIXED as number);
    let targetX: Fixed = keeperOnLeft ? aimRight : aimLeft;

    let nextRngState = rngState;
    if (tier.aimNoiseRange > 0) {
      const [noise, next] = nextRangeInt(rngState, -tier.aimNoiseRange, tier.aimNoiseRange + 1);
      nextRngState = next;
      targetX = fixedAdd(targetX, toFixed(noise));
    }

    const direction = quantizeToDirection8({ x: fixedSub(targetX, carrier.pos.x), y: fixedSub(goalY, carrier.pos.y) }, CPU_STEER_DEADZONE_SQ);
    return { action: 'shoot', direction, passTargetIndex: null, rngState: nextRngState };
  }

  // 直前に自分へボールを渡した選手は受け手候補から除外する (相互パスのピンポン防止、上のコメント参照)。
  const passTarget = selectPassTarget(carrierIndex, players, prevTouchPlayerIndex);
  if (passTarget !== null) {
    const receiver = players[passTarget];
    if (receiver) {
      const direction = quantizeToDirection8(vSub(receiver.pos, carrier.pos), CPU_STEER_DEADZONE_SQ);
      return { action: 'pass', direction, passTargetIndex: passTarget, rngState };
    }
  }

  const direction = quantizeToDirection8(toGoal, CPU_STEER_DEADZONE_SQ);
  return { action: 'dribble', direction, passTargetIndex: null, rngState };
}

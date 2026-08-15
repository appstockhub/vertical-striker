import { distSqFixed, toFixed, toFloat, vSub, fixedMul } from '../../src/core/fixed';
import type { Fixed } from '../../src/core/types';
import { createRng, nextRangeInt, type RngState } from '../../src/core/rng';
import { createInitialState, TeamId, type Difficulty, type GameState } from '../../src/sim/state';
import { simulate, type Inputs } from '../../src/sim/update';
import { Direction8, emptyButtonState, type ButtonState } from '../../src/input/types';
import { attackingIsUpward, depthFromOwnGoal, opponentOf, type Half } from '../../src/sim/formations';
import { FULL_MATCH_DURATION_FRAMES, getHalf } from '../../src/sim/matchClock';
import { findTouchPriorityPlayer } from '../../src/sim/ballTouch';
import { selectPassTarget } from '../../src/sim/cursor';
import { computeMarkAssignments } from '../../src/sim/marking';
import { quantizeToDirection8 } from '../../src/sim/steering';
import { DIRECTION_VECTORS } from '../../src/sim/constants';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../../src/config/pitch';

/**
 * 観戦シミュレーター (Phase 3、実プレイ相当の自律検証基盤)。
 *
 * simulate() をフルマッチ分回し、「サッカーとして正常か」を判定するための統計と
 * イベントログを出力する。人間入力は4パターンの決定論的スクリプト (mulberry32、
 * Math.random不使用) で模擬する。soccerSanity.test.ts がこの統計に対して
 * 正常性基準を assert し、回帰検知に使う。matchReport.test.ts は同じ統計を
 * 人間が読むためのサマリとして出力する。
 *
 * 統計の設計メモ:
 * - シュート検出: ボール速度が1tickでしきい値(6.5px/tick)を跨いで増加=キック。
 *   ロングドリブルの蹴り出し(6.0)を除外しつつ、強キック(9.0)・CPUシュート(9.0)・
 *   チャージ強キック(最大溜めでも6.3)を拾う値。その中で「相手ゴールライン方向へ向かい、
 *   ゴールライン600px以内から放たれ、直線外挿でゴール中心±100px以内を通る」ものをシュート、
 *   ±44px(ゴール半幅40+マージン)以内なら枠内とする。
 * - 団子度: 毎tickボール150px以内の選手数(22人中)の平均。
 * - 振動検出: 90tickの非重複窓で、移動総量>120pxなのに滞在範囲(バウンディングボックス)が
 *   24px四方未満の選手=「狭い範囲で動き続けている」選手を検出する。
 * - シュート後の陣形急変: シュートから90tick後のチーム重心深度の後退量。リスタート/得点/
 *   相手への支配移転があった窓は除外する(それらによる後退は正当なため)。
 * - プレス距離: 相手が保持中かつボールが自陣から見て敵陣側1/3にある時の、
 *   自チームフィールドプレイヤーの最小ボール距離の平均。前線プレスの有無を測る。
 */

export type HumanPattern = 'aggressive' | 'passHeavy' | 'idle' | 'defensive';

export interface TeamMatchStats {
  shots: number;
  shotsOnTarget: number;
  goals: number;
  /** 相手ペナルティエリア(ゴールライン150px×中央±130px)へのボール侵入回数。 */
  boxEntries: number;
  /** 支配率 (lastTouchTeamベース、どちらかが保持していたtickのうちの割合、%)。 */
  possessionPct: number;
  /** シュートから90tick後のチーム重心(アウトフィールド)の後退量平均 (px)。 */
  postShotRetreatAvgPx: number;
  postShotRetreatSamples: number;
  /** 相手保持中・ボールが敵陣側1/3にある時の、自チーム最寄り選手のボール距離平均 (px)。 */
  pressDistanceAvgPx: number;
  pressSamples: number;
  /**
   * サポートラン測定: 自チームがラインベース保持中(linePossessionTeam)かつボールが
   * 自陣側1/3を出ている時の、「ボール深度+50pxより前方にいる非GK・非キャリア選手数」の平均。
   * ライン押し引きだけでは全員がボールの後方(150px standoff)に留まるため、この値は
   * サポートラン実装前は~0になる — 新挙動を分離して測定できる。
   */
  supportRunnersAvgAhead: number;
  supportSamples: number;
  /** マーク測定: このチームが守備側の時の、マーカー↔マーク対象の平均距離 (px)。 */
  markDistanceAvgPx: number;
  markSamples: number;
  /** 守備側だったtickのうちマーク割り当てが1件以上あったtickの割合 (レポート用、ゲート無し)。 */
  markedTicksShare: number;
  /** 第2層 (挙動仕様書 docs/soccer-behavior-spec.md に基づく詳細メトリクス)。 */
  behavior: BehaviorMetrics;
}

/**
 * 挙動仕様書 (docs/soccer-behavior-spec.md) の各項目を定量化した第2層メトリクス。
 * 既存の10基準 (soccerSanity.test.ts) が「サッカーとして崩壊していないか」の粗い網なのに対し、
 * こちらは「あるべき動きに近いか」を測る細かい網。tests/sim/behaviorSpec.test.ts が判定する。
 */
export interface BehaviorMetrics {
  /**
   * 仕様P1 (ボールサイドシフト): このチームが守備側の時の、非GK重心Xの「ボール側への寄り」。
   * mean( sign(ballX-中央) * (重心X-中央) )、ボールが中央から60px以上離れているtickのみ。
   * 正=ボールサイドへ寄っている、0近傍=横シフトなし、負=逆サイドへ寄る。
   */
  defXShiftTowardBallAvgPx: number;
  defXShiftSamples: number;
  /**
   * 仕様1.2 (近接サポート/三角形): このチームが保持側で、キャリア(touch priority)がいる時の、
   * キャリアから120〜250px圏内にいる味方(非GK)数の平均。パスの選択肢の数に相当。
   */
  nearSupportAvg: number;
  nearSupportSamples: number;
  /**
   * 仕様1.3 (レストディフェンス): このチームが保持側でボールが敵陣側1/3にある時の、
   * ボール深度より300px以上後方にいる非GK味方数の平均。カウンター保険の人数。
   */
  restDefendersAvg: number;
  restDefendersSamples: number;
  /**
   * 仕様2.2 (ゴール側の遮蔽): このチームが守備側の時の、ボールより自ゴール側(深度が浅い側)に
   * いる非GK味方数の平均。守備ブロックの基本量。
   */
  goalSideDefendersAvg: number;
  goalSideDefendersSamples: number;
  /**
   * 仕様4 (リスタート保護): このチームのリスタート(スローイン/ゴールキック/コーナー)のうち、
   * 再開後最初のタッチを自チームが取れた割合 (0..1)。「ゴールキックなのに奪われる」の直接測定。
   */
  restartFirstTouchRate: number;
  restartCount: number;
  /**
   * 仕様P3 (縦レーン過密の禁止): このチームが保持側の時、ピッチを4レーン(横120px)に分けた際の
   * 最混雑レーンの非GK人数の平均。理想は3以下 (縦レーン最大2人+移動中の重なり許容)。
   */
  laneMaxOccupancyAvg: number;
  laneMaxOccupancySamples: number;
}

export interface PlayerDistribution {
  meanX: number;
  meanY: number;
  /** 平均位置からの散らばり (px、平方根平均二乗偏差)。 */
  spread: number;
  /** 自陣側1/3 / 中盤1/3 / 敵陣側1/3 に居た時間の割合 (0..1)。 */
  thirds: [number, number, number];
}

export interface MatchStats {
  pattern: HumanPattern;
  seed: number;
  scriptSeed: number;
  ticks: number;
  finalScore: readonly [number, number];
  teams: [TeamMatchStats, TeamMatchStats];
  /** ボール150px以内の選手数の平均と最大。 */
  dangoAvg: number;
  dangoMax: number;
  /** 振動検出に引っかかった選手のindex一覧 (重複なし)。 */
  oscillatingPlayers: number[];
  players: PlayerDistribution[];
  /** 主要イベントのログ (先頭200件まで)。 */
  events: string[];
}

const KICK_DETECT_SPEED = 6.5; // px/tick
const SHOT_MAX_RANGE = 600; // ゴールラインからの距離
const SHOT_AIM_HALF_WIDTH = 100;
const ON_TARGET_HALF_WIDTH = 44;
const BOX_DEPTH = 150;
const BOX_HALF_WIDTH = 130;
const DANGO_RADIUS_PX = 150;
const OSC_WINDOW = 90;
const OSC_MIN_PATH = 120;
const OSC_MAX_BBOX = 24;
const RETREAT_WINDOW = 90;
const PRESS_DEPTH_THRESHOLD = (PITCH_HEIGHT / 3) * 2; // 自陣ゴールからこの深さより先=敵陣側1/3
const GOAL_CENTER_X = PITCH_WIDTH / 2;
/** サポートラン測定: ボール深度からこのpx以上前方にいる選手を「前方の受け手」と数える。 */
const SUPPORT_AHEAD_METRIC_PX = 50;
/** サポートラン測定: ボールがこの深度(自陣側1/3)を出ている時だけサンプルする。 */
const SUPPORT_DEPTH_THRESHOLD = PITCH_HEIGHT / 3;

// --- 第2層 (BehaviorMetrics) 用の定数。しきい値の根拠は docs/soccer-behavior-spec.md 参照 ---
/** ボールサイドシフト測定: ボールが中央からこのpx以上離れているtickのみサンプルする。 */
const XSHIFT_BALL_OFFSET_MIN = 60;
/** 近接サポート測定: キャリアからこの距離帯 [min,max] にいる味方を「パスの選択肢」と数える。 */
const NEAR_SUPPORT_MIN = 120;
const NEAR_SUPPORT_MAX = 250;
/** 近接サポート測定: ボール深度がこの帯にある時のみサンプルする (仕様1.2は「中盤」の基準。
 * 敵陣深くのボックス攻略は仕様1.3の別基準)。 */
const NEAR_SUPPORT_BALL_DEPTH_MIN = 400;
const NEAR_SUPPORT_BALL_DEPTH_MAX = 1400;
/** レストディフェンス測定: ボール深度よりこのpx以上後方を「保険の位置」と数える。 */
const REST_DEFENDER_BEHIND_PX = 300;
/** リスタート保護測定: 再開からこのtick以内の最初のタッチを判定対象にする。 */
const RESTART_FIRST_TOUCH_WINDOW = 600;
/** ゴール側遮蔽測定: ボールが自ゴールからこの深度以上にある時のみサンプルする (ゴール際の幾何的制約を除外)。 */
const GOAL_SIDE_MIN_BALL_DEPTH = 400;
/** 縦レーン過密測定: ピッチをこの本数の縦レーンに等分する。 */
const LANE_COUNT = 4;

/**
 * マーク割り当ての取得 (update.ts が毎tick計算しているものと同じ純関数を同じ引数で再計算する。
 * selectPassTarget と同じパターン: 可視状態からの純関数なので測定側で再導出できる)。
 */
function markAssignmentsForStats(state: GameState): ReadonlyMap<number, number> {
  return computeMarkAssignments(
    state.players,
    state.linePossessionTeam,
    getHalf(state.frame),
    state.teamFormations,
    state.ball.pos,
  );
}

const AIM_DEADZONE_SQ: Fixed = fixedMul(toFixed(0.5), toFixed(0.5));

const ALL_DIRECTIONS = [
  Direction8.Up,
  Direction8.UpRight,
  Direction8.Right,
  Direction8.DownRight,
  Direction8.Down,
  Direction8.DownLeft,
  Direction8.Left,
  Direction8.UpLeft,
];

function goalLineY(attackUp: boolean): number {
  return attackUp ? 0 : PITCH_HEIGHT;
}

/** 人間スクリプトのシュート開始距離 (px)。グラウンダーの物理的到達距離(~225px)に合わせる。 */
const SCRIPT_SHOOT_RANGE = 220;

/**
 * 人間入力の模擬スクリプト。パターンごとに閉包内に最小限の状態(チャージ進行・前tickのボタン)を
 * 持つが、乱数はmulberry32のみで決定論的 (同じseed+同じ状態列なら同じ入力列)。
 *
 * 全アクティブパターン共通で「操作がGKに切り替わっていてボールが近い時はキャッチ(Y)を試みる」
 * を含む — 実際の人間プレイヤーが必ず行う操作で、これ無しの検証はGK不在と同じになり、
 * CPUのシュートが全部入る非現実的なスコアになる (観戦シミュレーターの初期計測で確認)。
 */
export function createHumanScript(pattern: HumanPattern, scriptSeed: number): (state: GameState) => Inputs {
  let rng: RngState = createRng(scriptSeed);
  let chargeTicksLeft = 0;
  /** チャージ開始時に決めた解放方向 (None=解放時にゴール中心方向を量子化して使う)。 */
  let aimDirection: Direction8 = Direction8.None;
  let prevY = false;
  let prevB = false;

  const roll = (max: number): number => {
    let value: number;
    [value, rng] = nextRangeInt(rng, 0, max);
    return value;
  };

  const randomDirection = (): Direction8 => ALL_DIRECTIONS[roll(ALL_DIRECTIONS.length)] as Direction8;

  return (state: GameState): Inputs => {
    if (pattern === 'idle') {
      return { direction: Direction8.None, buttons: emptyButtonState() };
    }

    const half: Half = getHalf(state.frame);
    const attackUp = attackingIsUpward(TeamId.A, half);
    const forward = attackUp ? Direction8.Up : Direction8.Down;
    const controlled = state.players[state.controlledPlayerIndex];
    const isCarrier = findTouchPriorityPlayer(state.players, state.ball.pos) === state.controlledPlayerIndex;

    const buttons: ButtonState = { ...emptyButtonState() };
    let direction = Direction8.None;

    const finish = (): Inputs => {
      prevY = buttons.Y;
      prevB = buttons.B;
      return { direction, buttons };
    };

    // 最寄りの相手選手 (プレス回避の判断材料。実プレイヤーは常に見ている情報)
    let nearestOppDist = Infinity;
    let nearestOppIsLeft = false;
    if (controlled) {
      for (const p of state.players) {
        if (p.team !== TeamId.B) continue;
        const d = Math.sqrt(distSqFixed(p.pos, controlled.pos) as number) / 16;
        if (d < nearestOppDist) {
          nearestOppDist = d;
          nearestOppIsLeft = toFloat(p.pos.x) < toFloat(controlled.pos.x);
        }
      }
    }

    // --- GKセーブ (全アクティブパターン共通) ---
    // 飛んでくるボール(速い)にはパンチング(B)。キャッチ(Y)は使わない: このゲームには
    // GKの保持からの配球(スロー/パントキック)が未実装のため、キャッチすると足元に確保した
    // ボールを毎tickキャッチし直す无限ループに陥り、試合が完全に止まる (観戦シミュレーターの
    // 初期計測で発覚したデッドロック)。パンチングは入射速度ぶんだけ前方へ弾くので流れが続く。
    // 足元の死んだボール(遅い)はドリブルで前へ運び出す。
    if (controlled?.isGoalkeeper) {
      const distToBall = Math.sqrt(distSqFixed(controlled.pos, state.ball.pos) as number) / 16;
      const ballVelX = toFloat(state.ball.vel.x);
      const ballVelY = toFloat(state.ball.vel.y);
      const ballSpeed = Math.hypot(ballVelX, ballVelY);
      if (distToBall < 32 && ballSpeed > 4.5 && !prevB) {
        buttons.B = true; // 速いボールにはパンチング試行 (エッジ)
        return finish();
      }
      if (isCarrier && ballSpeed <= 4.5) {
        if (nearestOppDist < 50) {
          // プレスが目前: 立ち止まって溜めると奪われるので、まず離れる方向へ運ぶ
          direction = attackUp
            ? nearestOppIsLeft
              ? Direction8.UpRight
              : Direction8.UpLeft
            : nearestOppIsLeft
              ? Direction8.DownRight
              : Direction8.DownLeft;
          return finish();
        }
        // 足元の死んだボール: 短いチャージキックで素早く前線へクリアする
        // (遅いボールはセーブ文脈にならず通常キックが使える — simの詰み修正に対応した操作)
        chargeTicksLeft = 2 + roll(2);
        buttons.B = true;
        return finish();
      }
      if (distToBall > 200) {
        // ボールが離れたら自陣ゴール前へ戻る (GKの基本ポジショニング)
        const homeY = goalLineY(!attackUp) + (attackUp ? -36 : 36);
        direction = quantizeToDirection8(
          vSub({ x: toFixed(GOAL_CENTER_X), y: toFixed(homeY) }, controlled.pos),
          AIM_DEADZONE_SQ,
        );
        return finish();
      }
      // 位置調整: ボールが向かってくる場合は「GKのy座標に到達する時のx」を予測して先回りする
      // (現在のボール位置を追いかけるだけではコーナーへのシュートに追いつけない、人間の
      // 実際のセービング操作の近似)。
      const gkY = toFloat(controlled.pos.y);
      const bY = toFloat(state.ball.pos.y);
      let targetX = toFloat(state.ball.pos.x);
      if (Math.abs(ballVelY) > 0.3 && Math.sign(gkY - bY) === Math.sign(ballVelY)) {
        const ticksToArrive = Math.abs((gkY - bY) / ballVelY);
        targetX = toFloat(state.ball.pos.x) + ballVelX * Math.min(ticksToArrive, 60);
      }
      targetX = Math.min(Math.max(targetX, GOAL_CENTER_X - 60), GOAL_CENTER_X + 60);
      direction = quantizeToDirection8(
        vSub({ x: toFixed(targetX), y: controlled.pos.y }, controlled.pos),
        AIM_DEADZONE_SQ,
      );
      return finish();
    }

    // --- チャージキック進行中: B押しっぱなし→最後のtickで方向+B解放(=キック実行) ---
    if (chargeTicksLeft > 0) {
      chargeTicksLeft--;
      if (chargeTicksLeft > 0) {
        buttons.B = true;
        direction = Direction8.None;
      } else if (controlled) {
        // 解放tick: チャージ開始時に選んだ照準方向 (未指定ならゴール中心方向を量子化)
        if (aimDirection !== Direction8.None) {
          direction = aimDirection;
          aimDirection = Direction8.None;
        } else {
          const goalPos = { x: toFixed(GOAL_CENTER_X), y: toFixed(goalLineY(attackUp)) };
          direction = quantizeToDirection8(vSub(goalPos, controlled.pos), AIM_DEADZONE_SQ);
        }
      }
      return finish();
    }

    const distToGoalLine = controlled ? Math.abs(toFloat(controlled.pos.y) - goalLineY(attackUp)) : PITCH_HEIGHT;
    const goalPos = { x: toFixed(GOAL_CENTER_X), y: toFixed(goalLineY(attackUp)) };
    const towardGoal = controlled
      ? quantizeToDirection8(vSub(goalPos, controlled.pos), AIM_DEADZONE_SQ)
      : forward;

    // 照準チェック: 8方向のうち、直線外挿でゴールマウス(±40px)に入る方向があればそれを返す。
    // 8方向量子化のため「ゴール中心を向いた方向」は最大22.5°ずれ、遠目からだと枠を外れる。
    // 実プレイヤーと同様、8つの撃ち分けから枠に入るコースを選び、無ければ撃たない
    // (CLAUDE.mdの「照準スキル」= 位置取りとコース選択で枠に入れる、の操作近似)。
    const bestShotDirection = (): Direction8 | null => {
      if (!controlled) return null;
      const goalY = goalLineY(attackUp);
      const px = toFloat(controlled.pos.x);
      const py = toFloat(controlled.pos.y);
      let best: Direction8 | null = null;
      let bestOffset = Infinity;
      for (const dir of ALL_DIRECTIONS) {
        const v = DIRECTION_VECTORS[dir];
        const vx = toFloat(v.x as Fixed);
        const vy = toFloat(v.y as Fixed);
        if (Math.abs(vy) < 0.01) continue;
        if (attackUp ? vy >= 0 : vy <= 0) continue;
        const t = (goalY - py) / vy;
        const xAtGoal = px + vx * t;
        const offset = Math.abs(xAtGoal - GOAL_CENTER_X);
        if (offset <= 40 && offset < bestOffset) {
          best = dir;
          bestOffset = offset;
        }
      }
      return best;
    };

    // プレスから離れる斜め前方 (相手が左なら右前へ、右なら左前へ)
    const evadeDirection = attackUp
      ? nearestOppIsLeft
        ? Direction8.UpRight
        : Direction8.UpLeft
      : nearestOppIsLeft
        ? Direction8.DownRight
        : Direction8.DownLeft;

    switch (pattern) {
      case 'aggressive': {
        const shotDir = isCarrier && distToGoalLine < 340 ? bestShotDirection() : null;
        if (isCarrier && shotDir !== null && distToGoalLine < SCRIPT_SHOOT_RANGE && roll(100) < 85) {
          // 枠に飛ぶ撃ち分けコースがある時だけ速射 (照準スキルの近似)
          aimDirection = shotDir;
          chargeTicksLeft = 1 + roll(2);
          buttons.B = true;
          return finish();
        }
        if (isCarrier && shotDir !== null && distToGoalLine < 340 && roll(100) < 15) {
          // やや遠めからの思い切ったミドルシュート (頻度低め)
          aimDirection = shotDir;
          chargeTicksLeft = 1 + roll(2);
          buttons.B = true;
          return finish();
        }
        if (isCarrier && distToGoalLine > 400 && nearestOppDist > 70 && roll(100) < 12) {
          // 自陣/中盤からのロングパント (溜めて高弾道、空中は転がり摩擦が無いため大きく前進する。
          // 前線の味方(保持側の追跡権1人+押し上げたライン)が回収する、実プレイのロングボール戦術)
          chargeTicksLeft = 8 + roll(7);
          buttons.B = true;
          return finish();
        }
        if (isCarrier) {
          // プレスが迫っていたら味方への逃がしパス (受け手がいる時のみ)
          if (nearestOppDist < 50 && !prevY && roll(100) < 30) {
            if (selectPassTarget(state.controlledPlayerIndex, state.players) !== null) {
              buttons.Y = true;
              direction = towardGoal;
              return finish();
            }
          }
          // プレスが近い時は斜めに外しながら前進、遠い時はゴールへ直進
          const r = roll(100);
          if (nearestOppDist < 70) {
            direction = r < 75 ? evadeDirection : towardGoal;
          } else {
            direction = r < 75 ? towardGoal : r < 92 ? randomDirection() : forward;
          }
          // ロングドリブル(L)はスペースがある時だけ (蹴り出しが大きい=プレスに弱い、CLAUDE.mdの
          // リスクリターン設計どおりの使い分け)
          buttons.L = nearestOppDist > 80;
        } else {
          // 非保持: ボールへ寄せる/前へ。近ければタックル。
          const distToBall = controlled
            ? Math.sqrt(distSqFixed(controlled.pos, state.ball.pos) as number) / 16
            : Infinity;
          if (state.lastTouchTeam === TeamId.B && distToBall < 90 && !prevB && roll(100) < 10) {
            buttons.A = true; // スライディング (17周目にボタン表へ合わせて B->A)
          }
          const r = roll(100);
          if (r < 50 && controlled) {
            direction = quantizeToDirection8(vSub(state.ball.pos, controlled.pos), AIM_DEADZONE_SQ);
          } else if (r < 80) {
            direction = forward;
          } else {
            direction = randomDirection();
          }
        }
        break;
      }
      case 'passHeavy': {
        const shotDir = isCarrier && distToGoalLine < SCRIPT_SHOOT_RANGE ? bestShotDirection() : null;
        if (isCarrier && shotDir !== null && roll(100) < 40) {
          aimDirection = shotDir;
          chargeTicksLeft = 1 + roll(2);
          buttons.B = true;
          return finish();
        }
        if (isCarrier) {
          const r = roll(100);
          direction = nearestOppDist < 70 ? evadeDirection : r < 55 ? towardGoal : r < 85 ? randomDirection() : Direction8.None;
          // 高頻度のカーソルパス (受け手がいる時のみ、エッジになるよう前tickがYでない時のみ)
          if (!prevY && roll(100) < 15 && selectPassTarget(state.controlledPlayerIndex, state.players) !== null) {
            buttons.Y = true;
          }
        } else {
          const r = roll(100);
          if (r < 40 && controlled) {
            direction = quantizeToDirection8(vSub(state.ball.pos, controlled.pos), AIM_DEADZONE_SQ);
          } else if (r < 75) {
            direction = forward;
          } else {
            direction = randomDirection();
          }
        }
        break;
      }
      case 'defensive': {
        // 自陣ゴールとボールの中間点へ向かう (ゴール前を固める動き)
        if (controlled) {
          const ownGoalY = goalLineY(!attackUp);
          const midpoint = {
            x: toFixed((toFloat(state.ball.pos.x) + GOAL_CENTER_X) / 2),
            y: toFixed((toFloat(state.ball.pos.y) + ownGoalY) / 2),
          };
          direction = quantizeToDirection8(vSub(midpoint, controlled.pos), AIM_DEADZONE_SQ);
        }
        // ボールが近ければたまにタックル(Bエッジ)
        if (!isCarrier && controlled) {
          const distToBall = Math.sqrt(distSqFixed(controlled.pos, state.ball.pos) as number) / 16;
          if (distToBall < 100 && !prevB && roll(100) < 6) buttons.A = true; // スライディング (B->A)
        }
        // 奪ったら前線へ蹴り出す
        if (isCarrier && roll(100) < 10) {
          chargeTicksLeft = 4 + roll(6);
          buttons.B = true;
          return finish();
        }
        break;
      }
    }

    return finish();
  };
}

interface PendingShotWindow {
  team: TeamId;
  resolveAtFrame: number;
  beforeCentroidDepth: number;
  scoreA: number;
  scoreB: number;
  half: Half;
  shotFrame: number;
  /** 窓の途中で相手がボールに触れたら真になり、この窓は測定対象外になる
   * (相手に渡った後の後退は正当な守備移行のため、「不自然な後退」の測定から外す)。 */
  invalidated: boolean;
}

function centroidDepth(state: GameState, team: TeamId, half: Half): number {
  let sum = 0;
  let count = 0;
  for (const p of state.players) {
    if (p.team !== team || p.isGoalkeeper) continue;
    sum += toFloat(depthFromOwnGoal(team, half, p.pos.y));
    count++;
  }
  return count > 0 ? sum / count : 0;
}

export interface RunMatchOptions {
  seed: number;
  scriptSeed?: number;
  pattern: HumanPattern;
  difficulty?: Difficulty;
  ticks?: number;
}

export function runSimulatedMatch(opts: RunMatchOptions): MatchStats {
  const ticks = opts.ticks ?? FULL_MATCH_DURATION_FRAMES;
  const scriptSeed = opts.scriptSeed ?? 42;
  const script = createHumanScript(opts.pattern, scriptSeed);
  let state = createInitialState(opts.seed, { difficulty: opts.difficulty ?? 'hard', offsideEnabled: true });

  const events: string[] = [];
  const logEvent = (msg: string) => {
    if (events.length < 200) events.push(msg);
  };

  // 集計器
  const shots: [number, number] = [0, 0];
  const shotsOnTarget: [number, number] = [0, 0];
  const boxEntries: [number, number] = [0, 0];
  const possessionTicks: [number, number] = [0, 0];
  let dangoSum = 0;
  let dangoMax = 0;
  let dangoCount = 0;
  const retreatSum: [number, number] = [0, 0];
  const retreatCount: [number, number] = [0, 0];
  const pressSum: [number, number] = [0, 0];
  const pressCount: [number, number] = [0, 0];
  const supportSum: [number, number] = [0, 0];
  const supportCount: [number, number] = [0, 0];
  const markDistSum: [number, number] = [0, 0];
  const markCount: [number, number] = [0, 0];
  const markedTicks: [number, number] = [0, 0];
  const defendingTicks: [number, number] = [0, 0];

  // 第2層 (BehaviorMetrics) の集計器
  const xShiftSum: [number, number] = [0, 0];
  const xShiftCount: [number, number] = [0, 0];
  const nearSupportSum: [number, number] = [0, 0];
  const nearSupportCount: [number, number] = [0, 0];
  const restDefSum: [number, number] = [0, 0];
  const restDefCount: [number, number] = [0, 0];
  const goalSideSum: [number, number] = [0, 0];
  const goalSideCount: [number, number] = [0, 0];
  const restartWon: [number, number] = [0, 0];
  const restartTotal: [number, number] = [0, 0];
  const laneMaxSum: [number, number] = [0, 0];
  const laneMaxCount: [number, number] = [0, 0];
  /** 判定待ちのリスタート (lastEventで検出、最初のタッチで解決する)。 */
  let pendingRestart: { team: TeamId; atFrame: number } | null = null;
  let prevLastEventFrame = -1;

  // 選手分布
  const posSumX = new Array<number>(22).fill(0);
  const posSumY = new Array<number>(22).fill(0);
  const posSumSq = new Array<number>(22).fill(0);
  const thirds: Array<[number, number, number]> = Array.from({ length: 22 }, () => [0, 0, 0]);

  // 振動検出 (非重複窓)
  const oscPath = new Array<number>(22).fill(0);
  const oscMinX = new Array<number>(22).fill(Infinity);
  const oscMaxX = new Array<number>(22).fill(-Infinity);
  const oscMinY = new Array<number>(22).fill(Infinity);
  const oscMaxY = new Array<number>(22).fill(-Infinity);
  let oscWindowStart = 0;
  const oscillating = new Set<number>();
  const resetOscWindow = (frame: number) => {
    oscPath.fill(0);
    oscMinX.fill(Infinity);
    oscMaxX.fill(-Infinity);
    oscMinY.fill(Infinity);
    oscMaxY.fill(-Infinity);
    oscWindowStart = frame;
  };

  const pendingShotWindows: PendingShotWindow[] = [];
  let lastRestartFrame = -1;

  // 前tickの状態スナップショット (イベント検出用)
  let prevBallSpeed = 0;
  let prevScore: readonly [number, number] = state.score;
  let prevHalf: Half = getHalf(state.frame);
  let prevInsideBox: [boolean, boolean] = [false, false]; // [Aの自陣ボックス内, Bの自陣ボックス内]
  let prevPositions = state.players.map((p) => ({ x: toFloat(p.pos.x), y: toFloat(p.pos.y) }));
  let prevBallPos = { x: toFloat(state.ball.pos.x), y: toFloat(state.ball.pos.y) };

  for (let i = 0; i < ticks; i++) {
    const inputs = script(state);
    state = simulate(state, inputs);
    const half: Half = getHalf(state.frame);

    const ballX = toFloat(state.ball.pos.x);
    const ballY = toFloat(state.ball.pos.y);
    const ballVelX = toFloat(state.ball.vel.x);
    const ballVelY = toFloat(state.ball.vel.y);
    const ballSpeed = Math.hypot(ballVelX, ballVelY);

    // --- リスタート(テレポート)検出 ---
    const ballJump = Math.hypot(ballX - prevBallPos.x, ballY - prevBallPos.y);
    if (ballJump > 15) {
      lastRestartFrame = state.frame;
      logEvent(`t${state.frame} restart/teleport ball -> (${ballX.toFixed(0)},${ballY.toFixed(0)})`);
    }

    // --- 得点検出 ---
    if (state.score[0] !== prevScore[0] || state.score[1] !== prevScore[1]) {
      const scorer = state.score[0] !== prevScore[0] ? TeamId.A : TeamId.B;
      logEvent(`t${state.frame} GOAL team${scorer} score=${state.score[0]}-${state.score[1]}`);
    }

    // --- ハーフ切替 / 得点による陣形リセット: 振動窓・保留中のシュート窓を破棄 ---
    const formationReset =
      half !== prevHalf || state.score[0] !== prevScore[0] || state.score[1] !== prevScore[1];
    if (formationReset) {
      resetOscWindow(state.frame);
      pendingShotWindows.length = 0;
    }

    // --- キック/シュート検出 (速度しきい値の立ち上がり) ---
    if (ballSpeed >= KICK_DETECT_SPEED && prevBallSpeed < KICK_DETECT_SPEED && state.lastTouchTeam !== null) {
      const kicker = state.lastTouchTeam;
      const kickerAttacksUp = attackingIsUpward(kicker, half);
      const targetGoalY = goalLineY(kickerAttacksUp);
      const headingToGoal = kickerAttacksUp ? ballVelY < 0 : ballVelY > 0;
      const distToGoal = Math.abs(ballY - targetGoalY);
      if (headingToGoal && distToGoal < SHOT_MAX_RANGE && Math.abs(ballVelY) > 0.01) {
        const t = (targetGoalY - ballY) / ballVelY;
        const xAtGoal = ballX + ballVelX * t;
        if (Math.abs(xAtGoal - GOAL_CENTER_X) <= SHOT_AIM_HALF_WIDTH) {
          shots[kicker]++;
          const onTarget = Math.abs(xAtGoal - GOAL_CENTER_X) <= ON_TARGET_HALF_WIDTH;
          if (onTarget) shotsOnTarget[kicker]++;
          logEvent(
            `t${state.frame} SHOT team${kicker} from(${ballX.toFixed(0)},${ballY.toFixed(0)}) xAtGoal=${xAtGoal.toFixed(0)}${onTarget ? ' [on target]' : ''}`,
          );
          // 陣形後退の測定対象は「実際のシュート距離(300px以内)からの一撃」のみに絞る
          // (中盤からの前方への蹴り出しも上の緩い定義ではシュートに数えられるが、
          //  その後の陣形変化はシュート反応とは言えないため)。
          if (distToGoal < 300) {
            pendingShotWindows.push({
              team: kicker,
              resolveAtFrame: state.frame + RETREAT_WINDOW,
              beforeCentroidDepth: centroidDepth(state, kicker, half),
              scoreA: state.score[0],
              scoreB: state.score[1],
              half,
              shotFrame: state.frame,
              invalidated: false,
            });
          }
        }
      }
    }

    // --- シュート後の陣形後退の測定 ---
    for (let w = pendingShotWindows.length - 1; w >= 0; w--) {
      const win = pendingShotWindows[w]!;
      // 窓の途中で一度でも相手がボールに触れたら測定対象外 (相手に渡った後の後退は正当)。
      if (state.lastTouchTeam === opponentOf(win.team)) win.invalidated = true;
      if (state.frame < win.resolveAtFrame) continue;
      pendingShotWindows.splice(w, 1);
      const scoreChanged = state.score[0] !== win.scoreA || state.score[1] !== win.scoreB;
      const halfChanged = half !== win.half;
      const restartInWindow = lastRestartFrame >= win.shotFrame;
      if (win.invalidated || scoreChanged || halfChanged || restartInWindow) continue; // 正当な後退要因は除外
      const after = centroidDepth(state, win.team, half);
      const retreat = Math.max(0, win.beforeCentroidDepth - after);
      retreatSum[win.team] += retreat;
      retreatCount[win.team]++;
      if (retreat > 60) {
        logEvent(`t${state.frame} POST-SHOT RETREAT team${win.team} ${retreat.toFixed(0)}px`);
      }
    }

    // --- ペナルティエリア侵入 ---
    // defendingTeam D のボックス: Dのゴールライン側150px×中央±130px
    const insideBox: [boolean, boolean] = [false, false];
    for (const d of [TeamId.A, TeamId.B]) {
      const dDepth = toFloat(depthFromOwnGoal(d, half, state.ball.pos.y));
      insideBox[d] = dDepth <= BOX_DEPTH && Math.abs(ballX - GOAL_CENTER_X) <= BOX_HALF_WIDTH;
      if (insideBox[d] && !prevInsideBox[d]) {
        const attacker = opponentOf(d);
        boxEntries[attacker]++;
        logEvent(`t${state.frame} BOX ENTRY by team${attacker} (ball ${ballX.toFixed(0)},${ballY.toFixed(0)})`);
      }
    }
    prevInsideBox = insideBox;

    // --- 支配率 ---
    if (state.lastTouchTeam !== null) possessionTicks[state.lastTouchTeam]++;

    // --- 団子度 ---
    if (i > 50) {
      let near = 0;
      for (const p of state.players) {
        const distPx = Math.sqrt(distSqFixed(p.pos, state.ball.pos) as number) / 16;
        if (distPx <= DANGO_RADIUS_PX) near++;
      }
      dangoSum += near;
      dangoCount++;
      if (near > dangoMax) dangoMax = near;
    }

    // --- プレス距離 ---
    if (state.lastTouchTeam !== null) {
      const presser = opponentOf(state.lastTouchTeam);
      const presserBallDepth = toFloat(depthFromOwnGoal(presser, half, state.ball.pos.y));
      if (presserBallDepth > PRESS_DEPTH_THRESHOLD) {
        let minDist = Infinity;
        for (const p of state.players) {
          if (p.team !== presser || p.isGoalkeeper) continue;
          const distPx = Math.sqrt(distSqFixed(p.pos, state.ball.pos) as number) / 16;
          if (distPx < minDist) minDist = distPx;
        }
        if (Number.isFinite(minDist)) {
          pressSum[presser] += minDist;
          pressCount[presser]++;
        }
      }
    }

    // --- 第2層: リスタート保護 (仕様4) ---
    // lastEvent (throwIn/goalKick/corner) の新規発生を検出し、その後の最初のタッチが
    // 再開チームか相手かを記録する。gkCatchはリスタートではないため対象外。
    if (
      state.lastEvent &&
      state.lastEvent.kind !== 'gkCatch' &&
      state.lastEvent.atFrame === state.frame &&
      state.lastEvent.atFrame !== prevLastEventFrame
    ) {
      pendingRestart = { team: state.lastEvent.team, atFrame: state.frame };
      prevLastEventFrame = state.lastEvent.atFrame;
    }
    if (pendingRestart) {
      const firstTouchIdx = findTouchPriorityPlayer(state.players, state.ball.pos);
      if (firstTouchIdx !== null) {
        const touchTeam = state.players[firstTouchIdx]!.team;
        restartTotal[pendingRestart.team]++;
        if (touchTeam === pendingRestart.team) restartWon[pendingRestart.team]++;
        pendingRestart = null;
      } else if (state.frame - pendingRestart.atFrame > RESTART_FIRST_TOUCH_WINDOW) {
        pendingRestart = null; // 誰も触らないまま時間切れ (別のリスタートで上書きされた等)
      }
    }

    // --- 第2層: ボールサイドシフト / ゴール側遮蔽 (守備側) と 近接サポート / レスト / レーン (保持側) ---
    if (state.linePossessionTeam !== null) {
      const behPossTeam = state.linePossessionTeam;
      const behDefTeam = opponentOf(behPossTeam);

      // 守備側: Xシフト (仕様P1) — ボールが中央から十分離れている時のみ
      const ballOffsetX = ballX - GOAL_CENTER_X;
      if (Math.abs(ballOffsetX) >= XSHIFT_BALL_OFFSET_MIN) {
        let cxSum = 0;
        let cxN = 0;
        for (const p of state.players) {
          if (p.team !== behDefTeam || p.isGoalkeeper) continue;
          cxSum += toFloat(p.pos.x);
          cxN++;
        }
        if (cxN > 0) {
          const centroidOffset = cxSum / cxN - GOAL_CENTER_X;
          xShiftSum[behDefTeam] += Math.sign(ballOffsetX) * centroidOffset;
          xShiftCount[behDefTeam]++;
        }
      }

      // 守備側: ゴール側遮蔽 (仕様2.2) — ボールより自ゴール側にいる非GK人数。
      // ボールが自ゴールに近すぎる時(深度<400px)はサンプルしない: ゴール際の守備では
      // 「ボールとゴールの間」の空間自体が幾何的に狭く、人数が少なくても正常なため、
      // 状況(ボール位置)と挙動(位置取り)を混同しないようにする。
      {
        const ballDepthDef = toFloat(depthFromOwnGoal(behDefTeam, half, state.ball.pos.y));
        if (ballDepthDef >= GOAL_SIDE_MIN_BALL_DEPTH) {
          let goalSide = 0;
          for (const p of state.players) {
            if (p.team !== behDefTeam || p.isGoalkeeper) continue;
            if (toFloat(depthFromOwnGoal(behDefTeam, half, p.pos.y)) < ballDepthDef) goalSide++;
          }
          goalSideSum[behDefTeam] += goalSide;
          goalSideCount[behDefTeam]++;
        }
      }

      // 保持側: 近接サポート (仕様1.2「ボールが中盤」) — キャリアがいて、かつボールが
      // 中盤帯にある時のみ。敵陣深く(ボックス攻略)は仕様1.3の別基準の領分であり、
      // ゴール前では味方がボックス内へ散開するため近接帯の人数は構造的に減る。
      const behTouchIdx = findTouchPriorityPlayer(state.players, state.ball.pos);
      const behBallDepthPoss = toFloat(depthFromOwnGoal(behPossTeam, half, state.ball.pos.y));
      if (
        behTouchIdx !== null &&
        state.players[behTouchIdx]!.team === behPossTeam &&
        behBallDepthPoss >= NEAR_SUPPORT_BALL_DEPTH_MIN &&
        behBallDepthPoss <= NEAR_SUPPORT_BALL_DEPTH_MAX
      ) {
        const carrier = state.players[behTouchIdx]!;
        let near = 0;
        state.players.forEach((p, idx) => {
          if (idx === behTouchIdx || p.team !== behPossTeam || p.isGoalkeeper) return;
          const distPx = Math.sqrt(distSqFixed(p.pos, carrier.pos) as number) / 16;
          if (distPx >= NEAR_SUPPORT_MIN && distPx <= NEAR_SUPPORT_MAX) near++;
        });
        nearSupportSum[behPossTeam] += near;
        nearSupportCount[behPossTeam]++;
      }

      // 保持側: レストディフェンス (仕様1.3) — ボールが敵陣側1/3にある時のみ
      {
        const ballDepthPoss = toFloat(depthFromOwnGoal(behPossTeam, half, state.ball.pos.y));
        if (ballDepthPoss > PRESS_DEPTH_THRESHOLD) {
          let rest = 0;
          for (const p of state.players) {
            if (p.team !== behPossTeam || p.isGoalkeeper) continue;
            if (toFloat(depthFromOwnGoal(behPossTeam, half, p.pos.y)) < ballDepthPoss - REST_DEFENDER_BEHIND_PX) rest++;
          }
          restDefSum[behPossTeam] += rest;
          restDefCount[behPossTeam]++;
        }
      }

      // 保持側: 縦レーン過密 (仕様P3)
      {
        const laneWidth = PITCH_WIDTH / LANE_COUNT;
        const lanes = new Array<number>(LANE_COUNT).fill(0);
        for (const p of state.players) {
          if (p.team !== behPossTeam || p.isGoalkeeper) continue;
          const lane = Math.min(LANE_COUNT - 1, Math.max(0, Math.floor(toFloat(p.pos.x) / laneWidth)));
          lanes[lane]!++;
        }
        laneMaxSum[behPossTeam] += Math.max(...lanes);
        laneMaxCount[behPossTeam]++;
      }
    }

    // --- サポートラン / マーク測定 (linePossessionTeamベース: 陣形挙動と同じシグナル) ---
    if (state.linePossessionTeam !== null) {
      const possTeam = state.linePossessionTeam;
      const ballDepthForPoss = toFloat(depthFromOwnGoal(possTeam, half, state.ball.pos.y));
      if (ballDepthForPoss > SUPPORT_DEPTH_THRESHOLD) {
        const touchIdx = findTouchPriorityPlayer(state.players, state.ball.pos);
        let ahead = 0;
        state.players.forEach((p, idx) => {
          if (p.team !== possTeam || p.isGoalkeeper || idx === touchIdx) return;
          const pDepth = toFloat(depthFromOwnGoal(possTeam, half, p.pos.y));
          if (pDepth > ballDepthForPoss + SUPPORT_AHEAD_METRIC_PX) ahead++;
        });
        supportSum[possTeam] += ahead;
        supportCount[possTeam]++;
      }
      const defender = opponentOf(possTeam);
      defendingTicks[defender]++;
      const assignments = markAssignmentsForStats(state);
      if (assignments.size > 0) markedTicks[defender]++;
      for (const [markerIdx, targetIdx] of assignments) {
        const distPx =
          Math.sqrt(distSqFixed(state.players[markerIdx]!.pos, state.players[targetIdx]!.pos) as number) / 16;
        markDistSum[defender] += distPx;
        markCount[defender]++;
      }
    }

    // --- 選手分布・振動 ---
    state.players.forEach((p, idx) => {
      const x = toFloat(p.pos.x);
      const y = toFloat(p.pos.y);
      posSumX[idx]! += x;
      posSumY[idx]! += y;
      const prev = prevPositions[idx]!;
      const step = Math.hypot(x - prev.x, y - prev.y);
      posSumSq[idx]! += x * x + y * y;
      const depth = toFloat(depthFromOwnGoal(p.team, half, p.pos.y));
      const third = depth < PITCH_HEIGHT / 3 ? 0 : depth < (PITCH_HEIGHT / 3) * 2 ? 1 : 2;
      thirds[idx]![third]++;

      // 振動検出の対象はAI操作の選手のみ (人間が操作中の選手のこまめな位置調整は意図的な
      // 入力なので、AIの不具合検出という趣旨から除外する)。テレポート(陣形リセット等)も
      // 振動窓に混ぜない。
      if (step < 40 && idx !== state.controlledPlayerIndex) {
        oscPath[idx]! += step;
        if (x < oscMinX[idx]!) oscMinX[idx] = x;
        if (x > oscMaxX[idx]!) oscMaxX[idx] = x;
        if (y < oscMinY[idx]!) oscMinY[idx] = y;
        if (y > oscMaxY[idx]!) oscMaxY[idx] = y;
      }
    });
    if (state.frame - oscWindowStart >= OSC_WINDOW) {
      for (let idx = 0; idx < 22; idx++) {
        const bboxW = oscMaxX[idx]! - oscMinX[idx]!;
        const bboxH = oscMaxY[idx]! - oscMinY[idx]!;
        if (oscPath[idx]! > OSC_MIN_PATH && bboxW < OSC_MAX_BBOX && bboxH < OSC_MAX_BBOX) {
          if (!oscillating.has(idx)) {
            logEvent(`t${state.frame} OSCILLATION player${idx} path=${oscPath[idx]!.toFixed(0)}px bbox=${bboxW.toFixed(0)}x${bboxH.toFixed(0)}`);
          }
          oscillating.add(idx);
        }
      }
      resetOscWindow(state.frame);
    }

    prevBallSpeed = ballSpeed;
    prevScore = state.score;
    prevHalf = half;
    prevPositions = state.players.map((p) => ({ x: toFloat(p.pos.x), y: toFloat(p.pos.y) }));
    prevBallPos = { x: ballX, y: ballY };
  }

  const decidedTicks = possessionTicks[0] + possessionTicks[1];
  const players: PlayerDistribution[] = Array.from({ length: 22 }, (_, idx) => {
    const meanX = posSumX[idx]! / ticks;
    const meanY = posSumY[idx]! / ticks;
    const meanSq = posSumSq[idx]! / ticks;
    const variance = Math.max(0, meanSq - (meanX * meanX + meanY * meanY));
    const total = thirds[idx]![0] + thirds[idx]![1] + thirds[idx]![2];
    return {
      meanX,
      meanY,
      spread: Math.sqrt(variance),
      thirds: [thirds[idx]![0] / total, thirds[idx]![1] / total, thirds[idx]![2] / total] as [number, number, number],
    };
  });

  const teamStats = (team: TeamId): TeamMatchStats => ({
    shots: shots[team],
    shotsOnTarget: shotsOnTarget[team],
    goals: state.score[team],
    boxEntries: boxEntries[team],
    possessionPct: decidedTicks > 0 ? (possessionTicks[team] / decidedTicks) * 100 : 0,
    postShotRetreatAvgPx: retreatCount[team] > 0 ? retreatSum[team] / retreatCount[team] : 0,
    postShotRetreatSamples: retreatCount[team],
    pressDistanceAvgPx: pressCount[team] > 0 ? pressSum[team] / pressCount[team] : 0,
    pressSamples: pressCount[team],
    supportRunnersAvgAhead: supportCount[team] > 0 ? supportSum[team] / supportCount[team] : 0,
    supportSamples: supportCount[team],
    markDistanceAvgPx: markCount[team] > 0 ? markDistSum[team] / markCount[team] : 0,
    markSamples: markCount[team],
    markedTicksShare: defendingTicks[team] > 0 ? markedTicks[team] / defendingTicks[team] : 0,
    behavior: {
      defXShiftTowardBallAvgPx: xShiftCount[team] > 0 ? xShiftSum[team] / xShiftCount[team] : 0,
      defXShiftSamples: xShiftCount[team],
      nearSupportAvg: nearSupportCount[team] > 0 ? nearSupportSum[team] / nearSupportCount[team] : 0,
      nearSupportSamples: nearSupportCount[team],
      restDefendersAvg: restDefCount[team] > 0 ? restDefSum[team] / restDefCount[team] : 0,
      restDefendersSamples: restDefCount[team],
      goalSideDefendersAvg: goalSideCount[team] > 0 ? goalSideSum[team] / goalSideCount[team] : 0,
      goalSideDefendersSamples: goalSideCount[team],
      restartFirstTouchRate: restartTotal[team] > 0 ? restartWon[team] / restartTotal[team] : 0,
      restartCount: restartTotal[team],
      laneMaxOccupancyAvg: laneMaxCount[team] > 0 ? laneMaxSum[team] / laneMaxCount[team] : 0,
      laneMaxOccupancySamples: laneMaxCount[team],
    },
  });

  return {
    pattern: opts.pattern,
    seed: opts.seed,
    scriptSeed,
    ticks,
    finalScore: state.score,
    teams: [teamStats(TeamId.A), teamStats(TeamId.B)],
    dangoAvg: dangoCount > 0 ? dangoSum / dangoCount : 0,
    dangoMax,
    oscillatingPlayers: [...oscillating].sort((a, b) => a - b),
    players,
    events,
  };
}

/** レポート表示用の整形。 */
export function formatMatchSummary(stats: MatchStats): string {
  const lines: string[] = [];
  const t = (team: 0 | 1) => stats.teams[team];
  lines.push(
    `=== pattern=${stats.pattern} seed=${stats.seed} scriptSeed=${stats.scriptSeed} ticks=${stats.ticks} ===`,
  );
  lines.push(`score: TeamA ${stats.finalScore[0]} - ${stats.finalScore[1]} TeamB`);
  for (const team of [0, 1] as const) {
    const s = t(team);
    lines.push(
      `Team${team === 0 ? 'A' : 'B'}: shots=${s.shots} onTarget=${s.shotsOnTarget} boxEntries=${s.boxEntries} ` +
        `possession=${s.possessionPct.toFixed(1)}% postShotRetreat=${s.postShotRetreatAvgPx.toFixed(1)}px(n=${s.postShotRetreatSamples}) ` +
        `pressDist=${s.pressDistanceAvgPx.toFixed(0)}px(n=${s.pressSamples}) ` +
        `supportAhead=${s.supportRunnersAvgAhead.toFixed(2)}(n=${s.supportSamples}) ` +
        `markDist=${s.markDistanceAvgPx.toFixed(0)}px(n=${s.markSamples}) marked=${(s.markedTicksShare * 100).toFixed(0)}%`,
    );
  }
  lines.push(`dango: avg=${stats.dangoAvg.toFixed(2)} max=${stats.dangoMax}`);
  lines.push(`oscillating players: [${stats.oscillatingPlayers.join(', ')}]`);
  for (const team of [0, 1] as const) {
    const b = stats.teams[team].behavior;
    lines.push(
      `Team${team === 0 ? 'A' : 'B'} behavior: xShift=${b.defXShiftTowardBallAvgPx.toFixed(1)}px(n=${b.defXShiftSamples}) ` +
        `nearSupport=${b.nearSupportAvg.toFixed(2)}(n=${b.nearSupportSamples}) restDef=${b.restDefendersAvg.toFixed(2)}(n=${b.restDefendersSamples}) ` +
        `goalSide=${b.goalSideDefendersAvg.toFixed(2)}(n=${b.goalSideDefendersSamples}) restartWin=${(b.restartFirstTouchRate * 100).toFixed(0)}%(n=${b.restartCount}) ` +
        `laneMax=${b.laneMaxOccupancyAvg.toFixed(2)}(n=${b.laneMaxOccupancySamples})`,
    );
  }
  return lines.join('\n');
}

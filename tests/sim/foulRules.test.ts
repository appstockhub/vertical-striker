import { describe, expect, it } from 'vitest';
import { distSqFixed, toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import { Direction8, emptyButtonState } from '../../src/input/types';
import { createInitialState, TeamId, type GameState } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';
import { PITCH_HEIGHT } from '../../src/config/pitch';
import { PENALTY_SPOT_DEPTH } from '../../src/render/pitchGeometry';
import { SET_PIECE_EXCLUSION_RADIUS_FIXED } from '../../src/sim/boundsConstants';
import {
  TACKLE_ACTIVE_FRAMES,
  TACKLE_RECOVERY_FRAMES,
  TACKLE_WINDUP_FRAMES,
} from '../../src/sim/tackleConstants';

/**
 * ★ファウル / フリーキック / ペナルティキック (競技規則 第12〜14条)★
 *
 * ユーザー指示により実装。それまで当プロジェクトは「ファウル無し」を意図的な設計として
 * 採用していたが (原作のスライディングにファウル判定が無いことの継承)、その結果
 * 第13条(FK)・第14条(PK)が丸ごと成立しない状態だった (docs/soccer-rules-audit.md)。
 *
 * 判定の原則 (実装方針):
 *   - スライディングタックルが、ボールを奪えないまま相手競技者に当たったらファウル
 *     (= 「ボールに行っていない」タックル。読み勝ちで奪えた場合は正当なプレー)
 *   - ファウルの位置が守備側のペナルティエリア内なら PK、それ以外は直接FK
 *   - FK/PK は既存のセットプレー再開ロック機構に乗せる (相手は規定距離まで離れる)
 */

const NO_INPUT = { direction: Direction8.None, buttons: emptyButtonState() };
const inp = (dir: Direction8, b = {}) => ({ direction: dir, buttons: { ...emptyButtonState(), ...b } });

/**
 * 人間(Team A)がボール保持者(Team B)の背後からスライディングする状況。
 *
 * 重要な前提 (実装を計測して確認した): タックルは**ボール保持者に対してのみ**発動できる。
 * したがって「ボールと無関係の選手にいきなり滑る」操作は存在せず、ファウルになるのは
 *   - 保持者を狙って滑ったが奪えず、別の相手に突っ込んだ
 *   - 遠くから飛び込んで奪えないまま人に当たった
 * というケースになる。blockerAt を指定すると、スライドの進路上に2人目の相手を置く。
 */
function slidingSetup(x: number, y: number, blockerAt: number | null): GameState {
  const base = createInitialState(2, { difficulty: 'easy', offsideEnabled: false });
  const human = TeamId.A * 11 + 5;
  const carrier = TeamId.B * 11 + 9;
  const blocker = TeamId.B * 11 + 4;
  const carrierPos = { x: toFixed(x), y: toFixed(y) };
  // Team B は half=1 で南(y増)へ攻める。人間は背後 = y の小さい側。
  const humanPos = { x: toFixed(x), y: toFixed(y - 26) };
  return {
    ...base,
    controlledPlayerIndex: human,
    // ボールは保持者の足元 (= タックルを発動できる状態)。
    ball: {
      pos: { x: toFixed(x), y: toFixed(y + 6) },
      vel: { x: ZERO_FIXED, y: ZERO_FIXED },
      height: ZERO_FIXED,
      zVel: ZERO_FIXED,
    },
    players: base.players.map((p, i) => {
      if (i === human) return { ...p, pos: humanPos, facing: Direction8.Down };
      if (i === carrier) return { ...p, pos: carrierPos, facing: Direction8.Down };
      if (i === blocker && blockerAt !== null)
        return { ...p, pos: { x: toFixed(x + 3), y: toFixed(blockerAt) }, facing: Direction8.Up };
      return { ...p, pos: { x: toFixed(20 + (i % 4) * 25), y: toFixed(p.team === TeamId.A ? 1700 : 60) } };
    }),
    lastTouchTeam: TeamId.B,
    lastTouchPlayerIndex: carrier,
    setPieceLock: null,
  };
}

/** スライディングを出して、決着 (ファウル or 奪取) が付くまで進める。
 * テンポ変更追従: タックルのフレームが 1/RUN_TEMPO 倍 (溜め34f/判定57f/隙114f) に
 * 伸びたため、決着待ちの上限もタックル定数から導出する (旧: 40tick固定)。 */
const SLIDE_SETTLE_TICKS =
  TACKLE_WINDUP_FRAMES + TACKLE_ACTIVE_FRAMES + TACKLE_RECOVERY_FRAMES + 30;
function slideAndSettle(start: GameState, maxTicks = SLIDE_SETTLE_TICKS): GameState {
  let state = simulate(start, inp(Direction8.Down, { A: true })); // A = スライディング (ボタン表)
  for (let i = 0; i < maxTicks; i++) {
    state = simulate(state, inp(Direction8.Down));
    if (state.setPieceLock?.kind === 'freeKick' || state.setPieceLock?.kind === 'penalty') return state;
  }
  return state;
}

describe('ファウル判定 (競技規則 第12条)', () => {
  it('ボールに届かないスライディングで相手に当たったらファウルになる', () => {
    // 2人目の相手 (blocker) をスライドの進路上 (人間とボールの間) に置く =
    // 「保持者を狙ったが別の相手に突っ込んだ」ケース。
    // テンポ変更追従: 旧配置 (blocker=918、保持者の先) は、溜め34tickの間に保持者が
    // ボールをクリアして blocker がボールを追って逃げてしまい、接触が二度と起きなくなった。
    // 進路上 (890) に置けば Active 序盤に確実に接触する (実測: 46tick目にFK成立)。
    // サイクル③追従: 実照準パス導入でCPUキャリアが溜め中に確実にパスで逃げるようになった。
    // このテストの対象は「人間のスライドの接触判定」なので、練習モード (cpuHandsOff、
    // CPUのボール関与を止める既存機構) で相手を静止させて判定だけを検証する。
    const state = slideAndSettle({ ...slidingSetup(240, 900, 890), cpuHandsOff: true });
    expect(state.setPieceLock?.kind, 'ファウルが取られない').toBe('freeKick');
    expect(state.setPieceLock?.restartTeam, 'FKが反則した側に与えられている').toBe(TeamId.B);
  });

  it('ボールを奪えた正当なタックルはファウルにならない', () => {
    // ボールが保持者の足元 (0px) = 読み勝ちで奪えるケース。
    const state = slideAndSettle(slidingSetup(240, 900, null));
    expect(state.setPieceLock?.kind, '正当なタックルでファウルを取られた').not.toBe('freeKick');
    expect(state.setPieceLock?.kind).not.toBe('penalty');
  });

  it('相手が近くにいない空振りスライディングはファウルにならない', () => {
    // サイクル②追従: blockerAt=null で最初からスライド進路上に誰も置かない。
    // 旧セットアップはキャリアだけ遠ざけてブロッカー(918)を進路上に残していたが、
    // 旧サーボモデルではブロッカーAIがボールを吸着して進路から連れ去るため偶然
    // 「空振り」が成立していただけだった (離散タッチ化でボールがその場に残り、
    // ブロッカーも留まるため、進路上の接触=正当なファウル判定になる)。
    const base = slidingSetup(240, 900, null);
    // 保持者も遠くへ移す (誰にも当たらないスライディング)。
    const state: GameState = {
      ...base,
      players: base.players.map((p, i) =>
        i === TeamId.B * 11 + 9 ? { ...p, pos: { x: toFixed(240), y: toFixed(600) } } : p,
      ),
    };
    const next = slideAndSettle(state);
    expect(next.setPieceLock?.kind).not.toBe('freeKick');
    expect(next.setPieceLock?.kind).not.toBe('penalty');
  });
});

describe('フリーキック (競技規則 第13条)', () => {
  it('ファウル地点にボールが置かれ、キッカーがそこに立つ', () => {
    // blocker=890: スライドの進路上に置いてファウルを成立させる (上記ファウル判定テスト参照)。
    const state = slideAndSettle({ ...slidingSetup(240, 900, 890), cpuHandsOff: true });
    expect(state.setPieceLock?.kind).toBe('freeKick');
    const restartTeam = state.setPieceLock!.restartTeam;
    let nearest = Infinity;
    state.players.forEach((p) => {
      if (p.team !== restartTeam) return;
      nearest = Math.min(nearest, Math.sqrt(toFloat(distSqFixed(p.pos, state.ball.pos))));
    });
    expect(nearest, 'FKのキッカーがボールのところに居ない').toBeLessThan(12);
    expect(state.ball.vel.x).toBe(ZERO_FIXED);
    expect(state.ball.vel.y).toBe(ZERO_FIXED);
  });

  it('相手は規定距離まで離される (9.15m相当)', () => {
    const state = slideAndSettle({ ...slidingSetup(240, 900, 890), cpuHandsOff: true });
    const restartTeam = state.setPieceLock!.restartTeam;
    const limit = toFloat(SET_PIECE_EXCLUSION_RADIUS_FIXED);
    state.players.forEach((p, i) => {
      if (p.team === restartTeam || p.isGoalkeeper) return;
      const d = Math.sqrt(toFloat(distSqFixed(p.pos, state.ball.pos)));
      expect(d, `players[${i}] がFKのボールに近すぎる`).toBeGreaterThanOrEqual(limit - 2);
    });
  });

  it('蹴るまで相手はボールに触れない', () => {
    let state = slideAndSettle(slidingSetup(240, 900, 890));
    const foulingTeam = TeamId.A;
    for (let i = 0; i < 60; i++) {
      state = simulate(state, NO_INPUT);
      if (!state.setPieceLock) break;
      expect(state.lastTouchTeam, `t${i}: 蹴る前に反則した側が触れた`).not.toBe(foulingTeam);
    }
  });
});

describe('ペナルティキック (競技規則 第14条)', () => {
  /** Team A のペナルティエリア内 (南側ゴール前) でファウルする状況。 */
  function foulInBox(): GameState {
    return slidingSetup(240, PITCH_HEIGHT - 120, PITCH_HEIGHT - 102);
  }

  it('守備側のペナルティエリア内のファウルはPKになる', () => {
    const state = slideAndSettle(foulInBox());
    expect(state.setPieceLock?.kind, 'ボックス内のファウルがPKにならない').toBe('penalty');
    expect(state.setPieceLock?.restartTeam).toBe(TeamId.B);
  });

  it('ボールはペナルティスポットに置かれる', () => {
    const state = slideAndSettle(foulInBox());
    expect(toFloat(state.ball.pos.x)).toBeCloseTo(240, 0);
    expect(toFloat(state.ball.pos.y)).toBeCloseTo(PITCH_HEIGHT - PENALTY_SPOT_DEPTH, 0);
  });

  it('キッカー以外は全員ペナルティエリアの外 (GKを除く)', () => {
    const state = slideAndSettle(foulInBox());
    const restartTeam = state.setPieceLock!.restartTeam;
    // キッカー = 再開チームでボールに最も近い選手。
    let kicker = -1;
    let best = Infinity;
    state.players.forEach((p, i) => {
      if (p.team !== restartTeam) return;
      const d = Math.sqrt(toFloat(distSqFixed(p.pos, state.ball.pos)));
      if (d < best) {
        best = d;
        kicker = i;
      }
    });
    expect(best, 'PKのキッカーがボールのところに居ない').toBeLessThan(12);

    state.players.forEach((p, i) => {
      if (i === kicker || p.isGoalkeeper) return;
      const y = toFloat(p.pos.y);
      const inBoxY = y > PITCH_HEIGHT - 168;
      const inBoxX = Math.abs(toFloat(p.pos.x) - 240) < 144;
      expect(inBoxY && inBoxX, `players[${i}] がPK時にペナルティエリア内にいる`).toBe(false);
    });
  });

  it('守備側GKはゴールライン上に立つ', () => {
    const state = slideAndSettle(foulInBox());
    const gk = state.players[TeamId.A * 11]!;
    expect(toFloat(gk.pos.y), 'GKがゴールラインにいない').toBeGreaterThan(PITCH_HEIGHT - 24);
  });
});

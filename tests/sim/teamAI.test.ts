import { describe, expect, it } from 'vitest';
import { toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import { computeNonControlledDirection, computeOffsideLine } from '../../src/sim/teamAI';
import { createInitialState } from '../../src/sim/state';
import type { PlayerState } from '../../src/sim/state';
import { TeamId, FormationId } from '../../src/sim/formations';
import { Direction8 } from '../../src/input/types';
import { TacklePhase } from '../../src/sim/state';

function makePlayer(
  x: number,
  y: number,
  team: TeamId,
  slotIndex: number,
  overrides: Partial<PlayerState> = {},
): PlayerState {
  return {
    pos: { x: toFixed(x), y: toFixed(y) },
    vel: { x: ZERO_FIXED, y: ZERO_FIXED },
    facing: Direction8.Up,
    kickChargeFrames: 0,
    team,
    isGoalkeeper: slotIndex === 0,
    slotIndex,
    tacklePhase: TacklePhase.None,
    tackleFrames: 0,
    tackleDirection: Direction8.None,
    ...overrides,
  };
}

const FORMATIONS: readonly [FormationId, FormationId] = [FormationId.F442, FormationId.F442];

describe('computeOffsideLine', () => {
  it('is the Y of the 2nd-deepest player (index 1 among ascending-depth-from-own-goal)', () => {
    // Team B (自陣は y=0側): GK y=10(最も深い), DF y=50(2番目に深い), FW y=300
    const players = [
      makePlayer(0, 10, TeamId.B, 0),
      makePlayer(100, 50, TeamId.B, 1),
      makePlayer(200, 300, TeamId.B, 9),
    ];
    const line = computeOffsideLine(players, TeamId.B, 1);
    expect(toFloat(line)).toBeCloseTo(50, 3);
  });

  it('handles an exact tie for deepest without throwing, and both tied players share the same Y', () => {
    // 2人のCBが完全に同じ深さ (左右対称のキックオフでよく起きる)
    const players = [
      makePlayer(100, 162, TeamId.A, 1),
      makePlayer(300, 162, TeamId.A, 2),
      makePlayer(200, 900, TeamId.A, 9),
    ];
    const line = computeOffsideLine(players, TeamId.A, 1);
    // 2番目に深い選手のYは、タイの2人のどちらが選ばれても同じ値になる
    expect(toFloat(line)).toBeCloseTo(162, 3);
  });

  it('works against the real 22-player kickoff state without throwing', () => {
    const state = createInitialState(1);
    expect(() => computeOffsideLine(state.players, TeamId.A, 1)).not.toThrow();
    expect(() => computeOffsideLine(state.players, TeamId.B, 1)).not.toThrow();
    expect(() => computeOffsideLine(state.players, TeamId.A, 2)).not.toThrow();
  });
});

describe('computeNonControlledDirection', () => {
  it('home-pull dominates when the ball is co-located (no ball attraction) and offside is not triggered', () => {
    // Team A DF (slotIndex 1) の home は (72, 1638) 付近。プレイヤーをその真上に置く
    // (同じx、home.yより小さいy) -> home方向は Down。ボールを同じ位置に置き ballDir=None にする。
    const player = makePlayer(72, 1538, TeamId.A, 1);
    const ballPos = player.pos; // 同一座標 -> ballDir は deadzone で None
    const teamB = Array.from({ length: 11 }, (_, slot) => makePlayer(240, 100 + slot * 5, TeamId.B, slot));
    const direction = computeNonControlledDirection(player, [player, ...teamB], ballPos, FORMATIONS, 1);
    expect(direction).toBe(Direction8.Down);
  });

  it('ball-attraction dominates when the player is already at home (no home pull)', () => {
    const player = makePlayer(72, 1638, TeamId.A, 1); // 4-4-2 DF1 の home ちょうど
    const ballPos = { x: toFixed(72), y: toFixed(1438) }; // 真上 (小さいy) -> Up
    const teamB = Array.from({ length: 11 }, (_, slot) => makePlayer(240, 100 + slot * 5, TeamId.B, slot));
    const direction = computeNonControlledDirection(player, [player, ...teamB], ballPos, FORMATIONS, 1);
    expect(direction).toBe(Direction8.Up);
  });

  it('offside bias reinforces home-pull, pushing a too-advanced attacker back toward their own half', () => {
    // Team A FW (slotIndex 9) の home x=168。そのxのまま、相手ゴール前深く (y=50) に置く
    // -> Team Bのオフサイドライン(既定フォーメーションで約162)より前に出ている。
    const player = makePlayer(168, 50, TeamId.A, 9);
    const ballPos = player.pos; // ballDir=None にして home+offside の効果に絞る
    // Team B は実際のキックオフフォーメーションで配置する (現実的なオフサイドライン値にするため)
    const state = createInitialState(1);
    const realTeamB = state.players.slice(11, 22);
    const direction = computeNonControlledDirection(player, [player, ...realTeamB], ballPos, FORMATIONS, 1);
    // home(y=1035, 遠い)・offside、どちらも「自陣方向(y増加=Down)」を向くため Down になる
    expect(direction).toBe(Direction8.Down);
  });

  it('combines home-pull and ball-attraction into a direction leaning toward both influences', () => {
    // home が右(Right)方向、ボールが上(Up)方向にあるケース。ホームからの距離(72px)は
    // リーシュ半径(220px)以内のためHOME_PULL_WEIGHT_NEAR(0.5) < BALL_ATTRACTION_WEIGHT(0.9)、
    // ボール引力がやや優勢になるが、両者の合成方向としてRightかUpRightのどちらかに収まる
    // (Phase 3で発見したホーム項凍結バグの修正により、Team B含む非操作選手がホーム近傍では
    // ボールを追いやすくなった。詳細はteamAIConstants.tsのコメント参照)。
    const player = makePlayer(0, 1638, TeamId.A, 1); // home は (72, 1638) = 真右
    const ballPos = { x: ZERO_FIXED, y: toFixed(1438) }; // 真上
    const teamB = Array.from({ length: 11 }, (_, slot) => makePlayer(240, 100 + slot * 5, TeamId.B, slot));
    const direction = computeNonControlledDirection(player, [player, ...teamB], ballPos, FORMATIONS, 1);
    expect([Direction8.Right, Direction8.UpRight]).toContain(direction);
  });

  it('does not throw against the real 22-player kickoff state for every player', () => {
    const state = createInitialState(1);
    for (const player of state.players) {
      expect(() =>
        computeNonControlledDirection(player, state.players, state.ball.pos, state.teamFormations, 1),
      ).not.toThrow();
    }
  });

  // 実プレイで発覚したバグの回帰テスト (Phase 3): ボールがホームと反対方向にある場合でも、
  // ホーム近傍(リーシュ半径以内)なら非操作選手はボールへ向かって進めるべき。
  // 修正前はHOME_PULL_WEIGHT(距離によらず常にフル強度)がBALL_ATTRACTION_WEIGHTを
  // ほぼ常に上回り、ホームのすぐ外側で実質的に凍結していた。
  it('bug regression: moves toward the ball even when directly at home and the ball is in any direction (does not freeze at home)', () => {
    const player = makePlayer(72, 1638, TeamId.A, 1); // ちょうどhome
    const ballPos = { x: toFixed(72), y: toFixed(1638 - 80) }; // 80px真上 (home近傍圏内)
    const teamB = Array.from({ length: 11 }, (_, slot) => makePlayer(240, 100 + slot * 5, TeamId.B, slot));
    const direction = computeNonControlledDirection(player, [player, ...teamB], ballPos, FORMATIONS, 1);
    expect(direction).toBe(Direction8.Up);
  });

  it('bug regression: still makes progress toward a ball that lies in the OPPOSITE direction from home, as long as within the leash radius', () => {
    // homeの少し外側 (leash半径220pxより十分内側) に立っており、ボールはhomeとは逆方向にある。
    const home = { x: 72, y: 1638 };
    const player = makePlayer(home.x, home.y - 40, TeamId.A, 1); // homeより40px北 (=home方向はDown)
    const ballPos = { x: toFixed(home.x), y: toFixed(home.y - 200) }; // さらに北 (=ボール方向もUp寄り、homeとは逆)
    const teamB = Array.from({ length: 11 }, (_, slot) => makePlayer(240, 100 + slot * 5, TeamId.B, slot));
    const direction = computeNonControlledDirection(player, [player, ...teamB], ballPos, FORMATIONS, 1);
    // ボール引力(0.9) > ホーム近傍の復元力(0.5)なので、home方向(Down)ではなくボール方向(Up)寄りになるはず。
    expect(direction).not.toBe(Direction8.Down);
    expect([Direction8.Up, Direction8.UpLeft, Direction8.UpRight]).toContain(direction);
  });

  it('bug regression: gets recalled toward home once far beyond the leash radius, even if the ball is further still', () => {
    const home = { x: 72, y: 1638 };
    // homeから300px離れている (リーシュ半径220pxを超える)。ボールはさらに先。
    const player = makePlayer(home.x, home.y - 300, TeamId.A, 1);
    const ballPos = { x: toFixed(home.x), y: toFixed(home.y - 500) };
    const teamB = Array.from({ length: 11 }, (_, slot) => makePlayer(240, 100 + slot * 5, TeamId.B, slot));
    const direction = computeNonControlledDirection(player, [player, ...teamB], ballPos, FORMATIONS, 1);
    // リーシュ外なのでホームへの復元力(2.5)が優勢になり、Down(home方向)に戻るはず。
    expect(direction).toBe(Direction8.Down);
  });
});

import { describe, expect, it } from 'vitest';
import { toFixed, toFloat, vAdd, vScaleFixed, ZERO_FIXED } from '../../src/core/fixed';
import {
  computeChaseRightIndices,
  computeLineAdjustedHomePosition,
  computeNonControlledDirection,
  computeOffsideLine,
} from '../../src/sim/teamAI';
import { getHomePosition } from '../../src/sim/formations';
import { createInitialState } from '../../src/sim/state';
import type { PlayerState } from '../../src/sim/state';
import { TeamId, FormationId } from '../../src/sim/formations';
import { Direction8 } from '../../src/input/types';
import { TacklePhase } from '../../src/sim/state';
import { DIRECTION_VECTORS, PLAYER_SPEED_FIXED } from '../../src/sim/constants';

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

// half=1: Team B は北(own goal y=0)を守り、南(y=1800)へ攻める (formations.tsの規約と同じ)。
describe('computeLineAdjustedHomePosition (team line push/retreat, Phase 3 bug fix: "Team Bがハーフラインを越えて攻めない")', () => {
  it('returns the exact static home position when the ball is contested (possessionTeam=null)', () => {
    const home = getHomePosition(TeamId.B, 9, FormationId.F442, 1);
    const adjusted = computeLineAdjustedHomePosition(TeamId.B, 9, FormationId.F442, 1, { x: toFixed(240), y: toFixed(1600) }, null);
    expect(adjusted).toEqual(home);
  });

  it('pushes a forward (high home depth) much further forward than a defender when the team has the ball deep in the attacking third', () => {
    const ballPos = { x: toFixed(240), y: toFixed(1600) }; // Team Bの攻撃方向(南)に深く進んでいる
    const fwHome = getHomePosition(TeamId.B, 9, FormationId.F442, 1); // FW, depthFrac 0.85
    const dfHome = getHomePosition(TeamId.B, 1, FormationId.F442, 1); // DF, depthFrac 0.18

    const fwAdjusted = computeLineAdjustedHomePosition(TeamId.B, 9, FormationId.F442, 1, ballPos, TeamId.B);
    const dfAdjusted = computeLineAdjustedHomePosition(TeamId.B, 1, FormationId.F442, 1, ballPos, TeamId.B);

    const fwPush = toFloat(fwAdjusted.y) - toFloat(fwHome.y);
    const dfPush = toFloat(dfAdjusted.y) - toFloat(dfHome.y);

    expect(fwPush).toBeGreaterThan(0); // FWは前進 (南=yが大きい方向)
    expect(dfPush).toBeGreaterThan(0); // DFも多少は前進する
    expect(fwPush).toBeGreaterThan(dfPush * 2); // だがFWの方がずっと大きく押し上げられる
  });

  it('barely moves the goalkeeper regardless of how far the ball has advanced', () => {
    const ballPos = { x: toFixed(240), y: toFixed(1600) };
    const gkHome = getHomePosition(TeamId.B, 0, FormationId.F442, 1);
    const gkAdjusted = computeLineAdjustedHomePosition(TeamId.B, 0, FormationId.F442, 1, ballPos, TeamId.B);
    expect(Math.abs(toFloat(gkAdjusted.y) - toFloat(gkHome.y))).toBeLessThan(100);
  });

  it('never pushes a home position behind its static home when attacking (only ever forward)', () => {
    // ボールが自陣側 (まだホームより後ろ) にある場合、保持中でも後退はしない (maxを取るため)。
    const ballPos = { x: toFixed(240), y: toFixed(50) }; // Team Bの自陣深く
    const fwHome = getHomePosition(TeamId.B, 9, FormationId.F442, 1);
    const fwAdjusted = computeLineAdjustedHomePosition(TeamId.B, 9, FormationId.F442, 1, ballPos, TeamId.B);
    expect(toFloat(fwAdjusted.y)).toBeGreaterThanOrEqual(toFloat(fwHome.y) - 1);
  });

  it('retreats a forward toward their own goal when the opponent has the ball deep in defense, but damped (not as strongly as the forward push)', () => {
    const ballPos = { x: toFixed(240), y: toFixed(50) }; // Team Bの自陣深く (相手が攻めてきている)
    const fwHome = getHomePosition(TeamId.B, 9, FormationId.F442, 1);
    const fwAdjustedAttack = computeLineAdjustedHomePosition(TeamId.B, 9, FormationId.F442, 1, { x: toFixed(240), y: toFixed(1600) }, TeamId.B);
    const fwAdjustedRetreat = computeLineAdjustedHomePosition(TeamId.B, 9, FormationId.F442, 1, ballPos, TeamId.A);

    const pushMagnitude = toFloat(fwAdjustedAttack.y) - toFloat(fwHome.y);
    const retreatMagnitude = toFloat(fwHome.y) - toFloat(fwAdjustedRetreat.y);

    expect(retreatMagnitude).toBeGreaterThan(0); // 後退はする
    expect(retreatMagnitude).toBeLessThan(pushMagnitude); // ただし押し上げよりは弱い (LINE_RETREAT_DAMPING)
  });

  it('does not retreat the goalkeeper further when the ball is not yet deeper than the GK already sits', () => {
    const ballPos = { x: toFixed(240), y: toFixed(50) }; // GKのホーム(y=36)より浅い
    const gkHome = getHomePosition(TeamId.B, 0, FormationId.F442, 1);
    const gkAdjusted = computeLineAdjustedHomePosition(TeamId.B, 0, FormationId.F442, 1, ballPos, TeamId.A);
    // ボール深度の32pxグリッド量子化(ジッター防止)によりサブピクセルの差は出るため精度0(±0.5px)
    expect(toFloat(gkAdjusted.y)).toBeCloseTo(toFloat(gkHome.y), 0);
  });
});

describe('computeNonControlledDirection', () => {
  it('home-pull dominates when the ball is co-located (no ball attraction) and offside is not triggered', () => {
    // Team A DF (slotIndex 1) の home は (72, 1638) 付近。プレイヤーをその真上に置く
    // (同じx、home.yより小さいy) -> home方向は Down。ボールを同じ位置に置き ballDir=None にする。
    const player = makePlayer(72, 1538, TeamId.A, 1);
    const ballPos = player.pos; // 同一座標 -> ballDir は deadzone で None
    const teamB = Array.from({ length: 11 }, (_, slot) => makePlayer(240, 100 + slot * 5, TeamId.B, slot));
    const direction = computeNonControlledDirection(player, [player, ...teamB], ballPos, FORMATIONS, 1, null, 'primary');
    expect(direction).toBe(Direction8.Down);
  });

  it('ball-attraction dominates when the player is already at home (no home pull)', () => {
    const player = makePlayer(72, 1638, TeamId.A, 1); // 4-4-2 DF1 の home ちょうど
    const ballPos = { x: toFixed(72), y: toFixed(1438) }; // 真上 (小さいy) -> Up
    const teamB = Array.from({ length: 11 }, (_, slot) => makePlayer(240, 100 + slot * 5, TeamId.B, slot));
    const direction = computeNonControlledDirection(player, [player, ...teamB], ballPos, FORMATIONS, 1, null, 'primary');
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
    const direction = computeNonControlledDirection(player, [player, ...realTeamB], ballPos, FORMATIONS, 1, null, 'primary');
    // home(y=1035, 遠い)・offside、どちらも「自陣方向(y増加=Down)」を向くため Down になる
    expect(direction).toBe(Direction8.Down);
  });

  it('combines home-pull and ball-attraction into a direction leaning toward both influences (non-chaser)', () => {
    // home が右(Right)方向、ボールが上(Up)方向にあるケース。追跡権なしの選手は
    // ホーム復元(0.5) > 非追跡権のボール引力(0.15) のため、ホーム方向(Right)寄りになる
    // (弱いボール引力もわずかに合成に効く: Right か UpRight のどちらかに収まる)。
    const player = makePlayer(0, 1638, TeamId.A, 1); // home は (72, 1638) = 真右
    const ballPos = { x: ZERO_FIXED, y: toFixed(1438) }; // 真上
    const teamB = Array.from({ length: 11 }, (_, slot) => makePlayer(240, 100 + slot * 5, TeamId.B, slot));
    const direction = computeNonControlledDirection(player, [player, ...teamB], ballPos, FORMATIONS, 1, null, null);
    expect([Direction8.Right, Direction8.UpRight]).toContain(direction);
  });

  it('does not throw against the real 22-player kickoff state for every player', () => {
    const state = createInitialState(1);
    for (const player of state.players) {
      expect(() =>
        computeNonControlledDirection(player, state.players, state.ball.pos, state.teamFormations, 1, null, 'primary'),
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
    const direction = computeNonControlledDirection(player, [player, ...teamB], ballPos, FORMATIONS, 1, null, 'primary');
    expect(direction).toBe(Direction8.Up);
  });

  it('bug regression: still makes progress toward a ball that lies in the OPPOSITE direction from home, as long as within the leash radius', () => {
    // homeの少し外側 (leash半径220pxより十分内側) に立っており、ボールはhomeとは逆方向にある。
    const home = { x: 72, y: 1638 };
    const player = makePlayer(home.x, home.y - 40, TeamId.A, 1); // homeより40px北 (=home方向はDown)
    const ballPos = { x: toFixed(home.x), y: toFixed(home.y - 200) }; // さらに北 (=ボール方向もUp寄り、homeとは逆)
    const teamB = Array.from({ length: 11 }, (_, slot) => makePlayer(240, 100 + slot * 5, TeamId.B, slot));
    const direction = computeNonControlledDirection(player, [player, ...teamB], ballPos, FORMATIONS, 1, null, 'primary');
    // ボール引力(0.9) > ホーム近傍の復元力(0.5)なので、home方向(Down)ではなくボール方向(Up)寄りになるはず。
    expect(direction).not.toBe(Direction8.Down);
    expect([Direction8.Up, Direction8.UpLeft, Direction8.UpRight]).toContain(direction);
  });

  it('bug regression: a NON-chaser far beyond the leash gets recalled toward home, even if the ball is further still', () => {
    const home = { x: 72, y: 1638 };
    // homeから300px離れている (リーシュ帯280pxを超える)。ボールはさらに先。
    const player = makePlayer(home.x, home.y - 300, TeamId.A, 1);
    const ballPos = { x: toFixed(home.x), y: toFixed(home.y - 500) };
    const teamB = Array.from({ length: 11 }, (_, slot) => makePlayer(240, 100 + slot * 5, TeamId.B, slot));
    // 追跡権なし: リーシュ外なのでホームへの復元力(2.5)が優勢になり、Down(home方向)に戻る。
    const direction = computeNonControlledDirection(player, [player, ...teamB], ballPos, FORMATIONS, 1, null, null);
    expect(direction).toBe(Direction8.Down);
  });

  it('a PRIMARY chaser is exempt from the leash and keeps pressing pitch-wide (前線からのプレス)', () => {
    const home = { x: 72, y: 1638 };
    const player = makePlayer(home.x, home.y - 300, TeamId.A, 1); // リーシュ帯(280px)の外
    const ballPos = { x: toFixed(home.x), y: toFixed(home.y - 500) }; // ボールはさらに前方
    const teamB = Array.from({ length: 11 }, (_, slot) => makePlayer(240, 100 + slot * 5, TeamId.B, slot));
    const direction = computeNonControlledDirection(player, [player, ...teamB], ballPos, FORMATIONS, 1, null, 'primary');
    // 追跡権primary: ピッチ全域でボールを追える (呼び戻されない)。
    expect(direction).toBe(Direction8.Up);
  });

  // 実プレイで発覚したバグの回帰テスト (Phase 3、2周目): 追跡権を持たない選手は
  // ボール引力を弱め、ホームポジション優先で「団子サッカー」を防ぐ。
  it('bug regression: without chase right, home-pull wins even when the ball is nearby in the opposite direction (prevents dogpiling)', () => {
    const home = { x: 72, y: 1638 };
    const player = makePlayer(home.x, home.y - 40, TeamId.A, 1); // homeより40px北 (=home方向はDown)
    const ballPos = { x: toFixed(home.x), y: toFixed(home.y - 200) }; // さらに北 (=ボール方向もUp寄り)
    const teamB = Array.from({ length: 11 }, (_, slot) => makePlayer(240, 100 + slot * 5, TeamId.B, slot));
    // hasChaseRight=true では同じ状況でUp寄りになる (上のテストで確認済み) が、
    // hasChaseRight=false ではBALL_ATTRACTION_WEIGHT_NON_CHASER_FIXED(0.15) <
    // HOME_PULL_WEIGHT_NEAR_FIXED(0.5) なので、ホームへ戻る方向(Down)が優勢になるはず。
    const direction = computeNonControlledDirection(player, [player, ...teamB], ballPos, FORMATIONS, 1, null, null);
    expect(direction).toBe(Direction8.Down);
  });

  // 実プレイで発覚したバグの回帰テスト (Phase 3、3周目): リーシュ境界のちょうど距離に留まる
  // 選手が「ホームへの1歩→ボールへの1歩」を無限に繰り返すチャタリング (見た目上は凍結と
  // 見分けがつかない) が起きていた。滑らかな遷移帯 (AI_HOME_LEASH_RAMP_NEAR/FAR) の導入で
  // 解消したことを確認する: リーシュ境界ちょうどの距離でも、2tick連続で同じ方向へ動くはず。
  it('bug regression: does not oscillate (chatter) between two directions when sitting exactly at the leash boundary', () => {
    const home = { x: 168, y: 765 };
    // 旧実装の単一しきい値(220px)ちょうどの距離に選手を置く。ボールは選手から見て斜め方向。
    const player = makePlayer(home.x - 83, home.y + 204, TeamId.A, 9);
    const ballPos = { x: toFixed(home.x - 128), y: toFixed(home.y + 314) }; // さらに斜め奥
    const teamB = Array.from({ length: 11 }, (_, slot) => makePlayer(400, 100 + slot * 5, TeamId.B, slot));
    const roster = [player, ...teamB];

    const dir1 = computeNonControlledDirection(player, roster, ballPos, FORMATIONS, 1, null, 'primary');
    // dir1の方向へ1tick分動かした選手で再計算し、dir1と正反対の方向が返らないことを確認する
    // (正反対=チャタリングの兆候。滑らかな遷移帯なら1tickの位置変化で完全反転はしないはず)。
    const moved = { ...player, pos: vAdd(player.pos, vScaleFixed(DIRECTION_VECTORS[dir1], PLAYER_SPEED_FIXED)) };
    const dir2 = computeNonControlledDirection(moved, [moved, ...teamB], ballPos, FORMATIONS, 1, null, 'primary');
    const opposite: Partial<Record<Direction8, Direction8>> = {
      [Direction8.Up]: Direction8.Down,
      [Direction8.Down]: Direction8.Up,
      [Direction8.Left]: Direction8.Right,
      [Direction8.Right]: Direction8.Left,
      [Direction8.UpLeft]: Direction8.DownRight,
      [Direction8.DownRight]: Direction8.UpLeft,
      [Direction8.UpRight]: Direction8.DownLeft,
      [Direction8.DownLeft]: Direction8.UpRight,
    };
    expect(dir2).not.toBe(opposite[dir1]);
  });

  // 実プレイで発覚したバグの回帰テスト (Phase 3、4周目): 8方向への量子化を各項ごとに行って
  // から合成する方式は、目標が斜め方向にある場合など軸ごとに成分が打ち消し合い、本来
  // ボールに向かうべきなのに合成方向がそれてしまうことがある (「最終アプローチ」導入前は
  // ボールの手前20〜30px程度で選手が永久に足踏みする不具合につながっていた)。
  it('bug regression: ball attraction dominates outright once within final-approach range, even when home pull would otherwise win', () => {
    const home = { x: 168, y: 765 };
    const player = makePlayer(home.x - 300, home.y - 300, TeamId.A, 9); // homeから遠い(≈424px、far寄り)
    // ボールは選手からごく近い(60px)が、斜め方向でホームとも軸が競合する配置。
    const ballPos = { x: toFixed(home.x - 300 - 40), y: toFixed(home.y - 300 + 45) };
    const teamB = Array.from({ length: 11 }, (_, slot) => makePlayer(400, 100 + slot * 5, TeamId.B, slot));
    const direction = computeNonControlledDirection(player, [player, ...teamB], ballPos, FORMATIONS, 1, null, 'primary');
    // ボールは選手から見て左下(DownLeft)。最終アプローチが効いていれば、その方向寄りになるはず。
    expect([Direction8.DownLeft, Direction8.Down, Direction8.Left]).toContain(direction);
  });
});

describe('computeChaseRightIndices', () => {
  it('contested ball (possession null): each team gets primary + cover among field players, GKs excluded', () => {
    const gkA = makePlayer(240, 1764, TeamId.A, 0);
    const nearA = makePlayer(240, 900, TeamId.A, 1);
    const midA = makePlayer(240, 1100, TeamId.A, 2);
    const farA = makePlayer(0, 1700, TeamId.A, 3);
    const gkB = makePlayer(240, 36, TeamId.B, 0);
    const nearB = makePlayer(240, 910, TeamId.B, 1);
    const midB = makePlayer(240, 700, TeamId.B, 2);
    const farB = makePlayer(480, 40, TeamId.B, 3);
    const roster = [gkA, nearA, midA, farA, gkB, nearB, midB, farB];
    const ballPos = { x: toFixed(240), y: toFixed(905) };

    const chasers = computeChaseRightIndices(roster, ballPos, null);
    // 競り合い中は両チームとも守備側扱い=2人 (primary+cover)。GK(0,4)は対象外。
    expect(chasers.has(1)).toBe(true); // nearA
    expect(chasers.has(2)).toBe(true); // midA (cover)
    expect(chasers.has(5)).toBe(true); // nearB
    expect(chasers.has(6)).toBe(true); // midB (cover)
    expect(chasers.has(0)).toBe(false); // GK対象外
    expect(chasers.has(4)).toBe(false); // GK対象外
    expect(chasers.has(3)).toBe(false); // farA
    expect(chasers.has(7)).toBe(false); // farB
    expect(chasers.size).toBe(4);
  });

  it('the possessing team gets only 1 holder (retriever), the defending team gets 2 (press + cover)', () => {
    const a1 = makePlayer(240, 900, TeamId.A, 1);
    const a2 = makePlayer(240, 950, TeamId.A, 2);
    const b1 = makePlayer(240, 910, TeamId.B, 1);
    const b2 = makePlayer(240, 960, TeamId.B, 2);
    const roster = [a1, a2, b1, b2];
    const ballPos = { x: toFixed(240), y: toFixed(905) };
    const chasers = computeChaseRightIndices(roster, ballPos, TeamId.A);
    // 保持側A: 1人だけ。守備側B: 2人。
    expect(chasers.has(0)).toBe(true);
    expect(chasers.has(1)).toBe(false);
    expect(chasers.has(2)).toBe(true);
    expect(chasers.has(3)).toBe(true);
  });

  it('assigns primary to the lowest index among the selected pair (stable roles, no per-tick churn)', () => {
    const p0 = makePlayer(240, 950, TeamId.A, 1); // 2番目に近いが index最小
    const p1 = makePlayer(240, 910, TeamId.A, 2); // 最寄り
    const p2 = makePlayer(240, 1400, TeamId.A, 3); // 対象外
    const roster = [p0, p1, p2];
    const ballPos = { x: toFixed(240), y: toFixed(900) };
    const chasers = computeChaseRightIndices(roster, ballPos, null);
    // 選ばれた2人 {0,1} のうち、役割は距離ではなく最小indexに固定される (振動防止)。
    expect(chasers.get(0)).toBe('primary');
    expect(chasers.get(1)).toBe('cover');
    expect(chasers.has(2)).toBe(false);
  });

  it('near-equal distances resolve stably (48px bucket + index tiebreak)', () => {
    const tiedA = makePlayer(230, 900, TeamId.A, 1);
    const tiedB = makePlayer(250, 900, TeamId.A, 2);
    const roster = [tiedA, tiedB];
    const ballPos = { x: toFixed(240), y: toFixed(900) };
    const chasers = computeChaseRightIndices(roster, ballPos, TeamId.A); // 保持側=1人だけ
    expect(chasers.get(0)).toBe('primary'); // 同バケットなら小さいindex
    expect(chasers.has(1)).toBe(false);
  });

  it('is a pure function: identical inputs always produce an equal result', () => {
    const state = createInitialState(1);
    const a = computeChaseRightIndices(state.players, state.ball.pos, null);
    const b = computeChaseRightIndices(state.players, state.ball.pos, null);
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });

  it('does not throw against the real 22-player kickoff state', () => {
    const state = createInitialState(1);
    expect(() => computeChaseRightIndices(state.players, state.ball.pos, null)).not.toThrow();
  });
});

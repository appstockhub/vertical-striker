import { describe, expect, it } from 'vitest';
import { toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import type { Vec2Fixed } from '../../src/core/types';
import { computeSupportHomePosition, isSupportRunner } from '../../src/sim/supportRun';
import { computeNonControlledDirection } from '../../src/sim/teamAI';
import { TacklePhase } from '../../src/sim/state';
import type { PlayerState } from '../../src/sim/state';
import { TeamId, FormationId, depthFromOwnGoal } from '../../src/sim/formations';
import { Direction8 } from '../../src/input/types';

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

describe('isSupportRunner', () => {
  it('selects exactly SUPPORT_RUNNER_COUNT(3) slots per formation, ties resolve to lower slotIndex', () => {
    // 全4フォーメーションで検証: FW(depthFrac最大)から3枠、同値はslotIndex小優先
    const expected: Record<FormationId, number[]> = {
      // F442: FW slots 9,10 (0.85) + MF先頭 slot 5 (0.55)
      [FormationId.F442]: [5, 9, 10],
      // F433: FW slots 8,9,10 (0.85)
      [FormationId.F433]: [8, 9, 10],
      // F352: FW slots 9,10 (0.85) + MF先頭 slot 4 (0.5)
      [FormationId.F352]: [4, 9, 10],
      // F532: FW slots 9,10 (0.85) + MF先頭 slot 6 (0.5)
      [FormationId.F532]: [6, 9, 10],
    };
    for (const fid of Object.keys(expected) as FormationId[]) {
      const runners: number[] = [];
      for (let s = 1; s <= 10; s++) {
        if (isSupportRunner(s, fid)) runners.push(s);
      }
      expect(runners, fid).toEqual(expected[fid]);
    }
  });

  it('GK (slot 0) is never a support runner', () => {
    expect(isSupportRunner(0, FormationId.F442)).toBe(false);
  });
});

// half=1: Team A は南(y=1800側)を守り、北(y小)へ攻める。深度=1800-y。
describe('computeSupportHomePosition', () => {
  const lineHome: Vec2Fixed = { x: toFixed(168), y: toFixed(1035) }; // F442 FW slot9 の静的ホーム相当

  it('targets SUPPORT_AHEAD_STANDOFF(180px) beyond the quantized ball depth when that is ahead of the line home', () => {
    // ボールが深度800 (y=1000) → サポート深度 = 800(量子化) + 180 = 980
    const player = makePlayer(168, 1035, TeamId.A, 9);
    const ballPos: Vec2Fixed = { x: toFixed(240), y: toFixed(1000) };
    const home = computeSupportHomePosition(player, [player], lineHome, ballPos, 1);
    const depth = toFloat(depthFromOwnGoal(TeamId.A, 1, home.y));
    // 量子化(32px floor)のため 800-32 の帯 + 180
    expect(depth).toBeGreaterThanOrEqual(948);
    expect(depth).toBeLessThanOrEqual(980);
    // ラインホームの深度(765)より前方
    expect(depth).toBeGreaterThan(765);
  });

  it('caps the target depth at the opponent box edge (SUPPORT_MAX_DEPTH), never off-pitch', () => {
    // ボールが敵陣深く (深度1750、y=50) → 素の目標は1930でピッチ外。上限1650に頭打ち。
    const player = makePlayer(168, 400, TeamId.A, 9);
    const ballPos: Vec2Fixed = { x: toFixed(240), y: toFixed(50) };
    const home = computeSupportHomePosition(player, [player], lineHome, ballPos, 1);
    const depth = toFloat(depthFromOwnGoal(TeamId.A, 1, home.y));
    expect(depth).toBeLessThanOrEqual(1650);
    expect(toFloat(home.y)).toBeGreaterThanOrEqual(0);
  });

  it('never targets behind the line home (max() invariant)', () => {
    // ボールが自陣深く (深度100、y=1700) でも、サポート目標はラインホームより後ろに行かない
    const player = makePlayer(168, 1035, TeamId.A, 9);
    const ballPos: Vec2Fixed = { x: toFixed(240), y: toFixed(1700) };
    const home = computeSupportHomePosition(player, [player], lineHome, ballPos, 1);
    const depth = toFloat(depthFromOwnGoal(TeamId.A, 1, home.y));
    const lineDepth = toFloat(depthFromOwnGoal(TeamId.A, 1, lineHome.y));
    expect(depth).toBeGreaterThanOrEqual(lineDepth);
  });

  it('is deterministic and quantized: sub-grid ball movement does not change the target', () => {
    const player = makePlayer(168, 1035, TeamId.A, 9);
    const a = computeSupportHomePosition(player, [player], lineHome, { x: toFixed(240), y: toFixed(1001) }, 1);
    const b = computeSupportHomePosition(player, [player], lineHome, { x: toFixed(240), y: toFixed(1010) }, 1);
    expect(a).toEqual(b);
  });

  it('nudges X away from a too-close teammate, quantized to the 24px grid', () => {
    const player = makePlayer(168, 900, TeamId.A, 9);
    const closeTeammate = makePlayer(140, 900, TeamId.A, 10); // 28px左 (近すぎる)
    const ballPos: Vec2Fixed = { x: toFixed(240), y: toFixed(1000) };
    const withMate = computeSupportHomePosition(player, [player, closeTeammate], lineHome, ballPos, 1);
    const alone = computeSupportHomePosition(player, [player], lineHome, ballPos, 1);
    // 味方は左 → 右へずれる (X が単独時より大きい)
    expect(toFloat(withMate.x)).toBeGreaterThan(toFloat(alone.x));
    // 24pxグリッドに量子化されている
    expect(toFloat(withMate.x) % 24).toBeCloseTo(0, 5);
  });

  it('does not nudge X when the nearest teammate is far enough', () => {
    const player = makePlayer(168, 900, TeamId.A, 9);
    const farTeammate = makePlayer(400, 900, TeamId.A, 10); // 232px右 (十分遠い)
    const ballPos: Vec2Fixed = { x: toFixed(240), y: toFixed(1000) };
    const home = computeSupportHomePosition(player, [player, farTeammate], lineHome, ballPos, 1);
    const alone = computeSupportHomePosition(player, [player], lineHome, ballPos, 1);
    expect(home).toEqual(alone);
  });

  it('clamps X inside the pitch', () => {
    const edgeLineHome: Vec2Fixed = { x: toFixed(12), y: toFixed(1035) };
    const player = makePlayer(12, 900, TeamId.A, 9);
    const closeTeammate = makePlayer(36, 900, TeamId.A, 10); // 右24px → 左へずらされる
    const ballPos: Vec2Fixed = { x: toFixed(240), y: toFixed(1000) };
    const home = computeSupportHomePosition(player, [player, closeTeammate], edgeLineHome, ballPos, 1);
    expect(toFloat(home.x)).toBeGreaterThanOrEqual(24);
  });
});

describe('support run integration via computeNonControlledDirection', () => {
  // Team A FW (slot 9) が保持側 (possessionTeam=A)、追跡権なし、マークなし → サポート目標へ動く
  it('a possessing-team runner without chase rights moves toward the space ahead of the ball', () => {
    // ボール深度 1000 (y=800)。ライン押し上げ後のホームより前方100pxが目標になるはず。
    // 選手は静的ホーム (168,1035) に立つ → サポート目標 (深度1096+) へ前進 (Up) するはず。
    const player = makePlayer(168, 1035, TeamId.A, 9);
    const ballPos: Vec2Fixed = { x: toFixed(168), y: toFixed(800) };
    // 相手チームを後方に配置してオフサイドラインが邪魔しないようにする
    const teamB = Array.from({ length: 11 }, (_, slot) => makePlayer(400, 60 + slot * 6, TeamId.B, slot));
    const dir = computeNonControlledDirection(player, [player, ...teamB], ballPos, FORMATIONS, 1, TeamId.A, null, null);
    expect(dir).toBe(Direction8.Up);
  });

  // オンサイドクランプとの相互作用: オフサイドラインがボールのすぐ先にある場合、
  // サポート目標はラインの手前に頭打ちされ、ラインを大きく越えて走り込まない。
  it('the onside clamp caps the support target at the offside line', () => {
    // Team B の後ろから2人目 (=オフサイドライン) を y=700 に置く。ボール y=800。
    // 素のサポート目標は 800-100=700 より前 (y=700未満) だが、クランプで y>=line 付近に留まる。
    const player = makePlayer(168, 720, TeamId.A, 9); // ラインぎりぎりまで上がった状態
    const ballPos: Vec2Fixed = { x: toFixed(168), y: toFixed(800) };
    const teamB = [
      makePlayer(400, 60, TeamId.B, 0), // GK (最深)
      makePlayer(400, 700, TeamId.B, 1), // 2番目に深い = オフサイドライン y=700
      ...Array.from({ length: 9 }, (_, i) => makePlayer(400, 900 + i * 6, TeamId.B, i + 2)),
    ];
    const dir = computeNonControlledDirection(player, [player, ...teamB], ballPos, FORMATIONS, 1, TeamId.A, null, null);
    // ライン(700)+マージン範囲に立っている状態からさらに前 (Up) へは行かないはず
    expect(dir).not.toBe(Direction8.Up);
    expect(dir).not.toBe(Direction8.UpLeft);
    expect(dir).not.toBe(Direction8.UpRight);
  });
});

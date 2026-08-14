import { describe, expect, it } from 'vitest';
import { toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import type { Vec2Fixed } from '../../src/core/types';
import { computeMarkAssignments, computeMarkHomePosition } from '../../src/sim/marking';
import { createInitialState, TacklePhase } from '../../src/sim/state';
import type { PlayerState } from '../../src/sim/state';
import { TeamId, FormationId, getHomePosition, depthFromOwnGoal } from '../../src/sim/formations';
import { Direction8 } from '../../src/input/types';
import { MARK_STANDOFF_FIXED } from '../../src/sim/teamAIConstants';

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

/**
 * 22人フル編成を作るヘルパー (キックオフ配置ベース)。個々の選手を動かしたいテストは
 * オーバーライドのMapで位置を差し替える。
 */
function makeFullSquad(overridePos: ReadonlyMap<number, { x: number; y: number }> = new Map()): PlayerState[] {
  const state = createInitialState(1);
  return state.players.map((p, i) => {
    const o = overridePos.get(i);
    return o ? { ...p, pos: { x: toFixed(o.x), y: toFixed(o.y) } } : p;
  });
}

const FAR_BALL: Vec2Fixed = { x: toFixed(240), y: toFixed(900) }; // センターサークル (誰の除外圏にも掛からない基準点)

// half=1: Team A は南(y=1800側)を守り、Team B は北(y=0側)を守る。
// Team A の DF (slot 1-4) のホームは y≈1638。Team B の攻撃側侵入は y が大きい方向。
describe('computeMarkAssignments', () => {
  it('returns an empty map when linePossessionTeam is null (contested)', () => {
    const players = makeFullSquad();
    const result = computeMarkAssignments(players, null, 1, FORMATIONS, FAR_BALL);
    expect(result.size).toBe(0);
  });

  it('is deterministic: identical inputs produce identical maps', () => {
    // Team B の FW 2人 (index 20,21) を Team A 陣内へ侵入させる
    const overrides = new Map([
      [20, { x: 150, y: 1500 }],
      [21, { x: 330, y: 1450 }],
    ]);
    const players = makeFullSquad(overrides);
    const a = computeMarkAssignments(players, TeamId.B, 1, FORMATIONS, FAR_BALL);
    const b = computeMarkAssignments(players, TeamId.B, 1, FORMATIONS, FAR_BALL);
    expect([...a.entries()]).toEqual([...b.entries()]);
    expect(a.size).toBeGreaterThan(0);
  });

  it('only defending-team DF-line players become markers (never GK, never MF/FW)', () => {
    const overrides = new Map([
      [20, { x: 150, y: 1500 }],
      [21, { x: 330, y: 1450 }],
    ]);
    const players = makeFullSquad(overrides);
    // Team B が保持 → Team A (index 0-10) が守備側
    const result = computeMarkAssignments(players, TeamId.B, 1, FORMATIONS, FAR_BALL);
    expect(result.size).toBeGreaterThan(0);
    for (const [markerIdx] of result) {
      // Team A の DF は slotIndex 1-4 (= players index 1-4)
      expect(markerIdx).toBeGreaterThanOrEqual(1);
      expect(markerIdx).toBeLessThanOrEqual(4);
    }
  });

  it('assignments are 1:1 (no marker marks two targets, no target has two markers)', () => {
    // 侵入者4人 (Team B の MF/FW を Team A 陣内へ)
    const overrides = new Map([
      [17, { x: 80, y: 1400 }],
      [18, { x: 200, y: 1350 }],
      [20, { x: 300, y: 1500 }],
      [21, { x: 420, y: 1450 }],
    ]);
    const players = makeFullSquad(overrides);
    const result = computeMarkAssignments(players, TeamId.B, 1, FORMATIONS, FAR_BALL);
    const markers = [...result.keys()];
    const targets = [...result.values()];
    expect(new Set(markers).size).toBe(markers.length);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it('excludes opponents outside the defending half (quantized depth >= MARK_ZONE_DEPTH)', () => {
    // 侵入者なし: Team B 全員が自陣/中盤 (キックオフ配置のまま) → Team A から見て全員自陣外
    const players = makeFullSquad();
    const result = computeMarkAssignments(players, TeamId.B, 1, FORMATIONS, FAR_BALL);
    // Team A 陣内 (y > 900) にいる Team B 選手はキックオフ配置ではいない
    for (const p of players) {
      if (p.team === TeamId.B) expect(toFloat(p.pos.y)).toBeLessThanOrEqual(900);
    }
    expect(result.size).toBe(0);
  });

  it('excludes opponents near the ball (chase-right holders handle them)', () => {
    // 侵入者1人、ただしボールがその選手の足元にある (=キャリア)
    const overrides = new Map([[20, { x: 240, y: 1500 }]]);
    const players = makeFullSquad(overrides);
    const ballAtCarrier: Vec2Fixed = { x: toFixed(240), y: toFixed(1500) };
    const result = computeMarkAssignments(players, TeamId.B, 1, FORMATIONS, ballAtCarrier);
    expect(result.has(20)).toBe(false);
    expect([...result.values()]).not.toContain(20);
    // 同じ配置でもボールが遠ければマークされる (除外がボール距離によることの確認)
    const resultFarBall = computeMarkAssignments(players, TeamId.B, 1, FORMATIONS, FAR_BALL);
    expect([...resultFarBall.values()]).toContain(20);
  });

  it('assignment is stable under sub-bucket movement (moving a marker < 48px keeps the pairing)', () => {
    const overrides = new Map([
      [20, { x: 150, y: 1500 }],
      [21, { x: 330, y: 1450 }],
    ]);
    const players = makeFullSquad(overrides);
    const before = computeMarkAssignments(players, TeamId.B, 1, FORMATIONS, FAR_BALL);
    // マーカー1人 (before の最初のマーカー) を10pxだけ動かす → バケット(48px)内の微動
    const [firstMarker] = [...before.keys()];
    const moved = players.map((p, i) =>
      i === firstMarker ? { ...p, pos: { x: toFixed(toFloat(p.pos.x) + 10), y: p.pos.y } } : p,
    );
    const after = computeMarkAssignments(moved, TeamId.B, 1, FORMATIONS, FAR_BALL);
    expect([...after.entries()]).toEqual([...before.entries()]);
  });

  it('ties resolve to the lower marker index (deterministic tie-break)', () => {
    // 侵入者1人をDF2人 (index 1,2) から完全等距離に置く: DFのホームは y=1638、
    // x=72(slot1) と x=182(slot2) の中点 x=127 に侵入者を置く。
    const overrides = new Map([
      [1, { x: 72, y: 1638 }],
      [2, { x: 182, y: 1638 }],
      [20, { x: 127, y: 1500 }],
    ]);
    const players = makeFullSquad(overrides);
    const result = computeMarkAssignments(players, TeamId.B, 1, FORMATIONS, FAR_BALL);
    expect(result.get(1)).toBe(20); // 同バケット → index小 (1) が勝つ
    expect(result.has(2)).toBe(false);
  });

  it('danger order: the deeper intruder is assigned first (gets the overall-nearest marker pool first)', () => {
    // 侵入者2人: index 21 の方が Team A ゴールに近い (y=1600 > 1400)
    const overrides = new Map([
      [20, { x: 240, y: 1400 }],
      [21, { x: 240, y: 1600 }],
    ]);
    const players = makeFullSquad(overrides);
    const result = computeMarkAssignments(players, TeamId.B, 1, FORMATIONS, FAR_BALL);
    expect([...result.values()]).toContain(21);
    expect([...result.values()]).toContain(20);
    // 危険度順: 21 (深い) が先に走査され、より近いマーカーを先取りする。
    // 21 は y=1600 で DF ライン (y=1638) の目の前 → 最寄りDF (x=240に近い slot2 x=182 or slot3 x=298)
    const markerFor21 = [...result.entries()].find(([, t]) => t === 21)![0];
    const markerFor20 = [...result.entries()].find(([, t]) => t === 20)![0];
    const d21 = distPx(players[markerFor21]!.pos, players[21]!.pos);
    const d20 = distPx(players[markerFor20]!.pos, players[20]!.pos);
    expect(d21).toBeLessThanOrEqual(d20);
  });

  it('assigns for the correct team in half 2 (sides swapped)', () => {
    // half=2 では Team A が北(y=0側)を守る。キックオフ配置のTeam B選手 (y<900) は
    // half=2の座標系ではそのまま Team A 陣内の侵入者になる。
    const players = makeFullSquad();
    const result = computeMarkAssignments(players, TeamId.B, 2, FORMATIONS, FAR_BALL);
    expect(result.size).toBeGreaterThan(0);
    for (const [markerIdx, targetIdx] of result) {
      // マーカーは Team A の DF (index 1-4)、対象は Team A 陣内 (y<900) の Team B 選手
      expect(markerIdx).toBeGreaterThanOrEqual(1);
      expect(markerIdx).toBeLessThanOrEqual(4);
      expect(players[targetIdx]!.team).toBe(TeamId.B);
      expect(toFloat(players[targetIdx]!.pos.y)).toBeLessThan(900);
    }
  });
});

function distPx(a: Vec2Fixed, b: Vec2Fixed): number {
  const dx = toFloat(a.x) - toFloat(b.x);
  const dy = toFloat(a.y) - toFloat(b.y);
  return Math.hypot(dx, dy);
}

describe('computeMarkHomePosition', () => {
  it('places the home goal-side of the target by the standoff (Team A defends south in half 1)', () => {
    const target: Vec2Fixed = { x: toFixed(240), y: toFixed(1500) };
    const home = computeMarkHomePosition(target, TeamId.A, 1);
    // Team A の自ゴールは y=1800 側 → ホームは対象より y が大きい (ゴール側)
    expect(toFloat(home.y)).toBeGreaterThan(toFloat(target.y));
    const depthTarget = toFloat(depthFromOwnGoal(TeamId.A, 1, target.y));
    const depthHome = toFloat(depthFromOwnGoal(TeamId.A, 1, home.y));
    // 量子化(24px floor)を挟むため、深度差は standoff ± グリッド1段の範囲
    const standoff = toFloat(MARK_STANDOFF_FIXED);
    expect(depthTarget - depthHome).toBeGreaterThanOrEqual(standoff - 24);
    expect(depthTarget - depthHome).toBeLessThanOrEqual(standoff + 24);
  });

  it('quantizes: a sub-grid (<24px) target move does not change the home', () => {
    const a = computeMarkHomePosition({ x: toFixed(241), y: toFixed(1501) }, TeamId.A, 1);
    const b = computeMarkHomePosition({ x: toFixed(250), y: toFixed(1510) }, TeamId.A, 1);
    expect(a).toEqual(b);
  });

  it('clamps the standoff at the goal line (depth never goes negative)', () => {
    const target: Vec2Fixed = { x: toFixed(240), y: toFixed(1790) }; // Team A ゴール目前
    const home = computeMarkHomePosition(target, TeamId.A, 1);
    expect(toFloat(home.y)).toBeLessThanOrEqual(1800);
    expect(toFloat(depthFromOwnGoal(TeamId.A, 1, home.y))).toBeGreaterThanOrEqual(0);
  });

  it('works with mirrored geometry for the north-defending team', () => {
    const target: Vec2Fixed = { x: toFixed(240), y: toFixed(300) };
    const home = computeMarkHomePosition(target, TeamId.B, 1);
    // Team B の自ゴールは y=0 側 → ホームは対象より y が小さい
    expect(toFloat(home.y)).toBeLessThan(toFloat(target.y));
  });
});

describe('static marker eligibility sanity (uses real formation data)', () => {
  it('DF home depth is under the marker threshold and MF is over it, for all formations', () => {
    for (const fid of [FormationId.F442, FormationId.F433, FormationId.F352, FormationId.F532]) {
      // slot 1 は必ずDF、slot 6 は全フォーメーションでMF帯 (depthFrac 0.5-0.55)
      const dfHome = getHomePosition(TeamId.A, 1, fid, 1);
      const mfHome = getHomePosition(TeamId.A, 6, fid, 1);
      expect(toFloat(depthFromOwnGoal(TeamId.A, 1, dfHome.y))).toBeLessThanOrEqual(315);
      expect(toFloat(depthFromOwnGoal(TeamId.A, 1, mfHome.y))).toBeGreaterThan(315);
    }
  });
});

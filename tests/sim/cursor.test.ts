import { describe, expect, it } from 'vitest';
import { toFixed, ZERO_FIXED } from '../../src/core/fixed';
import { isTeamAInPossession, resolveCursor, selectPassTarget } from '../../src/sim/cursor';
import { TeamId } from '../../src/sim/formations';
import { TacklePhase, type PlayerState } from '../../src/sim/state';
import { Direction8, emptyButtonState } from '../../src/input/types';

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

/** 22人ぶんのダミー配列 (Team A 0-10, Team B 11-21) を、指定indexだけ上書きして作る。 */
function makeRoster(overrides: Record<number, PlayerState>): PlayerState[] {
  const roster: PlayerState[] = [];
  for (let i = 0; i < 22; i++) {
    if (overrides[i]) {
      roster.push(overrides[i]);
      continue;
    }
    const team = i < 11 ? TeamId.A : TeamId.B;
    const slot = i < 11 ? i : i - 11;
    // デフォルトは遠く離れた位置に置く (ドリブル半径に絶対入らないように)
    roster.push(makePlayer(1000 + i * 50, 1000, team, slot));
  }
  return roster;
}

describe('isTeamAInPossession', () => {
  it('is true for indices 0..10, false otherwise (including null)', () => {
    expect(isTeamAInPossession(0)).toBe(true);
    expect(isTeamAInPossession(10)).toBe(true);
    expect(isTeamAInPossession(11)).toBe(false);
    expect(isTeamAInPossession(21)).toBe(false);
    expect(isTeamAInPossession(null)).toBe(false);
  });
});

describe('selectPassTarget', () => {
  it('picks the nearest teammate within the forward cone and range', () => {
    const carrier = makePlayer(0, 0, TeamId.A, 1, { facing: Direction8.Up });
    const near = makePlayer(0, -50, TeamId.A, 2); // 真前、近い
    const far = makePlayer(0, -150, TeamId.A, 3); // 真前、遠い
    const roster = makeRoster({ 1: carrier, 2: near, 3: far });
    expect(selectPassTarget(1, roster)).toBe(2);
  });

  it('excludes teammates behind the carrier', () => {
    const carrier = makePlayer(0, 0, TeamId.A, 1, { facing: Direction8.Up });
    const behind = makePlayer(0, 50, TeamId.A, 2); // facing=Up (北)なのに南側=背後
    const roster = makeRoster({ 1: carrier, 2: behind });
    expect(selectPassTarget(1, roster)).toBeNull();
  });

  it('excludes teammates outside the max range', () => {
    const carrier = makePlayer(0, 0, TeamId.A, 1, { facing: Direction8.Up });
    const tooFar = makePlayer(0, -1000, TeamId.A, 2);
    const roster = makeRoster({ 1: carrier, 2: tooFar });
    expect(selectPassTarget(1, roster)).toBeNull();
  });

  it('excludes teammates outside the forward cone even if closer', () => {
    const carrier = makePlayer(0, 0, TeamId.A, 1, { facing: Direction8.Up });
    // ほぼ真横 (コーンの60°半角の外側になるよう大きくx方向にずらす)
    const sideways = makePlayer(150, -20, TeamId.A, 2);
    const roster = makeRoster({ 1: carrier, 2: sideways });
    expect(selectPassTarget(1, roster)).toBeNull();
  });

  it('works for Team B carriers too (Phase 3 milestone 6: search range derives from carrier.team)', () => {
    const carrier = makePlayer(0, 0, TeamId.B, 1, { facing: Direction8.Up }); // index 12
    const near = makePlayer(0, -50, TeamId.B, 2); // index 13、同じTeam B、前方、近い
    const roster = makeRoster({ 12: carrier, 13: near });
    expect(selectPassTarget(12, roster)).toBe(13);
  });
});

describe('resolveCursor', () => {
  const buttonsY = { ...emptyButtonState(), Y: true };
  const buttonsNone = emptyButtonState();

  it('snaps control to whoever on Team A holds the ball, even if not currently controlled', () => {
    const roster = makeRoster({});
    // touchPriorityIndex=3 (Team A) だが現在の操作対象は0
    const result = resolveCursor(roster, 0, 3, { x: ZERO_FIXED, y: ZERO_FIXED }, buttonsNone, buttonsNone);
    expect(result.controlledPlayerIndex).toBe(3);
    expect(result.passTriggered).toBe(false);
  });

  it('triggers a pass on Y-edge when Team A holds the ball and a valid target exists', () => {
    const carrier = makePlayer(0, 0, TeamId.A, 1, { facing: Direction8.Up });
    const receiver = makePlayer(0, -50, TeamId.A, 2);
    const roster = makeRoster({ 1: carrier, 2: receiver });
    const result = resolveCursor(roster, 1, 1, { x: ZERO_FIXED, y: ZERO_FIXED }, buttonsY, buttonsNone);
    expect(result.controlledPlayerIndex).toBe(1);
    expect(result.passTriggered).toBe(true);
    expect(result.passTargetIndex).toBe(2);
  });

  it('does not trigger a pass on Y-hold (only on the rising edge)', () => {
    const carrier = makePlayer(0, 0, TeamId.A, 1, { facing: Direction8.Up });
    const receiver = makePlayer(0, -50, TeamId.A, 2);
    const roster = makeRoster({ 1: carrier, 2: receiver });
    // prevButtons.Y も true -> エッジではない
    const result = resolveCursor(roster, 1, 1, { x: ZERO_FIXED, y: ZERO_FIXED }, buttonsY, buttonsY);
    expect(result.passTriggered).toBe(false);
  });

  it('auto-follows the nearest Team A outfield player to the ball when Team A does not have it', () => {
    const controlled = makePlayer(0, 0, TeamId.A, 1);
    const nearer = makePlayer(0, 100, TeamId.A, 2); // controlled(dist=1000) より圧倒的に近い
    const ballPos = { x: ZERO_FIXED, y: toFixed(120) };
    const roster = makeRoster({ 1: controlled, 2: nearer });
    // touchPriorityIndex は Team B (15) が保持 -> Team A は非保持
    const result = resolveCursor(roster, 1, 15, ballPos, buttonsNone, buttonsNone);
    expect(result.controlledPlayerIndex).toBe(2);
  });

  it('does not flicker when the distance difference is within the hysteresis margin', () => {
    // controlledがボールから距離10、候補がわずか1px近い距離9。
    // 距離の二乗では 81 vs 100 (差19) だが、マージン(二乗25)未満の差では切り替わらない設計を確認する。
    const controlled = makePlayer(0, 10, TeamId.A, 1);
    const almostCloser = makePlayer(0, 9, TeamId.A, 2);
    const ballPos = { x: ZERO_FIXED, y: ZERO_FIXED };
    const roster = makeRoster({ 1: controlled, 2: almostCloser });
    const result = resolveCursor(roster, 1, null, ballPos, buttonsNone, buttonsNone);
    expect(result.controlledPlayerIndex).toBe(1); // 僅差なので切り替わらない
  });

  it('★仕様変更★ 守備中のYはカーソルを切り替えない (Yはショルダータックル用に明け渡す)', () => {
    // 旧テストは「Y edgeで最寄り候補へ手動切替」を期待していたが、これはPhase 2の仮実装。
    // 公式説明書では守備時のYはショルダータックルで、ボタンによる手動の選手切替は存在しない
    // (CLAUDE.md「実装ギャップ」4)。仮実装が残っていたため実プレイで「Yを押しても
    // チャージが出ず操作対象が飛ぶ」不具合になっていた。切り替わらないことを回帰として固定する。
    const controlled = makePlayer(0, 0, TeamId.A, 1);
    const nearest = makePlayer(0, 10, TeamId.A, 2);
    const ballPos = { x: ZERO_FIXED, y: ZERO_FIXED };
    const roster = makeRoster({ 1: controlled, 2: nearest });
    const result = resolveCursor(roster, 1, null, ballPos, buttonsY, buttonsNone);
    expect(result.controlledPlayerIndex).toBe(1);
    expect(result.passTriggered).toBe(false);
  });

  it('does not switch or pass while the controlled player is charging a kick', () => {
    const charging = makePlayer(0, 0, TeamId.A, 1, { kickChargeFrames: 5 });
    const nearer = makePlayer(0, 10, TeamId.A, 2);
    const ballPos = { x: ZERO_FIXED, y: ZERO_FIXED };
    const roster = makeRoster({ 1: charging, 2: nearer });
    const result = resolveCursor(roster, 1, null, ballPos, buttonsY, buttonsNone);
    expect(result.controlledPlayerIndex).toBe(1);
    expect(result.passTriggered).toBe(false);
  });

  it('breaks exact-tie candidate distances by the lowest index (自動追従の同点処理)', () => {
    // 手動切替(Y)を廃止したため、同点タイブレークは自動追従の経路で検証する。
    // 現在の操作選手(1)をボールから遠くに置き、同距離のtiedA(2)/tiedB(3)のどちらが
    // 選ばれるかを見る -> 昇順走査+strict `<` により小さいindexの2が勝つ。
    const controlled = makePlayer(0, 200, TeamId.A, 1);
    const tiedA = makePlayer(-10, 0, TeamId.A, 2);
    const tiedB = makePlayer(10, 0, TeamId.A, 3);
    const ballPos = { x: ZERO_FIXED, y: ZERO_FIXED };
    const roster = makeRoster({ 1: controlled, 2: tiedA, 3: tiedB });
    const result = resolveCursor(roster, 1, null, ballPos, buttonsNone, buttonsNone);
    expect(result.controlledPlayerIndex).toBe(2);
  });
});

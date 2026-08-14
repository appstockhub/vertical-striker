/**
 * mulberry32 — seed 付き決定論的 PRNG。
 *
 * 状態はモジュール内に保持せず、呼び出し元 (GameState.rngState) が持ち回る。
 * これにより GameState を丸ごとスナップショットするだけで RNG のストリーム位置も
 * 一緒に保存/復元できる (将来のリプレイ/ロールバックネットコードのため)。
 *
 * Math.imul は ECMA-262 上 32bit 整数演算として仕様上厳密に定義されているため、
 * 処理系間で bit-exact な決定論が保証される。ゲームロジックで Math.random() は
 * 一切使用しないこと。
 */

export type RngState = number; // uint32 として扱う

export function createRng(seed: number): RngState {
  return seed | 0;
}

/** 次の uint32 乱数値と、次に渡すべき state を返す。 */
export function nextUint32(state: RngState): [value: number, next: RngState] {
  const nextState = (state + 0x6d2b79f5) | 0;
  let t = nextState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = (t ^ (t >>> 14)) >>> 0;
  return [value, nextState];
}

/** [0, 1) の浮動小数点値。ゲームプレイのロジック分岐には使わず、演出用途に限定すること。 */
export function nextFloat01(state: RngState): [value: number, next: RngState] {
  const [raw, next] = nextUint32(state);
  return [raw / 0x100000000, next];
}

/** [minIncl, maxExcl) の整数値を返す。 */
export function nextRangeInt(
  state: RngState,
  minIncl: number,
  maxExcl: number,
): [value: number, next: RngState] {
  const [raw, next] = nextUint32(state);
  const span = maxExcl - minIncl;
  return [minIncl + (raw % span), next];
}

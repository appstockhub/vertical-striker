// 決定論的な物理演算のための固定小数点型。
// 1 = 1/256 ピクセル (8bit サブピクセル精度)。整数演算のみで完結させる。

declare const FIXED_BRAND: unique symbol;

/** 1/256 px 単位の整数座標値。branded type にして生の number と混同しないようにする。 */
export type Fixed = number & { readonly [FIXED_BRAND]: true };

export interface Vec2Fixed {
  readonly x: Fixed;
  readonly y: Fixed;
}

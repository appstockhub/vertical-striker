import { describe, expect, it } from 'vitest';
import { computePlayerSkeleton, ANIM_FRAME_COUNT } from '../../src/render/playerSprites';

/**
 * 選手スプライトの人体比率の回帰ゲート (23周目 1-C)。
 *
 * 経緯: 22周目にCC0素材 (2頭身のデフォルメ体型) と並べた比較で、ユーザーから
 * 「頭身が猿のよう」との指摘。実測すると当時の自作スプライトは **4.20頭身** で、
 * 目分量の見積もり (約6頭身と思っていた) が外れていた。
 * 数値で決めた比率が、今後の描画変更でなし崩しに崩れないよう固定する。
 *
 * 描画そのもの (Phaser Graphics) はnodeでは動かせないので、骨格の算出を純関数
 * `computePlayerSkeleton` へ切り出し、そちらを検証している。
 */
describe('選手スプライトの人体比率', () => {
  const OUTFIELD_H = 46;
  const GK_H = 51;

  it('フィールドプレイヤーは7〜7.5頭身に収まる (人間らしい体型の要件)', () => {
    const sk = computePlayerSkeleton(OUTFIELD_H);
    expect(sk.headsTall).toBeGreaterThanOrEqual(7.0);
    expect(sk.headsTall).toBeLessThanOrEqual(7.5);
  });

  it('GKも同じ比率になる (キャンバス寸法が違っても体型は変わらない)', () => {
    const outfield = computePlayerSkeleton(OUTFIELD_H);
    const gk = computePlayerSkeleton(GK_H);
    expect(gk.headsTall).toBeCloseTo(outfield.headsTall, 6);
  });

  it('関節が頭頂→接地の順に並び、どれも逆転しない', () => {
    const sk = computePlayerSkeleton(OUTFIELD_H);
    const order = [
      sk.topY,
      sk.headCenterY,
      sk.chinY,
      sk.shoulderY,
      sk.waistY,
      sk.hipY,
      sk.shortsHemY,
      sk.kneeY,
      sk.sockTopY,
      sk.ankleY,
      sk.groundY,
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i]!).toBeGreaterThan(order[i - 1]!);
    }
  });

  it('短パンの裾はソックスの上端より上にある (素肌の脛が見える = 3色の帯として読める)', () => {
    const sk = computePlayerSkeleton(OUTFIELD_H);
    expect(sk.shortsHemY).toBeLessThan(sk.sockTopY);
    // 素肌の区間が潰れていないこと (最低でも頭の直径の半分ぶん)
    expect(sk.sockTopY - sk.shortsHemY).toBeGreaterThan(sk.headDiameter * 0.5);
  });

  it('肩幅が頭幅の約2倍 (人体の目安。これを外すと寸胴/なで肩に見える)', () => {
    const sk = computePlayerSkeleton(OUTFIELD_H);
    const shoulderWidth = sk.shoulderHalfWidth * 2;
    expect(shoulderWidth / sk.headDiameter).toBeGreaterThanOrEqual(1.8);
    expect(shoulderWidth / sk.headDiameter).toBeLessThanOrEqual(2.2);
  });

  it('走行の歩幅が脚の長さに対して十分ある (走って見えるための最低量)', () => {
    const sk = computePlayerSkeleton(OUTFIELD_H);
    const legLength = sk.groundY - sk.hipY;
    // 足は前後に strideLength ずつ振れるので、1歩の見た目の幅はその2倍。
    const footTravel = sk.strideLength * 2;
    expect(footTravel / legLength).toBeGreaterThanOrEqual(0.6);
    // 開きすぎると「股裂き」に見えるので上限も置く。
    expect(footTravel / legLength).toBeLessThanOrEqual(1.0);
  });

  it('走行アニメは4フレームの標準ランサイクル', () => {
    expect(ANIM_FRAME_COUNT).toBe(4);
  });

  it('図の高さがキャンバスに収まる (頭が上端で切れない)', () => {
    const sk = computePlayerSkeleton(OUTFIELD_H);
    expect(sk.topY).toBeGreaterThan(0);
    expect(sk.groundY).toBeLessThan(OUTFIELD_H);
  });
});

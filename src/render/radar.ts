/**
 * レーダー(ミニマップ)のレイアウト計算 (純関数)。
 * ピッチ全体が常にレーダー枠に収まるようズーム率を決める。
 */

export interface RadarLayout {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
}

export function computeRadarLayout(
  viewportWidth: number,
  pitchWidth: number,
  pitchHeight: number,
  radarWidth: number,
  margin: number,
): RadarLayout {
  const zoom = radarWidth / pitchWidth;
  const height = pitchHeight * zoom;
  const x = viewportWidth - radarWidth - margin;
  const y = margin;
  return { x, y, width: radarWidth, height, zoom };
}

# HANDOFF

## 現在の状態
- 2026-08-14: Phase 0 実装完了。Vite + TypeScript + Phaser 3 のスキャフォールド、固定タイムステップループ、決定論ユーティリティ(固定小数点/mulberry32)、入力抽象化(Gamepad/Keyboard→SFC論理ボタン+8方向)、縦スクロールカメラ、レーダー骨格、仮選手1体+ボール1個を実装。
- `npm run test`(vitest 30件)・`npm run check:determinism`・`npm run build`いずれも成功。Browser previewでキーボード操作(矢印キー)による8方向移動・ピッチ境界クランプ・レーダー連動・縦カメラ追従を確認済み。
- 計画書: `.claude/plans/claude-md-cheerful-cookie.md`(承認済み)にPhase 0の設計判断と要検証仮定を記録。

## 次にやること
- Phase 1（ボールと1選手: ドリブル/キック/ボール物理）に着手。
- **ユーザー側での実機確認が必要**: Xbox系ゲームパッド接続時のオーバーレイ表示、十字キー/左スティック両方での8方向入力、B/Y/A/X/L/Rの配置が正しいか(特にX→Xbox Yは対称性からの推測)。

## 申し送り
- モデル設定は opusplan。設計判断を伴うタスクは必ず Plan Mode（Shift+Tab）で開始する。
- 決定論の鉄則: `src/sim/**` は `phaser` を import しない、`Math.random/sin/cos/atan2` を使わない。`npm run check:determinism` で機械的にチェックされる。
- Phase 0 で仮決めした値（要調整、CLAUDE.mdの「要検証仕様」と同様の性質）:
  - ピッチ/ビューポート寸法（480×720 / 480×1800）
  - カメラの先読みオフセット定数、追従イージング係数
  - レーダーのサイズ・配置（右上・幅22%）
  - アナログスティックのデッドゾーン(0.35)
  - プレイヤー移動速度
  - キーボードのSFCボタン仮割り当て(Z/X/C/V/Q/E → B/A/Y/X/L/R)

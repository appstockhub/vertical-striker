# HANDOFF

最終更新: 2026-08-14

## 1. 完了した作業

- **Phase 1 実装完了**（ドリブル・キック(速度軸+弾道軸)・ロングドリブル(L/R)・ボール物理(重力/バウンド/転がり摩擦/疑似3D高さ)・カメラのボール追従切替）
  - スコープはユーザー承認済み: 精密照準軸(L/R+キック)とカーブ/バックスピン(キック後入力)は今回**対象外**（後続フェーズに委譲）
  - `src/sim/state.ts`: `BallState`に`height`/`zVel`、`PlayerState`に`kickChargeFrames`を追加。`Inputs`型は変更なし（キック溜め時間などtickをまたぐ状態はGameState側で保持）
  - `src/sim/dribble.ts`（新規）: `isNearBall`(sqrt不要の距離二乗判定)・`applyDribbleTouch`(吸着させず触れると転がる)・`isLongDribbleActive`
  - `src/sim/kick.ts`（新規）: `updateKickCharge`(純粋な整数カウンタでedge検出、Inputsへのbuttons Pressed追加は不要と判断)・`applyKick`(速度軸+弾道軸)
  - `src/sim/ballPhysics.ts`（新規）: `stepBallPhysics`(重力・バウンド・転がり摩擦)・`clampToPitchBounds`(プレイヤー/ボール共用)
  - `src/sim/ballConstants.ts`（新規）: Phase 1関連定数（すべて仮値、プレイテスト前提）
  - `src/core/fixed.ts`: `lerpFixed`追加
  - `src/render/`: 疑似3D描画（影+高さリフト）、カメラ追従先をプレイヤー→ボールに切替（Phase 0の`camera.ts`docコメント通り1箇所の差し替えで対応）
  - **設計時に発見・修正した重要なバグ**: 重力を無条件適用すると静止球が起動直後から無限バウンドし続ける問題を発見。空中判定(`height>0 || zVel>0`)でゲートし、着地速度が閾値未満なら跳ねずに静止させる形に修正。回帰テストを追加済み
  - テスト: 32件追加（既存30件+新規32件=**62件**）、うち上記バグの回帰テストを含む。`npm run test` / `npm run check:determinism` / `npm run build` すべて成功
  - Browser preview で動作確認: キーボード操作（矢印+Z=B等）でドリブル/長押しキック/ロングドリブルを実行し、コンソールエラー無し・canvasが入力に反応して変化し・キック後は数秒でぴたりと静止（無限バウンド無し）を確認。**このセッションではBrowser paneのスクリーンショット機能が一時的に利用不可**だったため、目視のスクリーンショットではなく、canvas の `toDataURL()` 差分比較（入力に反応して変化→着地後は完全に静止）とコンソール監視で機能確認した
  - コミット未実施（下記参照）

## 2. 進行中の作業と正確な現状

- 実装・自動検証は完了。ローカルの変更はまだコミットしていない（Phase 0と同様「mainに直接コミット」の運用のため、次のアクションとしてコミットが必要）。
- ゲームパッド実機での目視確認（下記4参照）はユーザー側で未実施。

## 3. 次にやるべきこと（優先順）

1. このセッションの変更を`main`にコミットする（Phase 0と同じ運用）。ユーザーからの明示的な依頼を待って実施する。
2. コミット後、`phase-1`タグを打ってpushするかはユーザーに確認する（Phase 0では別途明示的に依頼された）。
3. **ユーザー側での目視確認を推奨**: 実際にBrowser（またはゲームパッド実機）でドリブル・キックの弾道の高さ・バウンドの跳ね返り具合・ロングドリブルの手触りを見て、`src/sim/ballConstants.ts`の仮値（キック速度・重力・摩擦係数等）を調整してほしい。このセッションではスクリーンショットが取得できず、動作ロジックの正しさはテスト+canvas差分で確認したのみで、見た目の「気持ちよさ」は未評価
4. Phase 1完了後、CLAUDE.mdの段階開発計画に従い Phase 2（11 vs 11とチームAI）に着手。ただしPhase 1で対象外とした精密照準軸・カーブ/バックスピンをPhase 2着手前に追加するかは要相談（CLAUDE.mdの「操作仕様」は確定仕様として明記されているため、いずれかのタイミングで実装が必要）

## 4. 未解決の課題・ユーザー判断待ち

- **精密照準軸(L/R+キックで4→8方向)とカーブ/バックスピン(キック後入力)をいつ実装するか**: 今回のPhase 1では意図的に対象外とした（ユーザー承認済みのスコープ決定）。CLAUDE.mdの「操作仕様」は確定仕様として位置づけられているため、後続フェーズでの実装タイミングを決める必要がある
- Phase 0から持ち越し: 実機ゲームパッドでのB/Y/A/X/L/R配置確認（特にX→Xbox Y割り当て）は依然未確認
- Phase 1の新規定数（キック速度・重力・バウンド減衰・摩擦係数・ドリブル半径等、`src/sim/ballConstants.ts`）はすべて仮値。実機/プレイテストでの調整が必要

## 5. 重要な決定事項と理由

計画書（`.claude/plans/claude-md-cheerful-cookie.md`、ユーザー承認済み）に詳細あり。要点:

- **キックのスコープを速度軸+弾道軸+ロングドリブルに限定**（精密照準・カーブは対象外）。理由: CLAUDE.mdの「要検証仕様」にある未確定値（後入力受付フレーム数20f仮、4→8方向か8→16方向か）に依存せず、Phase 0の決定論基盤に無理なく積み増せる範囲に収めるため（ユーザー承認済み）
- **`Inputs`型は変更しない**。キック溜め時間などtickをまたぐ状態はすべて`GameState`(`PlayerState.kickChargeFrames`)側に持たせ、前tickの蓄積値と今tickの`inputs.buttons.B`を比較するだけで立ち上がり/立ち下がり両方を導出する設計にした。`InputFrame.buttonsPressed`(edge情報)を`Inputs`に追加する必要が無くなり、sim/を入力層の詳細から切り離せる
- **ドリブルタッチは「上書き」方式**（加算ではない）。毎tick再適用されても速度が際限なく積み上がらず、「触れるたびに少し前に転がる→追いつく→また転がる」というリズムを生む
- **ボール近接判定はsqrtを使わず距離の二乗比較**。キック方向も既存の事前正規化済み`DIRECTION_VECTORS`をそのまま流用（精密照準対象外のためnormalize不要）。結果として`Math.sqrt`はPhase 1全体で未使用、`scripts/checkDeterminism.mjs`の変更は不要だった
- **重力は空中(`height>0`または`zVel>0`)の場合のみ適用し、着地速度が閾値未満ならバウンドさせず静止させる**。設計段階で「重力を無条件適用すると静止球が無限バウンドする」バグを発見し、この形に修正した（詳細は上記1参照、回帰テスト追加済み）
- **壁（ピッチ境界）は位置クランプのみで速度反射は行わない**。上下=地面のみバウンドをモデル化する（水平方向のバウンドは今回対象外）
- Phase 1の新規定数はすべて仮値（Phase 0の`PLAYER_SPEED_FIXED`等と同じ扱い）

## 6. 変更ファイル一覧（このセッションで作成・変更、未コミット）

**新規**: `src/sim/ballConstants.ts` / `src/sim/ballPhysics.ts` / `src/sim/dribble.ts` / `src/sim/kick.ts` / `tests/sim/ballPhysics.test.ts` / `tests/sim/dribble.test.ts` / `tests/sim/kick.test.ts`

**変更**: `src/sim/state.ts`(BallState/PlayerState拡張) / `src/sim/update.ts`(パイプライン組み込み) / `src/sim/constants.ts`(`ENTITY_RADIUS_FIXED`→`PLAYER_RADIUS_FIXED`改称) / `src/core/fixed.ts`(`lerpFixed`追加) / `src/render/fixedToPixel.ts`(`ballLiftPx`追加) / `src/render/PitchScene.ts`(影描画・高さ反映・カメラ追従先変更) / `tests/core/fixed.test.ts`(`lerpFixed`テスト追加) / `tests/sim/update.test.ts`(Phase 1統合テスト追加) / `HANDOFF.md`(本ファイル)

## 申し送り

- モデル設定は opusplan。設計判断を伴うタスクは必ず Plan Mode（Shift+Tab）で開始する。
- リポジトリ: `origin` = `https://github.com/appstockhub/vertical-striker.git`。`main` ブランチに直接コミットする運用（ユーザー承認済み、Phase 0から継続）。
- タグ: `phase-0`は作成・push済み。`phase-1`は本セッションではまだ作成していない。

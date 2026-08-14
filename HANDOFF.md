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
  - コミット済み（`fa15a49`）

- **表示不具合の修正**（ユーザーがブラウザで実際に確認して報告、コミット`157b7ca`）
  - **キャンバスが画面中央ではなく右寄りに表示され、左に黒い余白ができる不具合を修正**: `#game-root`(Phaser のマウント先)にCSSの明示的なサイズ指定が無く、中身のcanvasサイズに合わせて縮む(shrink-to-fit)状態だった。Phaser の `Scale.FIT + CENTER_BOTH` はこの親要素の実測サイズを基準にレターボックス/中央寄せを計算するため、これが原因で中央寄せが崩れていた。`#game-root`に`width:100%;height:100%`を指定して解消。`getBoundingClientRect()`で左右マージンがほぼ等しくなる(141px対142px)ことを直接確認済み
  - **「ペナルティエリアの白線がピッチ右端からはみ出す」報告**: 上記と同じ根本原因（キャンバスの中央寄せが崩れていたことで、ピッチ自体の境界線が正しい位置に見えなかった）と考えられる。なお現状ペナルティエリアという専用の描画は無く、ユーザーが見ていたのはピッチ全体の境界線＋横の目印線（`buildPitch()`の白いストローク）
  - **「ゴールが描画されていない」報告**: 不具合ではなく仕様通り。ゴールの描画はCLAUDE.mdの段階開発計画で **Phase 3**（ルール実装: ゴール・スローイン・ゴールキック等）に位置づけられており、Phase 0/1では未実装
  - 選手・ボールの視認性向上: 半径を拡大（ボール7→10px、プレイヤー12→16px）、プレイヤー色をボール(白)と紛れない橙赤(`0xff5a1f`)に変更、両者に縁取りを追加してピッチの緑との境界を明確化。レーダードットのサイズ・色も追従
  - **検証について**: このセッション中、Browser paneが終始「非表示/非コンポジット」状態(`document.hidden === true`が新規タブでも解消しない)で、スクリーンショットもcanvasの目視確認も継続的にはできなかった。中央寄せの修正自体は`getBoundingClientRect()`によるDOMレイアウト計算（描画のコンポジットに依存しない、確実な検証手段）で正しさを確認済み。選手・ボールの拡大/配色変更はTypeScript型チェック・既存テストスイート通過・実行時エラー無しまでは確認したが、**見た目の最終確認はできていない**。ユーザーに実際のブラウザでの再確認を依頼したい

## 2. 進行中の作業と正確な現状

- Phase 1実装・表示不具合修正ともにコミット済み（`main`、`fa15a49`→`157b7ca`）。push/タグは未実施。
- ゲームパッド実機での目視確認（下記4参照）はユーザー側で未実施。
- **表示修正の見た目確認をユーザーに依頼中**（上記1参照。センタリングはDOM計算で確認済みだが、実際の見え方は未確認）。

## 3. 次にやるべきこと（優先順）

1. **ユーザーに表示修正後の見た目を確認してもらう**: 中央寄せが直っているか、選手/ボールが見やすくなっているか
2. `main`へのpush、`phase-1`タグの作成・pushをユーザーに確認する（Phase 0では別途明示的に依頼された）
3. ゲームパッド実機でのB/Y/A/X/L/R配置・ドリブル/キックの手触り確認をユーザーに依頼
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

## 6. 変更ファイル一覧

**Phase 1実装コミット (`fa15a49`) — 新規**: `src/sim/ballConstants.ts` / `src/sim/ballPhysics.ts` / `src/sim/dribble.ts` / `src/sim/kick.ts` / `tests/sim/ballPhysics.test.ts` / `tests/sim/dribble.test.ts` / `tests/sim/kick.test.ts`

**Phase 1実装コミット (`fa15a49`) — 変更**: `src/sim/state.ts`(BallState/PlayerState拡張) / `src/sim/update.ts`(パイプライン組み込み) / `src/sim/constants.ts`(`ENTITY_RADIUS_FIXED`→`PLAYER_RADIUS_FIXED`改称) / `src/core/fixed.ts`(`lerpFixed`追加) / `src/render/fixedToPixel.ts`(`ballLiftPx`追加) / `src/render/PitchScene.ts`(影描画・高さ反映・カメラ追従先変更) / `tests/core/fixed.test.ts`(`lerpFixed`テスト追加) / `tests/sim/update.test.ts`(Phase 1統合テスト追加)

**表示修正コミット (`157b7ca`) — 変更**: `src/style.css`(`#game-root`のサイズ指定でキャンバス中央寄せを修正) / `src/render/PitchScene.ts`(選手/ボール拡大・配色変更)

**本ファイル**: `HANDOFF.md`

## 申し送り

- モデル設定は opusplan。設計判断を伴うタスクは必ず Plan Mode（Shift+Tab）で開始する。
- リポジトリ: `origin` = `https://github.com/appstockhub/vertical-striker.git`。`main` ブランチに直接コミットする運用（ユーザー承認済み、Phase 0から継続）。
- タグ: `phase-0`は作成・push済み。`phase-1`は本セッションではまだ作成していない。
- **このセッションのBrowser pane（サンドボックス内蔵ブラウザ）は終始コンポジット/表示不可の状態だった**（新規タブでも`document.hidden`が`true`のまま）。スクリーンショットに頼れない場合はDOMレイアウト計算(`getBoundingClientRect`)やcanvasピクセル読み取り(`getImageData`)で代替検証したが、次回セッションでは正常に動作している可能性が高いので、まずスクリーンショットを試すこと。

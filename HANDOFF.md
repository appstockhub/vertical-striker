# HANDOFF

最終更新: 2026-08-14

## 1. 完了した作業

- **Phase 0（基盤）完了・タグ`phase-0`push済み**
- **Phase 1（ボールと1選手）完了・タグ`phase-1`push済み**
- **Phase 2（11 vs 11とチームAI）実装完了・6つの副マイルストーンすべてコミット済み（`main`、未タグ・未push）**
  1. **配列化+フォーメーション+静的描画**: `GameState.players[]`(22人、固定index規約 0-10=TeamA/11-21=TeamB)へ移行。`sim/formations.ts`に4-4-2/4-3-3/3-5-2/5-3-2の仮レイアウト
  2. **非操作選手AI**: `sim/teamAI.ts` — ホーム復元力+ボール引力+オフサイド意識の重み付きベクトル合成。sqrtを使わず内積argmaxで8方向量子化する設計（`sim/steering.ts`、`core/fixed.ts`に`dotFixed`追加）
  3. **カーソル切替+パス**: `sim/cursor.ts` — Yボタンの文脈依存解決（ボール保持中=パス、非保持=カーソル自動追従+手動切替）。ヒステリシス・index昇順タイブレーク
  4. **キーパーAI**: `sim/goalkeeperAI.ts` — 自動ステアリング・自動⇔手動交代・キャッチ/パンチング。得点処理を伴わない最小限のゴールマウス幾何参照を導入
  5. **スライディングタックル**: `sim/tackle.ts` — Windup→Active→Recovery状態機械、Bボタンの文脈的再利用（保持中=キック、非保持=タックル）。ファールなし
  6. **決定論/パフォーマンス強化**: `InputManager.sample()`の1フレーム内複数回呼び出しバグを修正、22人版の決定論回帰テスト追加
  - 新規テスト77件（Phase 0/1の62件+Phase 2の77件+update.test.ts拡張=**140件**）、`npm run test`/`check:determinism`/`build`すべてgreen
  - 設計・実装中に発見・修正した実バグ2件: ①`quantizeToDirection8`にゼロのデッドゾーンを渡すと「ちょうど目標位置」で厳密な`<`比較が偽になり8方向タイブレークの先頭(Up)にフォールバックする回帰（テストで発見）②上記のInputManager多重サンプルの潜在バグ

## 2. 進行中の作業と正確な現状

- Phase 2の実装・自動検証（型チェック・テスト・決定論チェック・ビルド）はすべて完了。`main`にコミット済み（`f1df054`→`37cc948`→`e773c85`→`1f1ea02`→`8d5ec8c`、6マイルストーンぶん）。**push・タグ付けはまだ**。
- **見た目の目視確認ができていない**: このセッションはBrowser paneが最初から最後まで非コンポジット状態（`document.hidden`が常に`true`）で、Phase 1の表示修正セッションと同じ問題が今回も継続していた。コンソールエラー無し・型チェック/テスト/ビルドすべてgreenまでは確認したが、実際の見た目（22人のフォーメーション形状、カーソルリング、パスマーカー、キーパーの動き、タックルの見え方等）は未確認。
- ゲームパッド実機での確認も引き続き未実施（ユーザー側で現在パッド未所持）。

## 3. 次にやるべきこと（優先順）

1. **ユーザーにブラウザで実際の見た目を確認してもらう**（最優先）。特に: キックオフ時の22人フォーメーション形状（4-4-2、左右対称）、カーソルハイライトリングと「↓」パスマーカーの視認性、キーパーの自動追従、タックルの挙動。`npm run dev`で起動可能
2. push・`phase-2`タグの作成をユーザーに確認する（Phase 0/1では別途明示的に依頼された運用）
3. ゲームパッドが手に入り次第、実機でのB/Y/A/X/L/R配置とPhase 2の全操作（カーソル切替・パス・キーパー・タックル）を確認
4. Phase 2で仮決めした大量の定数（フォーメーション座標、AI重み、ヒステリシス幅、パスコーン角度、キーパー反応速度/守備範囲、タックルのタイミング/範囲等）をプレイテストで調整
5. Phase 1から持ち越し: 精密照準軸・カーブ/バックスピンの実装タイミングを検討（CLAUDE.mdの確定仕様のため、いずれか要実装）
6. Phase 2完了後、CLAUDE.mdの段階開発計画に従いPhase 3（ルール実装: ゴール・スローイン・ゴールキック・コーナー・オフサイド判定・前後半・CPU難易度3段階）に着手

## 4. 未解決の課題・ユーザー判断待ち

- **Yボタンの文脈依存解決（最重要・要確認）**: CLAUDE.mdの確定仕様「Y=カーソルパス」と要検証仕様の仮回答「Y=手動カーソル切替」を、ボール保持中/非保持中で使い分けることで両立させた（`sim/cursor.ts`）。この解釈自体がPhase 2で最も不確実性の高い設計判断で、実際に触ってみての違和感有無を確認してほしい
- **Bボタンのタックルへの文脈的再利用**: CLAUDE.mdにタックルの発動ボタン指定が無いため、「ボール保持中はキック・非保持でジオメトリ条件成立時はタックル」という設計を採用した。要フィードバック
- **非操作選手AI（Team B含む）は自律的にキック/パス/タックルを行わない**（ポジショニングAIのみ、Phase 2のスコープ外指定）。そのため現時点でTeam Bは自分からシュートを打たず、「完全な試合」の手触りにはならない。CPU側の攻撃判断はPhase 3「CPU対戦の難易度3段階」に委ねる設計だが、この分割が適切か確認してほしい
- ゲームパッド実機確認が継続的に未実施（Phase 0から持ち越し）。特にSFC論理ボタンX→Xbox Y割り当て
- Phase 1で対象外とした精密照準軸・カーブ/バックスピンの実装タイミング未決定
- Phase 2の新規定数はすべて仮値。実機/プレイテストでの調整が必要

## 5. 重要な決定事項と理由

- **players[]の固定index規約**: `0`=TeamA GK, `1-10`=TeamA outfield, `11`=TeamB GK, `12-21`=TeamB outfield。`globalIndex = team*11 + slotIndex`。すべてのクロスプレイヤー判定（誰がボールに一番近いか等）はこの配列を厳密に昇順indexで走査し、同点は小さいindexが勝つ、という決定論的タイブレークを徹底した。フォーメーションの左右対称性により完全な同一距離が実際に頻発するため、これは理論上の懸念ではなく実装・テストの両方で踏んだ現実のケース
- **AIステアリングはsqrt/正規化を使わず、内積argmaxで8方向に量子化する設計**（`sim/steering.ts`）。ホーム/ボール/オフサイドの3項をそれぞれ量子化してから重み付け合成することで、「重み付き」という要求を生ベクトルのまま合成した場合の"距離が大きい項が重みを無視して支配する"問題を回避した。`core/fixed.ts`に追加した唯一の新規プリミティブ`dotFixed`は乗加算のみで超越関数ではない
- **`Inputs`型は変更しない**（Phase 1から継続の方針）。カーソル切替・タックル等の新規edge判定もすべて`GameState.prevButtons`と各選手のtickをまたぐ状態（`kickChargeFrames`・`tacklePhase`等）から導出し、`InputFrame.buttonsPressed`は経由しない
- **カーソルは「誰がボールを持っていても即座にその選手にスナップする」という1本のルール**で、カーソルパス完了後の受け手への自動追従とAI選手の偶発的なボール奪取の両方を統一的に扱った（`sim/cursor.ts`）
- **カーソルの自動追従・GKの自動交代は、操作選手がキック溜め中またはタックル中は発火させない**（意図しない操作奪取を防ぐガード）
- **得点処理を伴わない最小限のゴールマウス幾何参照をPhase 2で導入**（Phase 3の得点/ルールをわずかに前倒しするが、ネット衝突・得点イベント・試合停止は一切実装しない、GKの位置取り判定にのみ使う純粋な座標参照）
- 決定事項の全リストは各マイルストーンのコミットメッセージ（`git log`）に詳細を残している

## 6. 変更ファイル一覧（Phase 2、6コミットぶん）

**新規**: `src/sim/formations.ts` `src/sim/steering.ts` `src/sim/ballTouch.ts` `src/sim/teamAI.ts` `src/sim/teamAIConstants.ts` `src/sim/cursor.ts` `src/sim/cursorConstants.ts` `src/sim/goalkeeperAI.ts` `src/sim/goalkeeperConstants.ts` `src/sim/tackle.ts` `src/sim/tackleConstants.ts` `src/render/teamColors.ts` / テスト: `tests/sim/{formations,steering,ballTouch,teamAI,cursor,goalkeeperAI,tackle}.test.ts`

**変更**: `src/sim/state.ts`（players配列化） `src/sim/update.ts`（22人ループへ全面書き換え、GK/カーソル/タックルの優先順位付き統合） `src/core/fixed.ts`（`dotFixed`/`distSqFixed`追加） `src/render/PitchScene.ts`（プール化描画、カーソルリング/パスマーカー、ゴールライン、InputManager修正） `tests/sim/update.test.ts`（配列形状対応+22人版決定論回帰テスト）

## 申し送り

- モデル設定は opusplan。設計判断を伴うタスクは必ず Plan Mode（Shift+Tab）で開始する。
- リポジトリ: `origin` = `https://github.com/appstockhub/vertical-striker.git`。`main`ブランチに直接コミットする運用（ユーザー承認済み）。push/タグはユーザーの明示的な依頼を待つ。
- タグ: `phase-0`・`phase-1`は作成・push済み。`phase-2`は未作成。
- **このセッションもBrowser pane（サンドボックス内蔵ブラウザ）が終始コンポジット/表示不可の状態だった**（`document.hidden`が常にtrue）。前回セッション（Phase 1表示修正時）と同一の症状。次回セッションではまずスクリーンショットが正常に撮れるか試すこと。代替検証手段: `document.querySelector('canvas').getContext('2d').getImageData(...)`でピクセル色のヒストグラムを取る方法が有効（コンポジットが復旧すれば実データが返る）。
- Phase 2実装は`.claude/plans/claude-md-cheerful-cookie.md`（ユーザー承認済み）の計画書に沿って実施。同ファイルに詳細な設計判断・仮定一覧が残っている。

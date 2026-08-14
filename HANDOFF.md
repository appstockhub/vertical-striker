# HANDOFF

最終更新: 2026-08-14

## 1. 完了した作業

- **Phase 0 実装完了**（コミット `283318b`、タグ `phase-0` を push 済み）
  - Vite + TypeScript(strict) + Phaser 3.90 のプロジェクト scaffolding
  - 固定タイムステップ60fpsループ（アキュムレータ方式、更新/描画分離）: [src/core/loop.ts](src/core/loop.ts)
  - 固定小数点（1/256px サブピクセル）座標ユーティリティ: [src/core/fixed.ts](src/core/fixed.ts)
  - 純関数・state受け渡し方式の mulberry32 PRNG: [src/core/rng.ts](src/core/rng.ts)
  - Gamepad/Keyboard 入力抽象化（SFC論理ボタン B/Y/A/X/L/R + 8方向、接続時オーバーレイ）: [src/input/](src/input/)
  - 純関数 `simulate(state, inputs) -> state` による決定論的状態遷移: [src/sim/](src/sim/)
  - 縦スクロールカメラ（先読みオフセット）+ レーダー（Phaserセカンダリカメラ）: [src/render/](src/render/)
  - 仮選手1体・ボール1個で8方向移動・ピッチ境界クランプ・レーダー連動を実装
  - 決定論違反（`Math.random`/`sin`/`cos`/`atan2`、`phaser` import）を静的検出する `scripts/checkDeterminism.mjs`
  - vitest ユニットテスト30件（`sim/update.ts` の決定論回帰テスト含む）
  - Browser preview（キーボード操作）で完了条件相当の動作を確認済み: `npm run test` / `npm run check:determinism` / `npm run build` すべて成功
  - CLAUDE.md の「要検証仕様」に「SFC論理ボタンX → Xboxパッドの割り当て」項目を追加（実装時に発生した新たな未確定仕様のため恒久記録）
  - `git commit` → `git tag phase-0` → `git push origin main` / `git push origin phase-0` まで完了

## 2. 進行中の作業と正確な現状

- 進行中のタスクなし。Phase 0 は完了し、リモート(`origin/main`, `origin/phase-0`)まで反映済み。
- ローカルブランチは `main`、`origin/main` と同期済み（ahead/behind 0）。

## 3. 次にやるべきこと（優先順）

1. **Phase 1 着手**: ドリブル・キック実装（方向+B同時押しの強キック、押下時間による弾道高さ、L/R精密照準、キック後入力によるカーブ/バックスピン）、ボール物理（転がり摩擦・バウンド・疑似3D高さ）。CLAUDE.md「操作仕様」節を参照。
2. Phase 1 完了時点で GitHub Pages 公開設定（`vite.config.ts` の `base: './'` は対応済み、あとは Pages 側のワークフロー追加）。
3. ユーザー側での実機ゲームパッド確認（下記4参照）を Phase 1 の作業と並行、または着手前に実施してもらう。

## 4. 未解決の課題・ユーザー判断待ち

- **実機ゲームパッドでのみ確認可能**（このセッションのサンドボックスに物理パッドが無いため未検証）:
  - Xbox系パッド接続時のオーバーレイ表示・自動非表示の挙動
  - 十字キー/左スティック両方での8方向入力の実際の操作感（デッドゾーン0.35は仮値）
  - B/Y/A/X/L/R の配置が意図通りか。特に **SFC論理ボタンX（上）→ Xbox Y（index 3）** は CLAUDE.md に明記が無く対称性からの推測（`src/input/gamepadMapping.ts`）。CLAUDE.md「要検証仕様」に追記済み。
- CLAUDE.md の他の「要検証仕様」項目（カーブ/バックスピンの受付フレーム数、精密照準の解釈、キーパー操作の自動/手動切替など）は Phase 1〜2 で実装する際に改めて実機確認が必要。

## 5. 重要な決定事項と理由

計画書（`.claude/plans/claude-md-cheerful-cookie.md`、ユーザー承認済み）に詳細あり。要点:

- **Phaser `^3.90.0` を採用**（npm最新タグは4.2.1だが、CLAUDE.mdが明示的に「Phaser 3」を3箇所で指定し、自前物理・Canvas2D限定の設計も3系のAPIを前提にしているため）
- **TypeScript `^5.9.3` を採用**（最新7.0.2は`typescript-eslint`等のツール群が未追随のため見送り）
- **`src/sim/**` は `phaser` を import しない/`Math.random`・`sin`・`cos`・`atan2` を使わない**という鉄則を機械チェック化（`scripts/checkDeterminism.mjs`）。決定論はロックステップ対戦・リプレイの前提であり最優先事項のため。
- **vitest を新規追加**（依存最小化の指示はあるが、決定論が安全性に直結する要件と明記されているため、純関数群への低コストなユニットテストを優先）。ESLintは追加せず、決定論チェックは専用スクリプトで代替。
- **GameState.player/ball は単数フィールド**（配列ではない）。Phase 2で `players: PlayerState[]` へ移行する際は `sim/state.ts` と `sim/update.ts` に閉じた小さな機械的リファクタになる想定。
- **カメラのスクロール位置・レーダーのイージングは GameState に含めない**（決定論の対象外の「見た目」の状態と明確に位置づけ、ここのみ float のイージングを許可）。
- Phase 0 で仮決めした値（CLAUDE.mdの「要検証仕様」と同様、後日調整前提）: ピッチ/ビューポート寸法（480×720 / 480×1800）、カメラ先読みオフセット定数・追従イージング係数、レーダーのサイズ・配置（右上・幅22%）、アナログスティックのデッドゾーン(0.35)、プレイヤー移動速度、キーボードのSFCボタン仮割り当て(Z/X/C/V/Q/E → B/A/Y/X/L/R)。

## 6. 変更ファイル一覧（このセッションで作成・変更）

**Phase 0 実装コミット（`283318b`）** — 37 files changed, 2852 insertions(+), 2 deletions(-)

- 設定: `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`, `.claude/launch.json`
- `scripts/checkDeterminism.mjs`
- `src/main.ts`, `src/style.css`
- `src/config/{pitch,gameConfig}.ts`
- `src/core/{types,fixed,rng,loop}.ts`
- `src/sim/{state,constants,update}.ts`
- `src/input/{types,gamepadMapping,gamepad,keyboard,inputManager,overlay}.ts`
- `src/render/{BootScene,PitchScene,camera,radar,fixedToPixel}.ts`
- `tests/core/{fixed,rng,loop}.test.ts`, `tests/sim/update.test.ts`, `tests/input/gamepadMapping.test.ts`
- `HANDOFF.md`（更新）

**このhandoffセッション内での追加変更**（未コミット→本コミットに含める）:

- `CLAUDE.md`: 「要検証仕様」に SFC論理ボタンX→Xboxパッド割り当ての項目を追加
- `HANDOFF.md`: 本ファイルの全面更新

## 申し送り

- モデル設定は opusplan。設計判断を伴うタスクは必ず Plan Mode（Shift+Tab）で開始する。
- リポジトリ: `origin` = `https://github.com/appstockhub/vertical-striker.git`。`main` ブランチに直接コミットする運用（ユーザー承認済み）。

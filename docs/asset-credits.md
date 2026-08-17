# 使用素材のクレジットとライセンス

CLAUDE.md「素材ポリシー」に基づく記録。**第三者素材を1点でも使ったら、必ずここに追記すること。**

## 記録ルール

- 素材を追加した**同じコミット**でこの表を更新する
- ライセンスは「原文を確認した結果」を書く。推測で書かない
- 継承(share-alike)義務のあるライセンスは、採用前にユーザー判断を得たことも記録する
- 商用ゲームからの吸い出し・模写・トレース由来のものは、ライセンス表記に関わらず**採用しない**

## 現在使用している第三者素材

**本採用はまだ無い。** 下記1点は `?sprites=gb` を付けた時だけ読み込まれる**試作用**で、
既定の描画経路（手続き生成）は 2026-08-17 時点でも 100% オリジナルのままです。

| 種別 | 素材名 | 作者 | 配布元URL | ライセンス | 改変 | 再配布 | 商用 | 継承 | クレジット表記 | 配置場所 |
|---|---|---|---|---|---|---|---|---|---|---|
| 選手スプライト（試作） | 8-Directional Game Boy Character Template | GibbonGL | https://gibbongl.itch.io/8-directional-gameboy-character-template | **CC0 1.0 Universal** | 可 | 可 | 可 | **無し** | 不要（作者は「あれば嬉しい」と記載） | `public/assets/thirdparty/gb-8dir-character-cc0.png` |

### 上記の確認記録

- 確認日: 2026-08-17。確認方法: 配布ページのHTMLを直接取得し、itch.io のメタデータ欄
  「Asset license」の値が `Creative Commons Zero v1.0 Universal` であることを確認した。
  併せて `Content: No generative AI was used` の表示も確認済み。
- 作者の説明文（原文）: *"Feel free to use it in any way you want but i encourage you to make
  your own adaptations. Credits are appreciated!"* → クレジットは任意。
- 配布物は「名前は自分で決める価格」（実質無料）の zip 19 kB。同梱物は Aseprite 生ファイル /
  GIF / まとめPNG。
- リポジトリに置いたのは zip 内の `loose sprites.png` を**無改変**でコピーしたもの。
  - sha256: `028da0263b96931ac2ceaf2c0900b6d4689d9e235a9fdc992948e3ad06ce3fa2`
  - 128x128 / RGBA / 4色（`#e0f8cf` `#86c06c` `#306850` `#071821`）
  - 背景の抜きとチーム色への差し替えは実行時に `src/render/gbPlayerSprites.ts` が行う。
    原本はそのまま保つ（出所の追跡可能性を優先）。

### 判断待ち（購入前・未使用）

| 素材名 | 作者 | URL | 価格 | ライセンスの状態 |
|---|---|---|---|---|
| Asset Pack 'Football,Soccer' (NES) | chasersgaming | https://chasersgaming.itch.io/asset-pack-football-soccer | £2.00 GBP〜 | **未確定**。ページに Asset license 欄が無く、CC0 の根拠が作者コメント1件のみ。同じコメント内で「自分の素材は一般に CC-BY-SA」とも書いている。`docs/asset-license-inquiry.md` の文面で確認を取るまで**購入・使用しない** |

## 音声素材の調達候補（2026-08-17 調査、いずれも未取得）

現状、BGM・効果音はすべて Web Audio による手続き合成でファイルを1つも持っていない
（下記「コード生成しているもの」参照）。合成で最も弱いのは**観客の歓声・スタジアムの環境音**
なので、そこだけ実録音に差し替える方針で候補を洗った。

**未取得の理由: Freesound からのダウンロードは無料アカウントの作成が必要で、
Claude は代理でアカウントを作れない**（安全上の制約）。取得はユーザー側で行う必要がある。
下記URLとライセンスは配布ページの原文を確認済み。

| 用途 | 素材 | 作者 | URL | ライセンス（原文） | 尺 / 形式 |
|---|---|---|---|---|---|
| 環境音（ループ土台） | Sound Of Sankt Pauli — Crowd Reaction General Ambience 01 | itmightgetloud (Philipp Feit) | https://freesound.org/people/itmightgetloud/sounds/829454/ | **Creative Commons 0** | 6:12 / WAV 48k 24bit stereo 102MB |
| ゴール歓声 | 同上 — Crowd Reaction Goal 01 | 同上 | https://freesound.org/people/itmightgetloud/sounds/829455/ | **Creative Commons 0** | 1:08 / 18.8MB |
| 惜しい場面の「おぉ…」 | 同上 — Crowd Reaction Chance Missed 01 | 同上 | https://freesound.org/people/itmightgetloud/sounds/829452/ | **Creative Commons 0** | 1:01 / 16.9MB |
| 主審の笛 | Referee whistle sound.wav | Rosa-Orenes256 | https://freesound.org/people/Rosa-Orenes256/sounds/538422/ | **Creative Commons 0** | 0.54秒 / WAV 48k mono 50KB |
| キック | soccer ball kick | Luisa_Sanchez | https://freesound.org/people/Luisa_Sanchez/sounds/813402/ | **Creative Commons 0** | 2.6秒 / 679KB |
| 予備（軽量な環境音） | Crowd Ambience | FlatHill | https://freesound.org/people/FlatHill/sounds/324757/ | **Creative Commons 0** | 1:14 / 13.7MB |

### 採用時に必ず守ること

- **実試合の録音には場内PAの音楽や既存楽曲のチャントが混入しうる。** 録音者のCC0宣言は
  「自分の録音」にしか及ばず、録音に写り込んだ楽曲の権利は処理できない。
  **書き出す前に全編を試聴し、音楽が鳴っている区間・旋律のあるチャントは必ず除去すること。**
  （特に上記の Goal 01 と、有名な blaukreuz "Goal!" は説明文自体が場内アナウンス・BGMの
  混入を明記している）
- ブラウザ配信のため Ogg Vorbis / Opus へ変換し、環境音はモノラル 64〜96kbps で十分。
  20〜30秒を切り出して自前でループ点を作る（**どの候補も「シームレスにループする」とは
  明記されていない**）。
- CC0 はクレジット不要だが、取得日・URL・当時のライセンス表示をこの表に必ず残す。

### 除外したもの

| 出典 | 理由 |
|---|---|
| BBC Sound Effects | **RemArc ライセンスは非商用限定**。商用不可のため方針に反する |
| Freesound の craigsmith 名義（CC0タグ付き） | 実体は 1930〜60年代の**ハリウッド商用効果音ライブラリ**をUSCがデジタル化したもの。アップロード者にCC0を宣言する権利があるとは考えにくい |
| archive.org の Universal Studios Sound Effects Library 等 | 同上（商用ライブラリ。archive.orgにあること自体はライセンスの根拠にならない） |
| Kenney.nl の音声パック | CC0で綺麗だが、**歓声・スポーツ・環境音のパックが存在しない** |
| Pixabay | 現行の Pixabay Content License は CC0 ではない。ゲームへの組み込み自体は許諾範囲内だが、**撤回可能なサイト規約**にすぎず、Steam配信を見据えると CC0 に劣る |

## コード生成しているもの（第三者素材ではない）

参考のため、現在オリジナルで生成している資産を列挙する。

| 種別 | 生成元 | 備考 |
|---|---|---|
| 選手スプライト | `src/render/playerSprites.ts` | 図形の組み合わせをテクスチャに焼く方式 |
| ボール | `src/render/PitchScene.ts` の `buildBallTexture()` | 白地＋黒の五角形 |
| ピッチ・ライン・ゴール | `src/render/pitchPerspective.ts` | 毎フレーム投影して描画 |
| スタジアム（空・観客席・広告板） | `src/render/stadium.ts` | 静的に1回描画 |
| BGM・効果音 | `src/render/MusicPlayer.ts` / `SoundPlayer.ts` | Web Audio による手続き合成（音声ファイル不使用） |

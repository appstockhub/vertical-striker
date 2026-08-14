# 調査ノート (2026-08-15 夜間自律作業)

挙動仕様書 (`docs/soccer-behavior-spec.md`) の根拠となる調査記録。3方向 (1-A: 実サッカーの戦術原則 / 1-B: SFCフォーメーションサッカーの挙動記述 / 1-C: OSSサッカーゲーム実装) から素材を収集した。

## 1-A. 実サッカーの戦術原則 (Web調査)

### ポジショナルプレー (Juego de Posición)

- ピッチをゾーンに分割し、選手はマーク対象ではなく**担当ゾーンを占有**する。チームの形と局面(フェーズ)に応じてゾーンが決まる。グアルディオラは20ゾーンのグリッドで教えることで知られる。
- **幅と深さの確保**: 選手はあらかじめ定義されたゾーンに散開し、幅(タッチライン方向)と深さ(縦方向)とコンパクトな中央のスパイン(背骨)を保つことで、前進的なパスレーンを確保する。
- **過密の禁止**: 同一の横ライン上に味方は最大3人まで、同一の縦レーン上には最大2人まで。1つのゾーンに人数をかけすぎるとパスの選択肢が減り構造が崩れる。**知的に散開することでパスレーンが常に開き、保持を続けるための安全な逃がし先が常に存在する**。
- スペースの識別は「ボール位置・敵味方の位置・無人のエリア」を幅・深さ・相手守備ライン・オフサイドラインの4パラメータで判定する。

実装への示唆: サポートランは「ボールの前方」だけでなく「縦レーンの重複回避」が本質。同レーンに2人以上入らない制約はX座標の分散として実装可能。

出典:
- https://learning.coachesvoice.com/cv/positional-play-football-tactics-explained-guardiola-cruyff-manchester-city/
- https://the-footballanalyst.com/positional-play-football-tactics-explained/
- https://decoding-soccer.medium.com/understanding-positional-play-b88838f2b17b
- https://drawtactics.com/blog/tactics/positional-play-tactical-guide

### ゾーンディフェンスとマンマークの使い分け

- **マンマーク**: 各守備者が特定の攻撃者に密着し、1v1のデュエルをどこまでも追う。個の強い選手を消すのに有効。ただし相手がポジションチェンジを多用すると守備陣形が引き伸ばされ、大きなギャップが生まれる。
- **ゾーン**: 守備者は「人ではなくスペース」を守る。コンパクトなブロックを形成し、ボールの移動に応じて**ユニットとして**左右にスライドする。孤立や崩しのパスで置き去りにされるリスクが減る。弱点はゾーン境界への数的過負荷(オーバーロード)。
- 実戦では**ハイブリッド**が主流: 基本はゾーンで陣形を保ち、自ゾーンに入ってきた相手にはタイトに付く。

実装への示唆: 現行実装の「DFだけがマーク、他はホーム(ゾーン)」は実サッカーのハイブリッドに近い方向性で妥当。ただしゾーン側の「ボールサイドへのユニットスライド」(横方向のシフト)が現状欠落している。

出典:
- https://jobsinfootball.com/blog/tactics/zonal-marking/
- https://www.soccercoachlab.com/blog/zonal-marking-vs-man-to-man-marking-complete-guide
- https://www.sportstips.org/blog/Soccer/Tactics/zonal_vs_man_to_man_marking_a_tactical_comparison

### プレッシングとカバーシャドウ

- **カバーシャドウ**: プレスに行く選手は、自分の背後のパスレーンを体で消しながら寄せる(1人で「ボール保持者への圧力」と「パスコース1本の遮断」を同時に行う)。
- **プレッシングトラップ**: 前線の選手が寄せる角度で相手のプレー方向を片側に誘導し、チーム全体の連鎖反応でボールを奪う。
- **スウォーミング**: ボール保持者を複数人で取り囲み、複数のカバーシャドウを形成して奪い切る。

実装への示唆: 現行のprimary追跡者は「ボールへ直線的に寄る」のみ。カバーシャドウ(ボールとゴール/パスレーンを結ぶ線上に立つ)は8方向量子化でも「ボールの位置ではなくボールのゴール側の点を目標にする」ことで近似できる。

出典:
- https://thetacticalanalyst.wordpress.com/2016/04/08/pressing-mechanisms-focusing-on-cover-shadows-and-pressing-traps/
- https://whittonutd.co.uk/compactness-and-cover-shadows-pressing-fundamentals
- https://onenil.medium.com/what-is-ball-oriented-defending-how-to-defend-press-and-actively-win-the-ball-feat-2cf0daaad0

### ディフェンスラインの統率とコンパクトネス

- **ラインの高さ**: 高いラインはピッチを圧縮しプレスを支える。ラインが上がれば中盤も追従し、プレス距離が短くなる。
- **垂直コンパクトネス**: 最終ラインと前線の距離(ライン間)を詰める。**水平コンパクトネス**: 選手間の横距離を適切に保ち、縦パスのレーンを開けさせない。
- **ボールサイドシフト**: チーム全体がボールサイドへ寄り、ボール周辺で数的優位を作って即時回収を狙う。逆サイドは意図的に捨てる(サイドチェンジには陣形スライドで対応)。

実装への示唆: 現行のライン押し引きは縦方向のみ。**横方向のボールサイドシフトが完全に欠落**しており、これが「連動していない」という体感の一因である可能性が高い。X方向にも控えめなシフトを入れる価値がある。

出典:
- https://the-footballanalyst.com/compactness-in-defense-football-tactics-explained/
- https://defendscouting.com/compactness-in-defense/
- https://the-footballanalyst.com/defensive-line-height-the-metric-defining-modern-defending/

### トランジション (攻守の切り替わり)

- **ネガティブトランジション(ボールを失った直後)**: ボール周辺の選手は即座にスペースを消し、前方へのパスコースを消す(カウンタープレス)。それ以外は帰陣。**レストディフェンス**: 攻撃中から後方に残す保険の選手配置が、失った瞬間の初動を決める。
- **ポジティブトランジション(奪った直後)**: 相手の陣形が整う前に素早く前進する(カウンター)か、確実な保持へ移行するかの2択。奪った選手の周囲に即座にパスコース(サポート角度)を作る。
- トランジションは「作り出す局面」ではなく「生じた瞬間を制する局面」。切り替えの認知と反応の速さが質を決める。

実装への示唆: 現行の linePossessionTeam の90tickヒステリシスは「陣形の安定」には寄与しているが、「切り替わり直後の即応(ボール周辺の選手のカウンタープレス)」は追跡権(生possession)が担っている構造。役割分担自体は理にかなっているが、奪った直後の前進サポート(ポジティブトランジション)は明示的な実装が無い。

出典:
- https://footballdna.co.uk/features/defending-principles-how-to-coach-negative-transition/
- https://footballdna.co.uk/features/attacking-principles-how-to-coach-positive-transition/
- https://elitesoccercoaching.net/out-of-possession/counter-pressing-principles-and-rest-defence
- https://totalfootballanalysis.com/article/tactical-theory-training-effective-defensive-transitions-tactical-analysis-tactics

## 1-B. SFCフォーメーションサッカーの挙動記述 (Web調査)

**制約の遵守**: ROM解析・逆アセンブル・デコンパイル由来の情報は一切参照していない。以下はすべて攻略サイト・レビュー記事等の「人間が書いた挙動の説明文」からの収集である。

**総評: 収集できた素材は期待より薄い**。攻略記事の大半はチーム強さ・裏技・操作テクニックの説明で、AI挙動の言語化は断片的だった。それでも以下の観察が得られた:

### キーパーの挙動 (XNEO攻略)
- 「HUMANチームのFW陣はAT能力が高く、シュートが速いため、**シュートを打たれてから反応をしても止めることは難しい。体の向きでシュートコースを予測し、打ったと同時にパンチングで弾くようにしよう**」→ GKは打たれてから反応する(予測は人間側のテクニック)。速いシュートには反応が間に合わない、という挙動は本プロジェクトのCLAUDE.md記載のセオリー(ゴール隅への速い強キックはキーパーが反応できない)と一致。
- 「相手キーパーのケンゾウは非常にDF能力が高いので**遠めからのシュートだとキャッチされてしまう可能性が高い**」→ 遠距離(=到達時に減速した)シュートはキャッチされる。速度とキャッチ可否の関係は現行実装(CATCH_MAX_SPEED)と整合。
- 「キーパー諦めてやがる」(ゴール隅への速いシュート時、ガッツの夜明け) → 隅への速いシュートにはGKが反応しない。

### CPUディフェンスの挙動
- 「やたら素早い中盤のCPUにはすぐにボールを奪われる」(ガッツの夜明け) → CPUのプレスは中盤で発動する体感。
- 「1度スライディングに失敗したキャラが**すぐさま追いかけてきて再度スライディングを仕掛けてくる**」(ふくろうのゲームレビュー) → 守備AIは失敗後も同一選手が執拗に追い続ける(追跡権の持続)。
- 「スライディングをすると、**画面に映ってる3人くらいが同時にスライディングをしたりする**」(note記事) → 近傍の複数選手が同時に守備アクションを起こす(=ボール周辺の複数人プレス)。

### カーソル・操作の挙動
- 「予期しないタイミングで操作キャラが切り替わり、思うようにキャラを動かせない場面が多々あります」(ふくろうのゲームレビュー) → **原作にもカーソル自動切替の不満が存在した**。本プロジェクトで発見・修正したカーソル暴れ問題は原作の課題の再現でもあり、改善は「原作より快適」の方向として正当。

### フォーメーション
- 任天堂公式(クラシックミニ紹介): フォーメーションは8種類で「**守備がやりやすい・センタリングがやりやすい等の違い**」がある。
- 一方でレビューには「フォーメーションによって攻めやすさや守りやすさが大きく変わるわけではなく、このシステムをあまり活かせていなかった」(ふくろうのゲームレビュー)という評価もある → 原作のフォーメーション差は控えめだった可能性。本プロジェクトでは"精神的継承"としてフォーメーション差をもう少し意味のあるものにして良い。

### CPU攻撃
- HUMANチームは2-3-5の超攻撃的布陣で5トップ(XNEO) → 原作のCPUはフォーメーションそのものが攻撃性を表現する主な手段。
- 「何でCPUはこんなに速いパス回しやシュートが打てるんだよ」(ガッツの夜明け) → CPUの攻撃はテンポの速いパス回しが体感的特徴。

出典:
- https://xneo.jp/super-formation-soccer/ / https://xneo.jp/super-formation-soccer2/
- https://gutsdawn.com/ (スーパーフォーメーションサッカー 辛口HUMAN攻略)
- https://retrog.hatenablog.jp/entry/2023/04/18/205455
- https://note.com/bossizm/n/n02b5eaaeb981
- https://www.nintendo.co.jp/clvs/soft/sf_soccer.html

## 1-C. OSSサッカーゲームのポジショニングAI (Web調査)

**方針の遵守**: コードのコピーは行わず、設計思想と構造のみを学んだ。以下は概念の要約であり、本プロジェクトのコードはすべて独自実装である。

### RoboCup Soccer Simulation 2D — HELIOS base / agent2d (LGPL/GPL、学術OSS)

- ポジショニングを「**ボール位置 → 11人全員の望ましい配置**」という写像として定式化し、ドロネー三角形分割(Delaunay Triangulation)による補間で近似する。フォーメーションエディタ(fedit2)で「ボールがここにある時、選手はここ」というサンプル点を人間が編集し、実行時はボール位置から補間する。
- 攻撃用・守備用など**局面ごとに別のフォーメーション定義**(offense-formation.conf / defense-formation.conf)を持つ。
- **設計上の学び**: ホームポジションは静的な点ではなく「ボール位置の関数」であるべき。本プロジェクトのライン押し引き(縦1次元)はこの写像の1次元近似に相当し、**X方向(ボールサイドシフト)を含む2次元化が正当な発展方向**である。

出典:
- HELIOS Base: An Open Source Package for the RoboCup Soccer 2D Simulation (Akiyama & Nakashima) https://link.springer.com/content/pdf/10.1007/978-3-662-44468-9_46.pdf
- https://www.semanticscholar.org/paper/2a63f5306627bc3cf1b9c12ea1a6b8a84d84581b

### GameplayFootball / Google Research Football エンジン (GPL v3)

`AIfunctions.cpp` の設計概念 (コードは参照したが流用していない):
- **AI_GetAdaptedFormationPosition**: フォーメーション基準位置 + xFocus/yFocus (ボール方向への「重力」オフセット、X方向を含む) + microFocus (至近距離の吸着、距離減衰カーブ付き) のブレンド。**本プロジェクトの「ホーム+ライン調整+ボール引力」と同型のアーキテクチャ**であり、現行設計の妥当性を裏付ける。
- ボール保持状態に応じて中盤が守備寄り/攻撃寄りに圧縮される(ミッドフィールドストレッチ)。DFとFWはアンカーされる。
- 役割ごとの mindset 値(GK=0.0守備的 〜 CF=1.0攻撃的)がポジショニングとドリブルの積極性に影響 → 本プロジェクトのdepthFracベースの追従率と同じ発想。
- オフサイドラインは「相手の2番目に深い選手」から計算(本プロジェクトと同一)し、200ms先の予測位置を使う。
- **明示的なマーク割り当てや構造化されたフォワードランのトリガーは存在しない** → マーク/サポートランを明示的に持つ本プロジェクトの方が原則ベースでは踏み込んでいる。
- **設計上の学び**: xFocus(ボールサイドへのX方向シフト)は本格実装にも存在する標準要素。現行実装に欠けているのはこれ。

出典:
- https://github.com/BazkieBumpercar/GameplayFootball (GPL v3)
- https://github.com/google-research/football (エンジン部はGPL v3継承)

### Simple Soccer — Mat Buckland『Programming Game AI by Example』(書籍サンプル、概念のみ参照)

- **SupportSpotCalculator**: 敵陣側に候補スポットのグリッドを敷き、各スポットを (1) 保持者から安全にパスが通るか (2) そこからシュートが打てるか (3) 保持者からの距離が最適値(約200px)に近いか、の合計スコアで採点し、**最高スコアのスポットへ「1人の指名されたサポーター」だけが走る**。毎tickではなく周期的に再計算してキャッシュする。
- チームは attacking/defending/kickoff の有限状態機械。
- **設計上の学び**: サポート位置の質は「パスが通る・シュートに繋がる・距離が適切」の3条件で定義できる。また「全員でなく指名された少数がスポットへ走る」のは団子化回避と両立する古典的設計で、本プロジェクトのSUPPORT_RUNNER_COUNT=3と同じ思想。「保持者から近すぎず遠すぎない最適距離」という概念は現行のSUPPORT_AHEAD_STANDOFF(180px)と符合する。

出典:
- Mat Buckland, Programming Game AI by Example (Wordware, 2005), Chapter 4 "Simple Soccer"
- 参照した公開ミラー: https://github.com/HEP85/game-ai (Buckland_Chapter4-SimpleSoccer)

### 1-Cの総括

3つの実装に共通する骨格は「**基準配置(フォーメーション) + ボール位置に応じた連続的な変形**」であり、本プロジェクトの現行アーキテクチャ(ホーム + ライン押し引き + 目標差し替え)はこの骨格に合致している。共通して存在するが本プロジェクトに欠けている要素は **X方向のボールサイドシフト**(agent2dのドロネー写像は2次元、gfootballはxFocus)。マーク・サポートランの明示実装は3者のうちどれも持たないか単純であり、本プロジェクトが既に一歩先へ出ている領域。

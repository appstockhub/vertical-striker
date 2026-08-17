# 第三者素材の置き場

このディレクトリのファイルは**当プロジェクトが作ったものではない**。
追加・削除したら必ず `docs/asset-credits.md` の表を同じコミットで更新すること
(CLAUDE.md「素材ポリシー」)。

| ファイル | 出典 | ライセンス |
|---|---|---|
| `gb-8dir-character-cc0.png` | [8-Directional Game Boy Character Template](https://gibbongl.itch.io/8-directional-gameboy-character-template) / GibbonGL | CC0 1.0 Universal (itch.io の Asset license 欄で明示) |

`gb-8dir-character-cc0.png` は配布 zip 内の `loose sprites.png` を**無改変**で置いたもの
(128x128, RGBA, 4色。sha256 は `docs/asset-credits.md` を参照)。
色の抜きとチーム色への差し替えは実行時に `src/render/gbPlayerSprites.ts` が行うので、
このファイル自体は原本のまま保つこと (出所の追跡可能性を優先)。

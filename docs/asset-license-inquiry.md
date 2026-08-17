# 素材ライセンス確認の問い合わせ

対象: [Asset Pack 'Football,Soccer' (NES)](https://chasersgaming.itch.io/asset-pack-football-soccer) / chasersgaming
（£2.00 GBP〜。現行ファイルは `NES Asset Pack Soccer Files U2024.zip`、2024-06-26 更新）

**送信先: `chasersgaming@hotmail.co.uk`**（作者がitch.ioプロフィールに公開している唯一の私信経路。
itch.io に DM 機能は無い。返信が無ければアセットページのコメント欄が次善で、公開の記録が
残るぶん証跡としてはむしろ強い）

## なぜ確認が要るか

**ページに License 欄が存在しない。** CC0 の根拠は作者のコメント1件だけで、しかも同じ投稿の中で
「自分の素材は一般に CC-BY-SA」とも書いている（原文・誤字ママ）:

> "If you make modifications and you share them you must use the same license, CC-BY-SA or
> CC-BY-.4.0, and credit me 'Chasersgaming'. There is some confusion over my licensing, for
> which I am trying sort … **That said this particular asset(footaball) is CC0, public domain**
> so you are free to use how you want … with no credit necessary"

加えて**このコメントは2024年のファイル更新より前**なので、現行版に及ぶか不明。
CC-BY-SA なら改変したアート資産を同ライセンスで公開する義務が生じ、Steam 販売の判断に影響する。

（OpenGameArt に同作者の CC0 素材もあるが、中身はピッチ画像1点だけで選手スプライトは
含まれない。CC0 の根拠にはならない。）

---

## 送信する文面（最終版・そのままコピーして送れます）

件名:

```
License clarification before purchase — Asset Pack 'Football, Soccer' (NES)
```

本文:

```
Hi Chasersgaming,

I'm an indie developer working on an original top-down soccer game, and I'd like to buy your
"Asset Pack 'Football, Soccer' (NES)":
https://chasersgaming.itch.io/asset-pack-football-soccer

Before purchasing I'd like to get the licence confirmed in writing, because the page
itself has no licence field, and the only licence statement I can find is a comment
reply of yours which says two different things:

1. Generally about your assets: modifications that are shared "must use the same
   licence, CC-BY-SA or CC-BY 4.0" and credit you.
2. Then, specifically: "this particular asset (football) is CC0, public domain … with
   no credit necessary."

You also mentioned in that reply that your licensing had some confusion you were
working to sort out, so I'd rather ask than assume.

Concretely, what I want to do is:

- Recolour the kits to create multiple teams, and edit individual frames as needed
- Ship those modified sprites inside a commercial game (browser first, possibly Steam later)
- Keep my game's source code closed

So my questions are:

1. Is the current 2024 version of the Football/Soccer pack (the file
   `NES Asset Pack Soccer Files U2024.zip`) CC0? Your comment predates that update,
   so I want to be sure it still applies.
2. If it is CC0, does that cover all of the pack — the player sprite sheets,
   goalkeeper sheets, referee, pitch and goals — or only part of it?
3. If it is not CC0, would I be required to publish my modified artwork under a
   share-alike licence (CC-BY-SA)?

Crediting you is not a problem at all and I'm happy to do it either way — I just need to
know whether share-alike applies, because that affects whether I can use the pack at all.

A one-line reply is completely fine. Thank you for your work, and for taking the time.

Best regards,
Vertical Striker (indie project)
```

---

## 回答が来たら

1. 回答を**日付が分かる形でスクリーンショット保存**する。ページ上に License 欄が無い以上、
   これが唯一の証跡になる
2. `docs/asset-credits.md` の表に、確定したライセンスと確認日・確認方法を記録する
3. **CC-BY-SA だった場合は採用しない**（継承義務のある素材は使わない、というユーザー判断）

### CC-BY-SA だった場合の代替

**既存の自作ベクター生成スプライトを伸ばす**（`src/render/playerSprites.ts`、23周目に
7.25頭身へ作り直し済み）。外部素材に戻る場合は、**16x16 を要件から外す**こと —
16px の枠では人型は必然的に2頭身前後にしかならず、GB素材（約2頭身）も
Puny Characters（約1.6頭身）も同じ理由で不採用になった。キャラ全高 24〜32px 以上が要る。
詳細は `docs/v2-player-sprite-assets.md`。

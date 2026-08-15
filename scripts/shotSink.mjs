import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * 開発時の画面確認用の受け口 (描画の目視検証専用、ゲーム本体とは無関係)。
 *
 * 背景: 開発環境のブラウザpaneは非表示だとスクリーンショットが取れない (compositingが
 * 走らない) ため、14周目に __vsDebug.renderAt() で canvas を dataURL として取り出す方法を
 * 用意した。しかしその dataURL をディスクへ持ってくる経路が無く、毎回巨大な文字列を
 * 手で運ぶ必要があった。このサーバはページからの POST を受けてファイルに書くだけの
 * 最小の受け口で、その運搬をなくす。
 *
 * 使い方:
 *   node scripts/shotSink.mjs [port]           # 既定 5199
 *   ページ側: fetch('http://localhost:5199/shot?name=xxx', {method:'POST', body: dataURL})
 */
const port = Number(process.argv[2] ?? 5199);
const outDir = resolve('.shots');
mkdirSync(outDir, { recursive: true });

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url ?? '/', 'http://localhost');
    const name = (url.searchParams.get('name') ?? 'shot').replace(/[^a-zA-Z0-9._-]/g, '');
    const comma = body.indexOf(',');
    const base64 = body.startsWith('data:') && comma >= 0 ? body.slice(comma + 1) : body;
    const ext = body.includes('image/jpeg') ? 'jpg' : 'png';
    const file = resolve(outDir, `${name}.${ext}`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(base64, 'base64'));
    console.log(`wrote ${file} (${base64.length} b64 chars)`);
    res.writeHead(200).end(file);
  });
}).listen(port, () => console.log(`shot sink listening on ${port}`));

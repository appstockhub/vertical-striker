#!/usr/bin/env node
// 決定論チェッカー: src/sim/** に禁止パターンが無いか静的に grep する。
// 依存を増やしたくないため ESLint ではなくこの小さなスクリプトで代替する。
//
// 禁止事項 (CLAUDE.md の「決定論を壊さない」原則):
//  - Math.random() の使用
//  - Math.sin / Math.cos / Math.atan2 の使用 (丸め誤差がエンジン間で bit-exact にならない)
//  - phaser のインポート (sim/ はレンダラーから完全に独立させる)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const simDir = join(repoRoot, 'src', 'sim');

const FORBIDDEN_PATTERNS = [
  { name: 'Math.random()', regex: /Math\.random\s*\(/ },
  { name: 'Math.sin()', regex: /Math\.sin\s*\(/ },
  { name: 'Math.cos()', regex: /Math\.cos\s*\(/ },
  { name: 'Math.atan2()', regex: /Math\.atan2\s*\(/ },
  { name: "import from 'phaser'", regex: /from\s+['"]phaser['"]/ },
];

function walk(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      files.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

let violations = [];

try {
  const files = walk(simDir);
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      // コメント行 (// ... , 行頭 * のブロックコメント継続行) は説明文で禁止語を
      // 引用することがあるため対象外にする。
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        return;
      }
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.regex.test(line)) {
          violations.push(`${file}:${i + 1}: forbidden ${pattern.name} — "${trimmed}"`);
        }
      }
    });
  }
} catch (err) {
  console.error(`checkDeterminism: failed to scan ${simDir}:`, err.message);
  process.exit(1);
}

if (violations.length > 0) {
  console.error('checkDeterminism: FAILED — determinism violations found in src/sim/:\n');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}

console.log(`checkDeterminism: OK — no forbidden patterns found in src/sim/`);

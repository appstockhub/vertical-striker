/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// base: './' — GitHub Pages では repo 名がサブパスになるため相対パスにしておく
// (Phase 0 では未デプロイだが Phase 1 完了時のデプロイに備える)
export default defineConfig({
  base: './',
  build: {
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias: { '@audit': fileURLToPath(new URL('../../../../src', import.meta.url)) } },
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['*.repro.tsx'],
    environment: 'jsdom',
    setupFiles: fileURLToPath(new URL('../../../../src/test/setup.ts', import.meta.url)),
  },
});

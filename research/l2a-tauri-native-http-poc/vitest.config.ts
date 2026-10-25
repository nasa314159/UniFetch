import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

const fromHere = (path: string): string =>
  fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@unifetch/core': fromHere('../../packages/core/src/index.ts'),
      '@unifetch/meta-resolver/instagram': fromHere(
        '../../packages/meta-resolver/src/instagram/index.ts',
      ),
      '@unifetch/meta-resolver/threads': fromHere(
        '../../packages/meta-resolver/src/threads/index.ts',
      ),
      '@unifetch/downloader/filename': fromHere(
        '../../packages/downloader/src/filename.ts',
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 15_000,
  },
});

import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  plugins: [vue()],
  test: {
    include: [
      'src/**/*.test.ts',
      '../../packages/*/src/**/*.test.ts',
      '../resolver-worker/src/**/*.test.ts',
      '../extension/src/**/*.test.ts',
    ],
  },
});

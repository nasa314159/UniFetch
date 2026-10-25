import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const fromHere = (path: string): string =>
  fileURLToPath(new URL(path, import.meta.url));

/**
 * The PoC consumes the production TypeScript packages as source. This keeps a
 * single parser/normalizer implementation while leaving the production pnpm
 * workspace untouched.
 */
const unifetchAliases = {
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
};

export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
  server: {
    port: 1420,
    strictPort: true,
    fs: { allow: [fromHere('../..')] },
  },
  resolve: {
    alias: unifetchAliases,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});

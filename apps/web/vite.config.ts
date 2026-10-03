import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'script',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'UniFetch',
        short_name: 'UniFetch',
        description:
          'Save media you can already access. Direct media. Transparently.',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        theme_color: '#f5f6f2',
        background_color: '#f5f6f2',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
        share_target: {
          action: '/share',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,ico}', 'icon*.{svg,png}'],
        globIgnores: ['**/demo/**'],
        runtimeCaching: [],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/share(?:[/?]|$)/, /^\/demo(?:[/?]|$)/],
      },
    }),
  ],
});

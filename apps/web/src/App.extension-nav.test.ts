import { describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createMemoryHistory, createRouter } from 'vue-router';
import App from './App.vue';

describe('site-wide extension installation entry', () => {
  it('renders an accessible link to /extension in the header', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<p>Home</p>' } },
        { path: '/extension', component: { template: '<p>Extension</p>' } },
      ],
    });
    await router.push('/');
    await router.isReady();
    const html = await renderToString(createSSRApp(App).use(router));
    const header = html.match(/<header[^>]*>(.*?)<\/header>/s)?.[1] ?? '';
    expect(header).toContain('href="/extension"');
    expect(header).toContain('aria-label="Install Browser Extension"');
    expect(header).toContain('Install Browser Extension');
    expect(header).toContain('Extension');
  });
});

import { describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createMemoryHistory, createRouter } from 'vue-router';
import appSource from '../App.vue?raw';
import pwaSource from '../../vite.config.ts?raw';
import InstallInstructions from './InstallInstructions.vue';
import App from '../App.vue';
describe('Install guidance and header', () => {
  it('renders Safari Share and Home Screen instructions with a dismissible accessible dialog', async () => {
    const html = await renderToString(
      createSSRApp(InstallInstructions, { open: true, ios: true }),
    );
    expect(html).toContain('<dialog');
    expect(html).toContain('aria-labelledby="install-title"');
    expect(html).toContain('Tap the Share button in Safari');
    expect(html).toContain('Add to Home Screen');
    expect(html).toContain('Tap “Add”');
    expect(html).toContain('Close');
    expect(html).toContain('autofocus');
    expect(html).not.toContain('Share Target');
    expect(html).not.toContain('Android');
  });
  it('provides generic browser guidance without Safari-specific instructions', async () => {
    const html = await renderToString(
      createSSRApp(InstallInstructions, { open: true, ios: false }),
    );
    expect(html).toContain('browser’s Install app / Add to Home Screen option');
    expect(html).not.toContain('button in Safari');
  });
  it('keeps the compact header brand and Install entry point without requiring a prompt', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<p>Home</p>' } }],
    });
    await router.push('/');
    await router.isReady();
    const html = await renderToString(createSSRApp(App).use(router));
    const header = html.match(/<header[^>]*>(.*?)<\/header>/s)?.[1];
    expect(header).toContain('UniFetch home');
    expect(header).toContain('class="install"');
    expect(header).toContain('Install');
    expect(header).not.toContain('No media proxy');
    const source = appSource;
    expect(source).toContain('No media proxy');
    expect(source).toContain('justify-content: space-between');
    expect(source).toContain('@media (max-width: 540px)');
  });
  it('keeps the existing PWA manifest and GET share-target contract', () => {
    const source = pwaSource;
    expect(source).toContain("display: 'standalone'");
    expect(source).toContain("scope: '/'");
    expect(source).toContain("start_url: '/'");
    expect(source).toContain("action: '/share'");
    expect(source).toContain("method: 'GET'");
    expect(source).toContain(
      "params: { title: 'title', text: 'text', url: 'url' }",
    );
    expect(source).toContain('runtimeCaching: []');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import HomeView from './HomeView.vue';
import { useResolutionStore } from '../stores/resolution';
import manifestSource from '../../vite.config.ts?raw';

async function share(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: HomeView },
      { path: '/share', component: HomeView },
    ],
  });
  const pinia = createPinia();
  const store = useResolutionStore(pinia);
  const resolve = vi.spyOn(store, 'resolve').mockImplementation(async () => {
    expect(router.currentRoute.value.fullPath).toBe('/');
  });
  await router.push(path);
  await renderToString(createSSRApp(HomeView).use(pinia).use(router));
  await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/'));
  await Promise.resolve();
  return { router, store, resolve };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('Shortcut input uses the existing Android share flow', () => {
  it.each(['p', 'reel', 'reels'])(
    'decodes encoded /%s/ and auto-resolves after scrubbing',
    async (kind) => {
      const url = `https://www.instagram.com/${kind}/unifetch-demo-input/?igsh=demo&utm_source=demo&functional=a%26b`;
      const { resolve, router } = await share(
        `/share?url=${encodeURIComponent(url)}`,
      );
      await vi.waitFor(() => expect(resolve).toHaveBeenCalledOnce());
      expect(resolve).toHaveBeenCalledWith(
        `https://www.instagram.com/${kind}/unifetch-demo-input/?functional=a%26b`,
      );
      expect(router.currentRoute.value.query).toEqual({});
    },
  );
  it('does not persist shared input', async () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    const open = vi.fn();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    vi.stubGlobal('indexedDB', { open });
    const { resolve } = await share(
      `/share?url=${encodeURIComponent('https://instagram.com/p/unifetch-demo-image/')}`,
    );
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledOnce());
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
  it.each([
    '',
    '?url=',
    '?url=javascript%3Aalert(1)',
    '?url=https%3A%2F%2Fexample.invalid%2Fp%2Fdemo%2F',
  ])('handles invalid or empty input %s safely', async (query) => {
    const { resolve, store } = await share(`/share${query}`);
    expect(resolve).not.toHaveBeenCalled();
    expect(store.error?.code).toBe('INVALID_URL');
  });
  it('retains Android text/title share parsing', async () => {
    const { resolve } = await share(
      `/share?text=${encodeURIComponent('Shared https://instagram.com/p/unifetch-demo-image/')}&title=Demo`,
    );
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledOnce());
    expect(resolve).toHaveBeenCalledWith(
      'https://www.instagram.com/p/unifetch-demo-image/',
    );
  });
  it('keeps Android GET share_target unchanged', () => {
    expect(manifestSource).toContain("action: '/share'");
    expect(manifestSource).toContain("method: 'GET'");
    expect(manifestSource).toContain(
      "params: { title: 'title', text: 'text', url: 'url' }",
    );
  });
});

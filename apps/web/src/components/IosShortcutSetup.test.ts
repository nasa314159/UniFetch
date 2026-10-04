import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createMemoryHistory, createRouter } from 'vue-router';
import App from '../App.vue';

async function render(userAgent: string, standalone: boolean) {
  vi.stubGlobal('navigator', { userAgent, maxTouchPoints: 1, standalone });
  const events = new EventTarget();
  vi.stubGlobal(
    'window',
    Object.assign(events, {
      matchMedia: () =>
        Object.assign(new EventTarget(), { matches: standalone }),
    }),
  );
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<p>Home</p>' } }],
  });
  await router.push('/');
  return renderToString(createSSRApp(App).use(router));
}

afterEach(() => vi.unstubAllGlobals());
describe('iOS sharing setup visibility', () => {
  it('shows setup in iOS Safari alongside Install', async () => {
    const html = await render('iPhone Version/18.0 Mobile Safari/604.1', false);
    expect(html).toContain('Add UniFetch Shortcut');
    expect(html).toContain(
      'href="https://www.icloud.com/shortcuts/9ff25727f16a43cfa6eac1e3ccd49a82"',
    );
    expect(html).toContain('Manual setup fallback');
    expect(html).toContain('class="install"');
    expect(html).toContain('https://unifetch.pages.dev/share?url=');
  });
  it('keeps setup discoverable in installed iOS standalone mode', async () => {
    const html = await render('iPhone Version/18.0 Mobile Safari/604.1', true);
    expect(html).toContain('Add UniFetch Shortcut');
    expect(html).toContain(
      'href="https://www.icloud.com/shortcuts/9ff25727f16a43cfa6eac1e3ccd49a82"',
    );
    expect(html).toContain('Manual setup fallback');
    expect(html).not.toContain('class="install"');
  });
  it.each(['Android Chrome/130.0', 'Windows Chrome/130.0'])(
    'does not show iOS setup on %s',
    async (userAgent) => {
      expect(await render(userAgent, false)).not.toContain(
        'Set up Instagram sharing',
      );
    },
  );
});

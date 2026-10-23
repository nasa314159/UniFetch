import { describe, expect, it } from 'vitest';
import { routes } from './routes';

describe('public Web/PWA routes', () => {
  it('keeps the existing home and share routes', () => {
    const paths = routes.map((route) => route.path);
    expect(paths).toContain('/');
    expect(paths).toContain('/share');
  });

  it('adds a dedicated extension installation route before the fallback', () => {
    const paths = routes.map((route) => route.path);
    expect(paths).toContain('/extension');
    expect(paths.at(-1)).toBe('/:pathMatch(.*)*');
  });

  it('uses the shared home view for share-target payloads', () => {
    const home = routes.find((route) => route.path === '/');
    const share = routes.find((route) => route.path === '/share');
    expect(share?.component).toBe(home?.component);
  });

  it('keeps the extension route out of the catch-all redirect', () => {
    const fallback = routes.find((route) => route.path === '/:pathMatch(.*)*');
    expect(fallback?.redirect).toBe('/');
    expect(routes.some((route) => route.path === '/extension')).toBe(true);
  });
});

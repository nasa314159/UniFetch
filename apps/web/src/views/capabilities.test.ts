import { describe, expect, it } from 'vitest';
import homeView from './HomeView.vue?raw';

/**
 * The public Web/PWA deployment has no authenticated browser context. It must
 * never advertise extension-only capabilities (Stories, authenticated access)
 * as available on the web.
 */
describe('Web/PWA capability claims', () => {
  it('lists only the public Instagram content types it actually supports', () => {
    expect(homeView).toContain('Post · Carousel · Reel');
  });

  it('does not advertise Instagram Stories on the Web/PWA', () => {
    expect(homeView).not.toMatch(/\bstor(y|ies)\b/i);
  });

  it('does not advertise authenticated extension functionality', () => {
    expect(homeView.toLowerCase()).not.toContain('extension');
    expect(homeView.toLowerCase()).not.toContain('authenticated');
  });

  it('keeps Facebook and Threads explicitly planned only', () => {
    const facebook = homeView.indexOf('<h3>Facebook</h3>');
    const threads = homeView.indexOf('<h3>Threads</h3>');
    expect(facebook).toBeGreaterThan(-1);
    expect(threads).toBeGreaterThan(-1);
    expect(homeView.slice(facebook, facebook + 200)).toContain('Coming soon');
    expect(homeView.slice(threads, threads + 200)).toContain('Coming soon');
  });
});

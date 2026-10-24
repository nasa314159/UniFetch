import { describe, expect, it } from 'vitest';
import homeView from './HomeView.vue?raw';

const homeText = homeView.replace(/\s+/g, ' ');

/**
 * The public Web/PWA deployment has no authenticated browser context. It must
 * never advertise extension-only capabilities (Stories, authenticated access)
 * as available on the web. It may describe them only inside the clearly
 * labelled desktop-extension entry that links to /extension.
 */
describe('Web/PWA capability claims', () => {
  it('lists only the public Instagram content types it actually supports', () => {
    expect(homeText).toContain('Post · Carousel · Reel');
  });

  it('does not claim the Web/PWA itself supports Instagram Stories', () => {
    expect(homeView).toContain(
      'The Web/PWA resolves public Instagram Post, Carousel and Reel links,',
    );
    expect(homeView).not.toMatch(/Web\/PWA[^.]{0,120}\bstor(y|ies)\b/i);
  });

  it('describes Stories only as an explicit-ID extension capability', () => {
    expect(homeText).toContain('UniFetch Browser Extension');
    expect(homeText).toContain('explicit Story ID');
    expect(homeView).not.toMatch(/\bany Story\b/i);
    expect(homeView).not.toMatch(/\ball Stories\b/i);
  });

  it('links to the dedicated extension installation route', () => {
    expect(homeText).toContain('Install Browser Extension');
    expect(homeView).toContain('to="/extension"');
  });

  it('does not pretend the extension is in the Chrome Web Store', () => {
    expect(homeText).toContain('Not in the Chrome Web Store');
    expect(homeView).not.toMatch(/available (?:in|on) the Chrome Web Store/i);
  });

  it('does not advertise unverified desktop-install support on mobile', () => {
    expect(homeText).toContain('Desktop Chrome / Chromium only');
  });

  it('keeps Facebook explicitly planned only', () => {
    const facebook = homeView.indexOf('<h3>Facebook</h3>');
    expect(facebook).toBeGreaterThan(-1);
    expect(homeView.slice(facebook, facebook + 200)).toContain('Coming soon');
  });

  it('describes public Threads support without claiming private or authenticated access', () => {
    const threads = homeView.indexOf('<h3>Threads');
    expect(threads).toBeGreaterThan(-1);
    const card = homeView.slice(threads, threads + 240);
    expect(card).toContain('Public Post · Video · GIF');
    expect(card).not.toContain('Coming soon');
    expect(homeView).not.toMatch(
      /Threads[^.]{0,120}(?:private|login|authenticated)/i,
    );
  });
});

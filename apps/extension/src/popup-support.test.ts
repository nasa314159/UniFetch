import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  isManualTarget,
  parseManualInstagramUrl,
  readClipboardText,
  resolveTargetUrl,
} from './popup-support';

const tabUrl = 'https://www.instagram.com/';

describe('manual URL target priority', () => {
  it('prefers a manual URL over the active tab URL', () => {
    const manual = 'https://www.instagram.com/p/Abc_12/';
    expect(resolveTargetUrl(manual, tabUrl)).toBe(manual);
    expect(isManualTarget(manual)).toBe(true);
  });

  it('falls back to the active tab URL when the input is blank', () => {
    for (const blank of [undefined, '', '   ']) {
      expect(resolveTargetUrl(blank, tabUrl)).toBe(tabUrl);
      expect(isManualTarget(blank)).toBe(false);
    }
  });
});

describe('manual Instagram URL validation via existing parsers', () => {
  it.each([
    [
      'https://www.instagram.com/p/Abc_12/',
      'post',
      'https://www.instagram.com/p/Abc_12/',
    ],
    [
      'https://www.instagram.com/reel/Abc_12/',
      'reel',
      'https://www.instagram.com/reel/Abc_12/',
    ],
    [
      'https://www.instagram.com/stories/some.user/1234567890123456789/',
      'story',
      'https://www.instagram.com/stories/some.user/1234567890123456789/',
    ],
    [
      'https://www.instagram.com/stories/some.user/',
      'story-profile',
      'https://www.instagram.com/stories/some.user/',
    ],
  ] as const)('accepts %s as %s', (input, kind, canonicalUrl) => {
    expect(parseManualInstagramUrl(input)).toEqual({ kind, canonicalUrl });
  });

  it('strips tracking parameters from an accepted URL', () => {
    expect(
      parseManualInstagramUrl(
        'https://www.instagram.com/p/Abc_12/?igsh=secret&utm_source=share',
      ),
    ).toEqual({
      kind: 'post',
      canonicalUrl: 'https://www.instagram.com/p/Abc_12/',
    });
  });

  it.each([
    undefined,
    '',
    '   ',
    'not a url',
    'https://example.com/p/Abc_12/',
    'https://www.facebook.com/p/Abc_12/',
    'https://www.instagram.com/someuser/',
    'https://www.instagram.com/stories/highlights/17900000000000000/',
  ])('rejects unsupported input %s', (input) => {
    expect(parseManualInstagramUrl(input)).toBeUndefined();
  });
});

describe('explicit-click clipboard read', () => {
  it('returns the first clipboard text item when clicked', async () => {
    const readText = vi.fn(async () => 'https://www.instagram.com/p/Abc_12/');
    await expect(readClipboardText({ readText })).resolves.toBe(
      'https://www.instagram.com/p/Abc_12/',
    );
    expect(readText).toHaveBeenCalledOnce();
  });

  it('returns undefined without a clipboard or on an empty/failed read', async () => {
    await expect(readClipboardText(undefined)).resolves.toBeUndefined();
    await expect(
      readClipboardText({ readText: async () => '   ' }),
    ).resolves.toBeUndefined();
    await expect(
      readClipboardText({
        readText: async () => {
          throw new Error('Clipboard unavailable');
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('is only invoked from the explicit Paste click, never on open', () => {
    const popup = readFileSync(new URL('./popup.ts', import.meta.url), 'utf8');
    const reads = popup.match(/readClipboardText\(/g) ?? [];
    expect(reads).toHaveLength(1);
    const paste = popup.indexOf('pasteButton?.addEventListener');
    const read = popup.indexOf('readClipboardText(');
    expect(paste).toBeGreaterThanOrEqual(0);
    expect(read).toBeGreaterThan(paste);
    expect(popup).not.toMatch(/readClipboardText[\s\S]*?onload/);
  });

  it('never persists or logs clipboard contents', () => {
    const sources = [
      readFileSync(new URL('./popup.ts', import.meta.url), 'utf8'),
      readFileSync(new URL('./popup-support.ts', import.meta.url), 'utf8'),
    ].join('\n');
    for (const token of [
      'chrome.storage',
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'setItem',
      'console.',
      'chrome.cookies',
      'document.cookie',
      'sessionid',
    ])
      expect(sources).not.toContain(token);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { MediaAsset } from '@unifetch/core';
import {
  cacheMatches,
  createSingleFlight,
  downloadAllCurrentTarget,
  type ResolvedCache,
} from './download-flow';
import type {
  ExtensionContentType,
  ExtensionResolveResponse,
  ResolveErrorCode,
} from './resolve';

function asset(id: string, type: 'image' | 'video' = 'image'): MediaAsset {
  return {
    id,
    type,
    url: `https://media.invalid/${id}`,
    suggestedFilename: id,
  };
}

function success(
  contentType: ExtensionContentType,
  assets: MediaAsset[],
): ExtensionResolveResponse {
  return { ok: true, contentType, assets };
}

function failure(
  error: ResolveErrorCode,
  contentType?: ExtensionContentType,
): ExtensionResolveResponse {
  return { ok: false, error, ...(contentType ? { contentType } : {}) };
}

function cache(
  fingerprint: string,
  assets: MediaAsset[],
  contentType: ExtensionContentType = 'post',
): ResolvedCache {
  return { fingerprint, contentType, assets };
}

describe('Download all is enabled before Resolve', () => {
  it('does not disable the Download all button in the popup markup', () => {
    const html = readFileSync(
      new URL('../popup.html', import.meta.url),
      'utf8',
    );
    expect(html).toMatch(/<button id="download"[^>]*>Download all<\/button>/);
    expect(html).not.toMatch(/<button id="download"[^>]*disabled/);
  });
});

describe('downloadAllCurrentTarget', () => {
  it('resolves then downloads when nothing is cached', async () => {
    const resolve = vi.fn(async () => success('post', [asset('a')]));
    const download = vi.fn(async (assets: readonly MediaAsset[]) => ({
      requested: assets.length,
      failed: 0,
    }));
    const outcome = await downloadAllCurrentTarget({
      fingerprint: 'manual:u',
      resolve,
      download,
    });
    expect(resolve).toHaveBeenCalledOnce();
    expect(download).toHaveBeenCalledExactlyOnceWith([asset('a')]);
    expect(outcome.downloaded).toBe(true);
    expect(outcome.message).toBe('Post downloaded · 1 asset(s)');
    expect(outcome.cache).toEqual(cache('manual:u', [asset('a')]));
  });

  it('reuses matching cached assets and skips re-resolving', async () => {
    const resolve = vi.fn(async () => success('post', [asset('x')]));
    const download = vi.fn(async (assets: readonly MediaAsset[]) => ({
      requested: assets.length,
      failed: 0,
    }));
    const cached = cache('manual:u', [asset('a')]);
    const outcome = await downloadAllCurrentTarget({
      cache: cached,
      fingerprint: 'manual:u',
      resolve,
      download,
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledExactlyOnceWith([asset('a')]);
    expect(outcome.cache).toEqual(cached);
  });

  it('invalidates stale assets when the manual URL changed', async () => {
    const resolve = vi.fn(async () => success('post', [asset('b')]));
    const download = vi.fn(async (assets: readonly MediaAsset[]) => ({
      requested: assets.length,
      failed: 0,
    }));
    await downloadAllCurrentTarget({
      cache: cache('manual:A', [asset('a')]),
      fingerprint: 'manual:B',
      resolve,
      download,
    });
    expect(resolve).toHaveBeenCalledOnce();
    expect(download).toHaveBeenCalledExactlyOnceWith([asset('b')]);
  });

  it('does not reuse manual assets for a blank-input active-tab target', async () => {
    const resolve = vi.fn(async () => success('post', [asset('t')]));
    const download = vi.fn(async (assets: readonly MediaAsset[]) => ({
      requested: assets.length,
      failed: 0,
    }));
    await downloadAllCurrentTarget({
      cache: cache('manual:A', [asset('a')]),
      fingerprint: 'tab:7:https://www.instagram.com/p/Abc_12/',
      resolve,
      download,
    });
    expect(resolve).toHaveBeenCalledOnce();
    expect(download).toHaveBeenCalledExactlyOnceWith([asset('t')]);
  });

  it('does not download when resolution fails', async () => {
    const resolve = vi.fn(async () => failure('LOGIN_REQUIRED', 'post'));
    const download = vi.fn(async () => ({ requested: 0, failed: 0 }));
    const outcome = await downloadAllCurrentTarget({
      fingerprint: 'manual:u',
      resolve,
      download,
    });
    expect(download).not.toHaveBeenCalled();
    expect(outcome.downloaded).toBe(false);
    expect(outcome.message).toBe('Post failed · LOGIN_REQUIRED');
    expect(outcome.cache).toBeUndefined();
  });

  it('reports DOWNLOAD_FAILED when the download step fails after resolve', async () => {
    const resolve = vi.fn(async () => success('post', [asset('a')]));
    const download = vi.fn(async () => {
      throw new Error('blocked');
    });
    const outcome = await downloadAllCurrentTarget({
      fingerprint: 'manual:u',
      resolve,
      download,
    });
    expect(outcome.downloaded).toBe(false);
    expect(outcome.message).toContain('DOWNLOAD_FAILED');
    expect(outcome.message).not.toContain('LOGIN_REQUIRED');
    // The asset is kept so a retry can reuse it.
    expect(outcome.cache?.assets).toEqual([asset('a')]);
  });

  it.each([
    ['Carousel', 'carousel', [asset('a'), asset('b'), asset('c', 'video')]],
    ['Reel', 'reel', [asset('v', 'video')]],
    ['Story', 'story', [asset('s')]],
  ] as const)(
    '%s downloads all resolved assets',
    async (_name, contentType, assets) => {
      const resolve = vi.fn(async () => success(contentType, [...assets]));
      const download = vi.fn(async (items: readonly MediaAsset[]) => ({
        requested: items.length,
        failed: 0,
      }));
      const outcome = await downloadAllCurrentTarget({
        fingerprint: 'manual:u',
        resolve,
        download,
      });
      expect(download).toHaveBeenCalledExactlyOnceWith(assets);
      expect(outcome.downloaded).toBe(true);
    },
  );
});

describe('cacheMatches', () => {
  it('requires the same fingerprint and at least one asset', () => {
    expect(cacheMatches(cache('a', [asset('x')]), 'a')).toBe(true);
    expect(cacheMatches(cache('a', [asset('x')]), 'b')).toBe(false);
    expect(cacheMatches(cache('a', []), 'a')).toBe(false);
    expect(cacheMatches(undefined, 'a')).toBe(false);
  });
});

describe('single-flight guard', () => {
  it('prevents duplicate concurrent Download all runs', async () => {
    const flight = createSingleFlight();
    let release: () => void = () => {};
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = flight.run(task);
    const second = flight.run(task);
    expect(flight.busy).toBe(true);
    release();
    const results = await Promise.all([first, second]);
    expect(task).toHaveBeenCalledOnce();
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(flight.busy).toBe(false);
  });
});

describe('Resolve remains an independent action', () => {
  const popup = readFileSync(new URL('./popup.ts', import.meta.url), 'utf8');

  it('keeps a Resolve handler that caches assets', () => {
    expect(popup).toContain('resolveButton?.addEventListener');
    expect(popup).toContain('resolvedCache =');
    expect(popup).toContain('applyResolveResponse(response');
  });

  it('Download all resolves on demand without a prior Resolve', () => {
    expect(popup).toContain('downloadAllCurrentTarget(');
    expect(popup).toContain('downloadGuard.run');
  });
});

describe('M8D download-flow boundary', () => {
  const sources = [
    readFileSync(new URL('./download-flow.ts', import.meta.url), 'utf8'),
    readFileSync(new URL('./popup.ts', import.meta.url), 'utf8'),
  ].join('\n');

  it.each([
    'chrome.storage',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'setItem',
    'pages.dev',
    'unifetch.pages',
    'workers.dev',
    '/api/resolve',
    'chrome.cookies',
    'document.cookie',
    'sessionid',
  ])('never introduces the forbidden token %s', (token) => {
    expect(sources).not.toContain(token);
  });
});

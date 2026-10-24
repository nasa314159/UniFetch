import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { MediaAsset } from '@unifetch/core';
import { parseInstagramContentRef } from '@unifetch/meta-resolver/instagram';
import { resolveStrategyOutcome } from './classify';
import type { RawStrategyOutcome } from './contracts';
import { parseManualInstagramUrl, resolveTargetUrl } from './popup-support';
import {
  applyResolveResponse,
  describeDownload,
  runAssetDownloads,
  type ExtensionResolveResponse,
} from './resolve';
import { firstInstagramTarget, parseInstagramTarget } from './target';
import carousel from '../../../packages/meta-resolver/src/instagram/__fixtures__/carousel-response.json';
import reel from '../../../packages/meta-resolver/src/instagram/__fixtures__/reel-response.json';
import singleImage from '../../../packages/meta-resolver/src/instagram/__fixtures__/single-image-response.json';

const ref = parseInstagramContentRef('https://www.instagram.com/p/Abc_12/');

function outcome(body: unknown): RawStrategyOutcome {
  return {
    reached: true,
    httpStatus: 200,
    responseKind: 'JSON',
    csrfUsed: false,
    jsonText: JSON.stringify(body),
  };
}

function asset(id: string, type: 'image' | 'video' = 'image'): MediaAsset {
  return {
    id,
    type,
    url: `https://media.invalid/${id}`,
    suggestedFilename: `${id}`,
  };
}

describe('local Post/Reel/Carousel resolution', () => {
  it('resolves a Post image through the existing parser and normalizer', () => {
    const resolved = resolveStrategyOutcome(
      'background-fetch',
      outcome(singleImage),
      ref,
    );
    expect(resolved.result).toMatchObject({
      status: 'SUCCESS',
      assetCount: 1,
      assetTypes: ['image'],
    });
    expect(resolved.assets).toHaveLength(1);
    expect(resolved.assets?.[0].suggestedFilename).toBe(
      'unifetch_schema_demo_Fictional-geometric-postcard-f.jpg',
    );
  });

  it('resolves a Carousel to all assets with original indices', () => {
    const resolved = resolveStrategyOutcome(
      'background-fetch',
      outcome(carousel),
      ref,
    );
    expect(resolved.assets?.map((item) => item.suggestedFilename)).toEqual([
      'unifetch_schema_demo_Four-fictional-color-studies-i_01.jpg',
      'unifetch_schema_demo_Four-fictional-color-studies-i_02.jpg',
      'unifetch_schema_demo_Four-fictional-color-studies-i_03.mp4',
      'unifetch_schema_demo_Four-fictional-color-studies-i_04.jpg',
    ]);
  });

  it('resolves a Reel to a single video asset', () => {
    const resolved = resolveStrategyOutcome(
      'background-fetch',
      outcome(reel),
      ref,
    );
    expect(resolved.result).toMatchObject({ status: 'SUCCESS', assetCount: 1 });
    expect(resolved.assets?.[0].type).toBe('video');
    expect(resolved.assets?.[0].suggestedFilename).toBe(
      'unifetch_schema_demo_Fictional-motion-study-for-an.mp4',
    );
  });
});

describe('unified resolve response -> popup download state', () => {
  it('Post success enables Download all and stores the asset', () => {
    const response: ExtensionResolveResponse = {
      ok: true,
      contentType: 'post',
      assets: [asset('a')],
    };
    const state = applyResolveResponse(response);
    expect(state.downloadEnabled).toBe(true);
    expect(state.assets).toHaveLength(1);
    expect(state.contentType).toBe('post');
    expect(state.message).toBe('Post resolved · 1 asset(s) · image');
  });

  it('Carousel success stores every asset and enables Download all', () => {
    const assets = [asset('a'), asset('b'), asset('c', 'video')];
    const state = applyResolveResponse({
      ok: true,
      contentType: 'carousel',
      assets,
    });
    expect(state.downloadEnabled).toBe(true);
    expect(state.assets).toEqual(assets);
    expect(state.message).toContain('Carousel resolved · 3 asset(s)');
  });

  it('Reel and Story success enable Download all', () => {
    for (const contentType of ['reel', 'story'] as const) {
      const state = applyResolveResponse({
        ok: true,
        contentType,
        assets: [asset('a', contentType === 'reel' ? 'video' : 'image')],
      });
      expect(state.downloadEnabled).toBe(true);
      expect(state.assets).toHaveLength(1);
    }
  });

  it('never formats a successful background result as UNKNOWN', () => {
    const state = applyResolveResponse({
      ok: true,
      contentType: 'post',
      assets: [asset('a')],
    });
    expect(state.message).not.toContain('UNKNOWN');
    expect(state.message).not.toContain('failed');
  });

  it('a failure clears prior assets and disables Download all', () => {
    const state = applyResolveResponse({
      ok: false,
      error: 'LOGIN_REQUIRED',
      contentType: 'post',
    });
    expect(state.downloadEnabled).toBe(false);
    expect(state.assets).toEqual([]);
    expect(state.message).toBe('Post failed · LOGIN_REQUIRED');
  });

  it('starts disabled before any success', () => {
    const state = applyResolveResponse(undefined);
    expect(state.downloadEnabled).toBe(false);
    expect(state.assets).toEqual([]);
    expect(state.message).toBe('Item failed · UNKNOWN');
  });

  it('treats a malformed success response as a typed failure', () => {
    const state = applyResolveResponse(
      { ok: true, status: 'SUCCESS', kind: 'post', assets: [asset('a')] },
      'Post',
    );
    expect(state.downloadEnabled).toBe(false);
    expect(state.message).toBe('Post failed · UNKNOWN');
  });

  it('uses the hydrated content type for failure wording', () => {
    expect(
      applyResolveResponse({ ok: false, error: 'INVALID_URL' }, 'Post').message,
    ).toBe('Post failed · INVALID_URL');
    expect(
      applyResolveResponse(
        { ok: false, error: 'PARSER_OUTDATED', contentType: 'reel' },
        'Item',
      ).message,
    ).toBe('Reel failed · PARSER_OUTDATED');
  });

  it('labels Threads results and distinguishes GIF/video media', () => {
    const gif: MediaAsset = {
      ...asset('gif'),
      mimeType: 'image/gif',
      suggestedFilename: 'threads_demo.gif',
    };
    expect(
      applyResolveResponse({
        ok: true,
        platform: 'threads',
        contentType: 'post',
        assets: [gif],
      }).message,
    ).toBe('Threads Post resolved · 1 asset(s) · gif');
    expect(
      applyResolveResponse({
        ok: true,
        platform: 'threads',
        contentType: 'post',
        assets: [asset('video', 'video')],
      }).message,
    ).toBe('Threads Post resolved · 1 asset(s) · video');
    expect(
      applyResolveResponse({
        ok: false,
        platform: 'threads',
        contentType: 'post',
        error: 'CONTENT_UNAVAILABLE',
      }).message,
    ).toBe('Threads Post failed · CONTENT_UNAVAILABLE');
    expect(
      applyResolveResponse({
        ok: false,
        platform: 'threads',
        contentType: 'post',
        error: 'PERMISSION_REQUIRED',
      }).message,
    ).toBe('Threads Post failed · PERMISSION_REQUIRED');
  });
});

describe('manual URL resolution path', () => {
  it.each([
    ['https://www.instagram.com/p/Abc_12/', 'post'],
    ['https://www.instagram.com/reel/Abc_12/', 'reel'],
    [
      'https://www.instagram.com/stories/some.user/1234567890123456789/',
      'story',
    ],
  ] as const)('manual %s resolves as %s', (input, contentType) => {
    const parsed = parseManualInstagramUrl(input);
    expect(parsed?.kind).toBe(contentType);
    expect(parseInstagramTarget(input)?.kind).toBe(contentType);
    const state = applyResolveResponse(
      { ok: true, contentType, assets: [asset('a')] },
      'Item',
    );
    expect(state.downloadEnabled).toBe(true);
  });

  it('blank manual input falls back to the active tab URL', () => {
    const tabUrl = 'https://www.instagram.com/p/Abc_12/';
    expect(resolveTargetUrl(undefined, tabUrl)).toBe(tabUrl);
    expect(resolveTargetUrl('   ', tabUrl)).toBe(tabUrl);
    expect(firstInstagramTarget([tabUrl])?.kind).toBe('post');
  });
});

describe('download orchestration', () => {
  it('invokes the downloader with every resolved asset', async () => {
    const assets = [asset('a'), asset('b'), asset('c')];
    const download = vi.fn(async () => {});
    const summary = await runAssetDownloads(assets, download, async () => {});
    expect(download).toHaveBeenCalledTimes(3);
    for (const item of assets) expect(download).toHaveBeenCalledWith(item);
    expect(summary).toEqual({ requested: 3, failed: 0 });
  });

  it('reports DOWNLOAD_FAILED when nothing could be saved', async () => {
    const summary = await runAssetDownloads(
      [asset('a')],
      async () => {
        throw new Error('blocked');
      },
      async () => {},
    );
    expect(describeDownload('post', summary)).toBe(
      'Post not downloaded · DOWNLOAD_FAILED',
    );
    expect(describeDownload('post', summary, 'threads')).toBe(
      'Threads Post not downloaded · DOWNLOAD_FAILED',
    );
  });
});

describe('diagnostics do not gate the download state', () => {
  const popup = readFileSync(new URL('./popup.ts', import.meta.url), 'utf8');

  it('drives Download all from the unified resolve state', () => {
    expect(popup).toContain('downloadAllCurrentTarget(');
    expect(popup).toContain('applyResolveResponse(response');
  });

  it('keeps matrix and feasibility handlers separate from resolve state', () => {
    const matrix = popup.slice(
      popup.indexOf('runButton?.addEventListener'),
      popup.indexOf('storyButton?.addEventListener'),
    );
    const feasibility = popup.slice(
      popup.indexOf('storyButton?.addEventListener'),
    );
    for (const block of [matrix, feasibility]) {
      expect(block).not.toContain('resolvedCache');
      expect(block).not.toContain('downloadButton.disabled');
      expect(block).not.toContain('downloadAllCurrentTarget');
    }
  });
});

describe('M8D local-only boundary', () => {
  const sources = ['resolve.ts', 'target.ts', 'classify.ts', 'background.ts']
    .map((file) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'))
    .join('\n');

  it.each([
    'pages.dev',
    'unifetch.pages',
    '/api/resolve',
    'workers.dev',
    'chrome.cookies',
    'document.cookie',
    'sessionid',
    'localStorage',
    'chrome.storage',
    'reel_ids',
    'reels_media',
  ])('never introduces the forbidden token %s', (token) => {
    expect(sources).not.toContain(token);
  });
});

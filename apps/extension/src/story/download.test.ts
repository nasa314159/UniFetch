import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { UniFetchError, type MediaAsset } from '@unifetch/core';
import { downloadLocalAsset } from '@unifetch/downloader';
import { runBackgroundFetch, type FetchLike } from '../strategy';
import { describeStoryDownload, runStoryDownload } from './download';
import { visibleStoryMediaToAsset } from './visible-media';
import { normalizeInstagramStory } from './normalize';
import { parseInstagramStoryResponse } from './parser';
import { parseInstagramStoryRef } from './ref';
import { buildInstagramStoryRequest } from './request';
import storyImage from './__fixtures__/story-image.json';
import storyVideo from './__fixtures__/story-video.json';

const storyUrl =
  'https://www.instagram.com/stories/fictional_account/1234567890123456789/';
const ref = parseInstagramStoryRef(storyUrl);

function imageAsset(): MediaAsset {
  const resolved = normalizeInstagramStory(
    parseInstagramStoryResponse(storyImage),
    ref.canonicalUrl,
  );
  return resolved.post.assets[0];
}

function videoAsset(): MediaAsset {
  const resolved = normalizeInstagramStory(
    parseInstagramStoryResponse(storyVideo),
    ref.canonicalUrl,
  );
  return resolved.post.assets[0];
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    status,
    redirected: false,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('Story acquisition into the existing downloader', () => {
  type Downloader = (asset: MediaAsset) => Promise<void>;

  it('feeds the single normalized image Story asset into the downloader', async () => {
    const asset = imageAsset();
    const download = vi.fn<Downloader>(async () => {});
    const outcome = await runStoryDownload(
      async () => ({ status: 'SUCCESS', asset, assetType: 'image' }),
      download,
    );
    expect(download).toHaveBeenCalledOnce();
    expect(download).toHaveBeenCalledWith(asset);
    expect(outcome).toEqual({ status: 'DOWNLOADED', assetType: 'image' });
  });

  it('feeds the single normalized video Story asset into the downloader', async () => {
    const asset = videoAsset();
    const download = vi.fn<Downloader>(async () => {});
    const outcome = await runStoryDownload(
      async () => ({ status: 'SUCCESS', asset, assetType: 'video' }),
      download,
    );
    expect(download).toHaveBeenCalledWith(asset);
    expect(outcome).toEqual({ status: 'DOWNLOADED', assetType: 'video' });
    expect(asset.type).toBe('video');
  });

  it('does not download when SUCCESS carries no single asset', async () => {
    const download = vi.fn<Downloader>(async () => {});
    const outcome = await runStoryDownload(
      async () => ({ status: 'SUCCESS', assetType: 'image' }),
      download,
    );
    expect(download).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      status: 'UNSUPPORTED_CONTENT',
      assetType: 'image',
    });
  });

  it('never downloads when identity is unproven', async () => {
    const download = vi.fn<Downloader>(async () => {});
    const outcome = await runStoryDownload(
      async () => ({
        status: 'UNSUPPORTED_CONTENT',
        asset: imageAsset(),
        assetType: 'image',
      }),
      download,
    );
    expect(download).not.toHaveBeenCalled();
    expect(outcome.status).toBe('UNSUPPORTED_CONTENT');
  });
});

describe('download versus acquisition failure', () => {
  it('maps a download failure to DOWNLOAD_FAILED, never an acquisition failure', async () => {
    const outcome = await runStoryDownload(
      async () => ({
        status: 'SUCCESS',
        asset: imageAsset(),
        assetType: 'image',
      }),
      async () => {
        throw new UniFetchError('NETWORK_ERROR', 'media unreadable');
      },
    );
    expect(outcome).toEqual({
      status: 'DOWNLOAD_FAILED',
      assetType: 'image',
    });
    expect(outcome.status).not.toBe('SUCCESS');
    expect(outcome.status).not.toBe('NETWORK_ERROR');
  });

  it('preserves the downloader BROWSER_RESTRICTION code on a download failure', async () => {
    const outcome = await runStoryDownload(
      async () => ({
        status: 'SUCCESS',
        asset: videoAsset(),
        assetType: 'video',
      }),
      async () => {
        throw new UniFetchError('BROWSER_RESTRICTION', 'cross-origin blocked');
      },
    );
    expect(outcome).toEqual({
      status: 'BROWSER_RESTRICTION',
      assetType: 'video',
    });
  });

  it.each([
    'LOGIN_REQUIRED',
    'GRAPHQL_EXECUTION_ERROR',
    'PARSER_OUTDATED',
    'NETWORK_ERROR',
    'UNSUPPORTED_CONTENT',
    'BROWSER_RESTRICTION',
    'UNKNOWN',
  ] as const)(
    'does not attempt a download when acquisition is %s',
    async (status) => {
      const download = vi.fn<() => Promise<void>>(async () => {});
      const outcome = await runStoryDownload(
        async () => ({ status }),
        download,
      );
      expect(download).not.toHaveBeenCalled();
      expect(outcome.status).toBe(status);
    },
  );
});

describe('sanitized Story download summary', () => {
  it('reports only the sanitized success status', () => {
    expect(
      describeStoryDownload({ status: 'DOWNLOADED', assetType: 'image' }),
    ).toBe('Story downloaded · image');
    expect(
      describeStoryDownload({ status: 'DOWNLOADED', assetType: 'video' }),
    ).toBe('Story downloaded · video');
  });

  it('never exposes a Story URL, CDN host, Story id or username', () => {
    const statuses = [
      'DOWNLOADED',
      'DOWNLOAD_FAILED',
      'BROWSER_RESTRICTION',
      'LOGIN_REQUIRED',
      'GRAPHQL_EXECUTION_ERROR',
      'PARSER_OUTDATED',
      'NETWORK_ERROR',
      'UNSUPPORTED_CONTENT',
      'UNKNOWN',
    ] as const;
    for (const status of statuses) {
      const text = describeStoryDownload({ status, assetType: 'image' });
      expect(text).not.toContain('https://');
      expect(text).not.toContain('media.invalid');
      expect(text).not.toContain('instagram.com');
      expect(text).not.toContain('stories');
      expect(text).not.toContain('fictional_account');
      expect(text).not.toContain('1234567890123456789');
    }
  });
});

describe('reused downloader behavior for Story assets', () => {
  const fetcher = vi.fn<typeof fetch>();
  let anchor: Record<string, unknown>;

  beforeEach(() => {
    vi.useFakeTimers();
    anchor = { click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('window', {
      location: { origin: 'https://extension.invalid' },
    });
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { append: vi.fn() },
    });
    vi.stubGlobal('fetch', fetcher);
    fetcher.mockReset();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:story');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('preserves an already-JPEG Story image as .jpg', async () => {
    fetcher.mockResolvedValue(
      new Response(new Blob(['jpeg'], { type: 'image/jpeg' })),
    );
    await runStoryDownload(
      async () => ({
        status: 'SUCCESS',
        asset: imageAsset(),
        assetType: 'image',
      }),
      downloadLocalAsset,
    );
    expect(anchor.download).toBe('instagram_story.jpg');
    expect(
      (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0].type,
    ).toBe('image/jpeg');
  });

  it('normalizes a non-JPEG Story image to JPEG and a .jpg filename', async () => {
    fetcher.mockResolvedValue(
      new Response(new Blob(['webp'], { type: 'image/webp' })),
    );
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 32, height: 24, close: vi.fn() }),
    );
    const output = new Blob(['jpeg'], { type: 'image/jpeg' });
    const create = document.createElement as ReturnType<typeof vi.fn>;
    create.mockImplementation((tag: string) =>
      tag === 'canvas'
        ? {
            getContext: () => ({ fillRect: vi.fn(), drawImage: vi.fn() }),
            toBlob: (callback: (blob: Blob) => void) => callback(output),
          }
        : anchor,
    );
    await runStoryDownload(
      async () => ({
        status: 'SUCCESS',
        asset: imageAsset(),
        assetType: 'image',
      }),
      downloadLocalAsset,
    );
    expect(anchor.download).toBe('instagram_story.jpg');
    expect(
      (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toBe(output);
  });

  it('preserves Story video bytes and .mp4 type without transcoding', async () => {
    fetcher.mockResolvedValue(
      new Response(new Blob(['mp4-bytes'], { type: 'video/mp4' })),
    );
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    await runStoryDownload(
      async () => ({
        status: 'SUCCESS',
        asset: videoAsset(),
        assetType: 'video',
      }),
      downloadLocalAsset,
    );
    expect(decode).not.toHaveBeenCalled();
    expect(anchor.download).toBe('instagram_story.mp4');
    expect(
      (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0].type,
    ).toBe('video/mp4');
  });

  it('never includes the Story id or username in a Story filename', () => {
    for (const asset of [imageAsset(), videoAsset()]) {
      expect(asset.suggestedFilename).not.toContain('1234567890123456789');
      expect(asset.suggestedFilename).not.toContain('fictional_account');
      expect(asset.suggestedFilename).not.toContain('/');
      expect(asset.suggestedFilename).not.toContain('\\');
    }
    expect(imageAsset().suggestedFilename).toBe('instagram_story.jpg');
    expect(videoAsset().suggestedFilename).toBe('instagram_story.mp4');
  });

  it('keeps media direct: CDN fetch only, unauthenticated, never the Resolver', async () => {
    fetcher.mockResolvedValue(
      new Response(new Blob(['jpeg'], { type: 'image/jpeg' })),
    );
    const asset = imageAsset();
    await runStoryDownload(
      async () => ({ status: 'SUCCESS', asset, assetType: 'image' }),
      downloadLocalAsset,
    );
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(asset.url);
    expect(String(url)).not.toContain('workers.dev');
    expect(String(url)).not.toContain('/api/resolve');
    expect(init?.credentials).toBe('omit');
  });

  it('downloads a first-load visible-current-media asset through the same downloader', async () => {
    fetcher.mockResolvedValue(
      new Response(new Blob(['jpeg'], { type: 'image/jpeg' })),
    );
    const asset = visibleStoryMediaToAsset(
      {
        ok: true,
        kind: 'image',
        url: 'https://media.invalid/visible-story.jpg',
        width: 1080,
        height: 1920,
      },
      { username: 'bryan_u6', index: 3 },
    );
    const outcome = await runStoryDownload(
      async () => ({ status: 'SUCCESS', asset, assetType: 'image' }),
      downloadLocalAsset,
    );
    expect(outcome).toEqual({ status: 'DOWNLOADED', assetType: 'image' });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(asset.url, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    expect(anchor.download).toBe('bryan_u6_story_03.jpg');
  });

  it('does not fail a download when the Story index is unavailable', async () => {
    fetcher.mockResolvedValue(
      new Response(new Blob(['jpeg'], { type: 'image/jpeg' })),
    );
    const asset = visibleStoryMediaToAsset(
      { ok: true, kind: 'image', url: 'https://media.invalid/no-index.jpg' },
      { username: 'bryan_u6' },
    );
    const outcome = await runStoryDownload(
      async () => ({ status: 'SUCCESS', asset, assetType: 'image' }),
      downloadLocalAsset,
    );
    expect(outcome.status).toBe('DOWNLOADED');
    expect(anchor.download).toBe('bryan_u6_story.jpg');
  });
});

describe('Story acquisition request boundary', () => {
  it('targets only the Instagram origin, never the Cloudflare Resolver', async () => {
    const fetchSpy = vi.fn<FetchLike>(async () => jsonResponse(storyImage));
    const raw = await runBackgroundFetch(
      buildInstagramStoryRequest(ref),
      undefined,
      fetchSpy,
    );
    expect(raw.reached).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url).startsWith('https://www.instagram.com/')).toBe(true);
    expect(String(url)).not.toContain('workers.dev');
    expect(String(url)).not.toContain('/api/resolve');
    const names = Object.keys(
      (init?.headers ?? {}) as Record<string, string>,
    ).map((name) => name.toLowerCase());
    expect(names).not.toContain('cookie');
    expect(init?.credentials).toBe('include');
  });

  it('leaves the authenticated Story response local and unexported', () => {
    const resolved = normalizeInstagramStory(
      parseInstagramStoryResponse(storyImage),
      ref.canonicalUrl,
    );
    expect(resolved.trace).toMatchObject({
      processedLocally: true,
      remoteProxyUsed: false,
      credentialsExported: false,
      network: [],
    });
    expect(resolved.post.id).toBeUndefined();
  });
});

describe('M8C boundary scan', () => {
  const downloadSource = readFileSync(
    new URL('./download.ts', import.meta.url),
    'utf8',
  );
  const classifySource = readFileSync(
    new URL('./classify.ts', import.meta.url),
    'utf8',
  );
  const visibleSource = readFileSync(
    new URL('./visible-media.ts', import.meta.url),
    'utf8',
  );
  const filenameSource = readFileSync(
    new URL('./filename.ts', import.meta.url),
    'utf8',
  );
  const joined = `${downloadSource}\n${classifySource}\n${visibleSource}\n${filenameSource}`;

  it.each([
    'chrome.cookies',
    'browser.cookies',
    'document.cookie',
    'sessionid',
    'Cookie:',
    'workers.dev',
    '/api/resolve',
    'reel_ids',
    'reels_media',
    'feed/user',
    'highlights',
    'chrome.storage',
    'localStorage',
    'indexedDB',
    'follow',
  ])('never introduces the forbidden token %s', (token) => {
    expect(joined.toLowerCase()).not.toContain(token);
  });
});

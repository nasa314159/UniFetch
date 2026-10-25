import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { UniFetchError } from '@unifetch/core';
import type { ThreadsAcquisitionAdapter } from '@unifetch/meta-resolver/threads';
import { parseThreadsTarget } from '../target';
import { resolveThreadsTarget } from './resolve';
import {
  carousel,
  carouselCode,
  carouselSsr,
  embedHtml,
  gif,
  gifCode,
  gifSsr,
  image,
  imageCode,
  imageSsr,
  ssrHtml,
  threadsUsername,
  videoCode,
  videoSsr,
} from './__fixtures__/ssr';

function acquisition(options?: {
  postHtml?: string;
  embed?: string;
  shareLocation?: string;
}): ThreadsAcquisitionAdapter & {
  acquirePost: ReturnType<typeof vi.fn>;
  acquireEmbed: ReturnType<typeof vi.fn>;
  acquireShare: ReturnType<typeof vi.fn>;
} {
  const postHtml = options?.postHtml ?? imageSsr();
  return {
    acquirePost: vi.fn(async () => ({
      html: postHtml,
      network: [{ origin: 'https://www.threads.com', purpose: 'metadata' }],
    })),
    acquireEmbed: vi.fn(async () => ({
      html: options?.embed ?? embedHtml,
      network: [{ origin: 'https://www.threads.com', purpose: 'metadata' }],
    })),
    acquireShare: vi.fn(async () => ({
      location:
        options?.shareLocation ??
        `https://www.threads.com/@${threadsUsername}/post/${imageCode}/?xmt=synthetic`,
      network: [{ origin: 'https://www.threads.com', purpose: 'metadata' }],
    })),
  } as never;
}

function target(input: string) {
  const parsed = parseThreadsTarget(input);
  if (!parsed) throw new Error('expected a Threads target');
  return parsed;
}

describe('Threads extension resolution (shared parser and normalizer)', () => {
  it('resolves one static image with the highest candidate', async () => {
    const result = await resolveThreadsTarget(
      target(`https://www.threads.com/@${threadsUsername}/post/${imageCode}/`),
      acquisition(),
    );
    expect(result).toMatchObject({
      ok: true,
      platform: 'threads',
      contentType: 'post',
    });
    if (!result.ok) return;
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({
      type: 'image',
      suggestedFilename:
        'unifetch_threads_demo_Synthetic-Threads-image-for-pa.jpg',
    });
    expect(result.assets[0].url).toContain('synthetic-image-high.jpg');
  });

  it('resolves a native MP4 as a video asset', async () => {
    const result = await resolveThreadsTarget(
      target(`https://www.threads.com/@${threadsUsername}/post/${videoCode}/`),
      acquisition({ postHtml: videoSsr() }),
    );
    expect(result).toMatchObject({
      ok: true,
      platform: 'threads',
      contentType: 'post',
    });
    if (!result.ok) return;
    expect(result.assets[0]).toMatchObject({
      type: 'video',
      mimeType: 'video/mp4',
      suggestedFilename:
        'unifetch_threads_demo_Synthetic-Threads-video-for-pa.mp4',
    });
    expect(result.assets[0].url).toContain('synthetic-video-101.mp4');
  });

  it('preserves mixed carousel order and per-child media type', async () => {
    const result = await resolveThreadsTarget(
      target(
        `https://www.threads.com/@${threadsUsername}/post/${carouselCode}/`,
      ),
      acquisition({ postHtml: carouselSsr() }),
    );
    expect(result).toMatchObject({
      ok: true,
      platform: 'threads',
      contentType: 'carousel',
    });
    if (!result.ok) return;
    expect(result.assets.map((asset) => asset.type)).toEqual([
      'image',
      'video',
      'image',
      'video',
    ]);
    expect(result.assets.map((asset) => asset.suggestedFilename)).toEqual([
      'unifetch_threads_demo_Synthetic-mixed-Threads-carous_01.jpg',
      'unifetch_threads_demo_Synthetic-mixed-Threads-carous_02.mp4',
      'unifetch_threads_demo_Synthetic-mixed-Threads-carous_03.jpg',
      'unifetch_threads_demo_Synthetic-mixed-Threads-carous_04.mp4',
    ]);
    expect(carousel.carousel_media).toHaveLength(4);
  });

  it('uses the exact-post GIF embed fallback and preserves animated GIF bytes', async () => {
    const adapter = acquisition({ postHtml: gifSsr() });
    const result = await resolveThreadsTarget(
      target(`https://www.threads.com/@${threadsUsername}/post/${gifCode}/`),
      adapter,
    );
    expect(adapter.acquireEmbed).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      ok: true,
      platform: 'threads',
      contentType: 'post',
    });
    if (!result.ok) return;
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({
      type: 'image',
      mimeType: 'image/gif',
      suggestedFilename:
        'unifetch_threads_demo_Synthetic-Threads-GIF-for-pars.gif',
      url: 'https://media.giphy.com/media/synthetic/200.gif',
    });
    expect(gif.media_type).toBe(19);
  });

  it('expands a share link then reuses the same exact-post parser', async () => {
    const adapter = acquisition();
    const result = await resolveThreadsTarget(
      target('https://www.threads.com/share/synthetic-share-token/'),
      adapter,
    );
    expect(adapter.acquireShare).toHaveBeenCalledOnce();
    expect(adapter.acquirePost).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      ok: true,
      platform: 'threads',
      contentType: 'post',
    });
    expect(adapter.acquirePost.mock.calls[0][0]).toMatchObject({
      username: threadsUsername,
      shortcode: imageCode,
    });
  });

  it('fails closed when a share redirect leads to a post whose payload differs', async () => {
    const result = await resolveThreadsTarget(
      target('https://www.threads.com/share/synthetic-share-token/'),
      acquisition({
        shareLocation:
          'https://www.threads.com/@someone_else/post/different-code/',
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      platform: 'threads',
      error: 'PARSER_OUTDATED',
    });
  });

  it.each([
    [
      'a login destination',
      'https://www.threads.com/login/?next=%2Fshare%2Fsynthetic-share-token%2F',
      'LOGIN_REQUIRED',
    ],
    [
      'a cross-origin destination',
      'https://evil.invalid/@user/post/code/',
      'UNSUPPORTED_CONTENT',
    ],
    [
      'a profile destination',
      'https://www.threads.com/@user/',
      'UNSUPPORTED_CONTENT',
    ],
  ])('fails closed for %s', async (_label, location, error) => {
    const result = await resolveThreadsTarget(
      target('https://www.threads.com/share/synthetic-share-token/'),
      acquisition({ shareLocation: location }),
    );
    expect(result).toMatchObject({ ok: false, error });
  });

  it('rejects a private post as LOGIN_REQUIRED', async () => {
    const privateMedia = {
      ...image,
      user: { ...image.user, text_post_app_is_private: true },
    };
    const result = await resolveThreadsTarget(
      target(`https://www.threads.com/@${threadsUsername}/post/${imageCode}/`),
      acquisition({ postHtml: ssrHtml(privateMedia) }),
    );
    expect(result).toEqual({
      ok: false,
      platform: 'threads',
      contentType: 'post',
      error: 'LOGIN_REQUIRED',
    });
  });

  it('distinguishes an unavailable post from unsupported content', async () => {
    const unavailable = {
      ...image,
      text_post_app_info: { is_post_unavailable: true },
    };
    const result = await resolveThreadsTarget(
      target(`https://www.threads.com/@${threadsUsername}/post/${imageCode}/`),
      acquisition({ postHtml: ssrHtml(unavailable) }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: 'CONTENT_UNAVAILABLE',
    });
  });

  it('rejects an exact-post publisher mismatch', async () => {
    const result = await resolveThreadsTarget(
      target(`https://www.threads.com/@someone_else/post/${imageCode}/`),
      acquisition(),
    );
    expect(result).toMatchObject({
      ok: false,
      platform: 'threads',
      error: 'UNSUPPORTED_CONTENT',
    });
  });

  it('rejects an exact-post shortcode mismatch', async () => {
    const result = await resolveThreadsTarget(
      target(
        `https://www.threads.com/@${threadsUsername}/post/different-code/`,
      ),
      acquisition(),
    );
    expect(result).toMatchObject({
      ok: false,
      error: 'PARSER_OUTDATED',
    });
  });

  it.each([0, 3, 99])(
    'rejects unsupported media type %i instead of substituting a poster',
    async (mediaType) => {
      const unsupported = { ...image, media_type: mediaType };
      const result = await resolveThreadsTarget(
        target(
          `https://www.threads.com/@${threadsUsername}/post/${imageCode}/`,
        ),
        acquisition({ postHtml: ssrHtml(unsupported) }),
      );
      expect(result).toMatchObject({
        ok: false,
        error: 'UNSUPPORTED_CONTENT',
      });
    },
  );

  it('maps acquisition failures without inventing success', async () => {
    const adapter = acquisition();
    adapter.acquirePost.mockRejectedValue(
      new UniFetchError('RATE_LIMITED', 'rate limited'),
    );
    const result = await resolveThreadsTarget(
      target(`https://www.threads.com/@${threadsUsername}/post/${imageCode}/`),
      adapter,
    );
    expect(result).toMatchObject({ ok: false, error: 'RATE_LIMITED' });
  });
});

describe('Threads extension has no remote Resolver dependency', () => {
  const sources = [
    'acquisition.ts',
    'resolve.ts',
    'header-rule.ts',
    'permission.ts',
  ]
    .map((file) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'))
    .join('\n');

  it.each([
    '/api/resolve',
    'workers.dev',
    'unifetch-resolver',
    'unifetch.pages.dev',
    'cloudflare',
  ])('never references %s', (token) => {
    expect(sources).not.toContain(token);
  });

  it('only constructs the official Threads origin', () => {
    expect(sources).toContain('THREADS_ORIGIN');
    expect(sources).not.toContain('https://threads.net');
    expect(sources).not.toContain('https://www.threads.net');
  });
});

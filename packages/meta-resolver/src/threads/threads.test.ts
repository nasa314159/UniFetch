import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseThreadsContentRef, parseThreadsShareRef } from './content-ref';
import { parseThreadsEmbedGif } from './embed';
import { normalizeThreadsMedia } from './normalize';
import { parseThreadsSsrHtml } from './parser';
import { resolveThreadsInput, resolveThreadsPost } from './resolver';
import type { ThreadsAcquisitionAdapter } from './resolver';
import { parseThreadsShareLocation } from './share';
import image from './__fixtures__/image.json';
import shareRedirect from './__fixtures__/share-redirect.json';
import video from './__fixtures__/video.json';
import carousel from './__fixtures__/carousel.json';
import gif from './__fixtures__/gif.json';

const username = 'unifetch_threads_demo';
const imageCode = 'synthetic-threads-image';
const videoCode = 'synthetic-threads-video';
const carouselCode = 'synthetic-threads-carousel';
const gifCode = 'synthetic-threads-gif';
const embedHtml = readFileSync(
  new URL('./__fixtures__/embed.html', import.meta.url),
  'utf8',
);

function ssr(media: unknown): string {
  const payload = {
    require: [
      [
        'ScheduledServerJS',
        'handle',
        null,
        [
          {
            __bbox: {
              require: [
                [
                  'RelayPrefetchedStreamCache',
                  'next',
                  [],
                  [
                    'synthetic-preloader',
                    { __bbox: { complete: true, result: { data: { media } } } },
                  ],
                ],
              ],
            },
          },
        ],
      ],
    ],
  };
  return `<!doctype html><html><body><script type="application/json" data-sjs>${JSON.stringify(payload)}</script></body></html>`;
}

function ref(code: string, user = username) {
  return {
    username: user,
    shortcode: code,
    canonicalUrl: `https://www.threads.com/@${user}/post/${code}/`,
  };
}

function acquisition(
  postHtml: string,
  embed = embedHtml,
  shareLocation = shareRedirect.location,
): ThreadsAcquisitionAdapter & {
  acquirePost: ReturnType<typeof vi.fn>;
  acquireEmbed: ReturnType<typeof vi.fn>;
  acquireShare: ReturnType<typeof vi.fn>;
} {
  return {
    acquirePost: vi.fn(async () => ({
      html: postHtml,
      network: [{ origin: 'https://www.threads.com', purpose: 'metadata' }],
    })),
    acquireEmbed: vi.fn(async () => ({
      html: embed,
      network: [{ origin: 'https://www.threads.com', purpose: 'metadata' }],
    })),
    acquireShare: vi.fn(async () => ({
      location: shareLocation,
      network: [{ origin: 'https://www.threads.com', purpose: 'metadata' }],
    })),
  } as never;
}

describe('Threads content references', () => {
  it.each([
    'https://threads.net/@User.Name/post/synthetic-code/',
    'https://threads.com/@User.Name/post/synthetic-code?igsh=test',
    'https://www.threads.net/@User.Name/post/synthetic-code/decorative-slug',
    'https://www.threads.com/@User.Name/post/synthetic-code/media',
  ])('canonicalizes a verified permalink %s', (input) => {
    expect(parseThreadsContentRef(input)).toEqual({
      username: 'user.name',
      shortcode: 'synthetic-code',
      canonicalUrl: 'https://www.threads.com/@user.name/post/synthetic-code/',
    });
  });

  it.each([
    ['https://www.threads.com/@user', 'UNSUPPORTED_CONTENT'],
    ['https://www.threads.com/@user/media', 'UNSUPPORTED_CONTENT'],
    ['https://www.threads.com/@user/replies', 'UNSUPPORTED_CONTENT'],
    ['https://www.threads.com/search', 'UNSUPPORTED_CONTENT'],
    ['https://www.threads.com/t/synthetic-code', 'UNSUPPORTED_CONTENT'],
    ['https://www.threads.com/share/synthetic-code', 'UNSUPPORTED_CONTENT'],
    ['https://www.threads.com/@user/post/', 'INVALID_URL'],
    ['https://www.threads.com/@user/post/code/extra/more', 'INVALID_URL'],
    ['https://www.threads.com/@bad user/post/code', 'INVALID_URL'],
    ['https://instagram.com/p/code/', 'UNSUPPORTED_PLATFORM'],
  ])('rejects unsupported input %s', (input, code) => {
    expect(() => parseThreadsContentRef(input)).toThrow(
      expect.objectContaining({ code }),
    );
  });
});

describe('Threads share references', () => {
  it.each([
    'https://www.threads.com/share/synthetic-share-token/',
    'https://threads.com/share/synthetic-share-token',
    'https://threads.net/share/synthetic-share-token/?hl=en',
  ])('canonicalizes an official share URL %s', (input) => {
    expect(parseThreadsShareRef(input)).toEqual({
      token: 'synthetic-share-token',
      canonicalShareUrl: 'https://www.threads.com/share/synthetic-share-token/',
    });
  });

  it.each([
    ['https://www.threads.com/share/abc/', 'INVALID_URL'],
    [
      'https://www.threads.com/share/synthetic-share-token/extra/',
      'UNSUPPORTED_CONTENT',
    ],
    ['https://www.threads.com/share/', 'UNSUPPORTED_CONTENT'],
    [
      'https://www.threads.com/@user/post/synthetic-code/',
      'UNSUPPORTED_CONTENT',
    ],
    [
      'https://example.com/share/synthetic-share-token/',
      'UNSUPPORTED_PLATFORM',
    ],
  ])('rejects malformed share input %s', (input, code) => {
    expect(() => parseThreadsShareRef(input)).toThrow(
      expect.objectContaining({ code }),
    );
  });

  it('accepts only a same-origin canonical post redirect', () => {
    expect(
      parseThreadsShareLocation(
        parseThreadsShareRef(
          'https://www.threads.com/share/synthetic-share-token/',
        ),
        shareRedirect.location,
      ),
    ).toEqual(ref(imageCode));
  });

  it.each([
    'https://www.threads.net/@unifetch_threads_demo/post/synthetic-threads-image/',
    'https://evil.example/@unifetch_threads_demo/post/synthetic-threads-image/',
    'http://www.threads.com/@unifetch_threads_demo/post/synthetic-threads-image/',
    'https://user:pass@www.threads.com/@unifetch_threads_demo/post/synthetic-threads-image/',
    'https://www.threads.com/@unifetch_threads_demo/post/synthetic-threads-image/extra/',
    'https://www.threads.com/login/?next=/share/synthetic-share-token/',
  ])('rejects an unexpected share destination %s', (location) => {
    const share = parseThreadsShareRef(
      'https://www.threads.com/share/synthetic-share-token/',
    );
    expect(() => parseThreadsShareLocation(share, location)).toThrow(
      expect.objectContaining({
        code: location.includes('/login/')
          ? 'LOGIN_REQUIRED'
          : 'UNSUPPORTED_CONTENT',
      }),
    );
  });

  it('resolves a share URL through one expansion and the exact-post parser', async () => {
    const adapter = acquisition(ssr(image));
    const result = await resolveThreadsInput(
      'https://www.threads.com/share/synthetic-share-token/',
      adapter,
    );
    expect(adapter.acquireShare).toHaveBeenCalledWith({
      token: 'synthetic-share-token',
      canonicalShareUrl: 'https://www.threads.com/share/synthetic-share-token/',
    });
    expect(adapter.acquirePost).toHaveBeenCalledWith(ref(imageCode));
    expect(result.post.canonicalUrl).toBe(ref(imageCode).canonicalUrl);
    expect(result.post.platform).toBe('threads');
    expect(result.kind).toBe('image');
  });

  it('does not expand a canonical permalink', async () => {
    const adapter = acquisition(ssr(image));
    await resolveThreadsInput(ref(imageCode).canonicalUrl, adapter);
    expect(adapter.acquireShare).not.toHaveBeenCalled();
    expect(adapter.acquirePost).toHaveBeenCalledOnce();
  });
});

describe('Threads SSR parsing', () => {
  it('parses a single image and selects the largest candidate', () => {
    const parsed = parseThreadsSsrHtml(ssr(image), ref(imageCode));
    expect(parsed.kind).toBe('image');
    expect(parsed.username).toBe(username);
    expect(parsed.displayName).toBe('UniFetch Threads Demo');
    expect(parsed.publishedAt).toBe('2026-01-01T00:00:00.000Z');
    const result = normalizeThreadsMedia(parsed, ref(imageCode).canonicalUrl);
    expect(result.post.platform).toBe('threads');
    expect(result.post.assets[0]).toMatchObject({
      type: 'image',
      url: 'https://scontent.cdninstagram.com/v/t51/synthetic-image-high.jpg',
      width: 1600,
      height: 1200,
      suggestedFilename:
        'unifetch_threads_demo_Synthetic-Threads-image-for-pa.jpg',
    });
  });

  it('parses native video and preserves the direct MP4 source', () => {
    const parsed = parseThreadsSsrHtml(ssr(video), ref(videoCode));
    expect(parsed.kind).toBe('video');
    const result = normalizeThreadsMedia(parsed, ref(videoCode).canonicalUrl);
    expect(result.post.assets[0]).toMatchObject({
      type: 'video',
      url: 'https://scontent.cdninstagram.com/o1/v/t2/synthetic-video-101.mp4',
      mimeType: 'video/mp4',
      width: 1080,
      height: 1350,
      thumbnailUrl:
        'https://scontent.cdninstagram.com/v/t51/synthetic-video-poster.jpg',
      suggestedFilename:
        'unifetch_threads_demo_Synthetic-Threads-video-for-pa.mp4',
    });
    expect(JSON.stringify(result)).not.toContain('og:image');
  });

  it('preserves mixed carousel order and per-child media types', () => {
    const parsed = parseThreadsSsrHtml(ssr(carousel), ref(carouselCode));
    expect(parsed.kind).toBe('carousel');
    const result = normalizeThreadsMedia(
      parsed,
      ref(carouselCode).canonicalUrl,
    );
    expect(result.post.assets.map((asset) => asset.type)).toEqual([
      'image',
      'video',
      'image',
      'video',
    ]);
    expect(result.post.assets.map((asset) => asset.suggestedFilename)).toEqual([
      'unifetch_threads_demo_Synthetic-mixed-Threads-carous_01.jpg',
      'unifetch_threads_demo_Synthetic-mixed-Threads-carous_02.mp4',
      'unifetch_threads_demo_Synthetic-mixed-Threads-carous_03.jpg',
      'unifetch_threads_demo_Synthetic-mixed-Threads-carous_04.mp4',
    ]);
  });

  it('preserves a video-first mixed carousel shape', () => {
    const mixed = structuredClone(carousel);
    mixed.carousel_media = [
      mixed.carousel_media[1],
      mixed.carousel_media[0],
      mixed.carousel_media[3],
    ];
    const parsed = parseThreadsSsrHtml(ssr(mixed), ref(carouselCode));
    const result = normalizeThreadsMedia(
      parsed,
      ref(carouselCode).canonicalUrl,
    );
    expect(result.post.assets.map((asset) => asset.type)).toEqual([
      'video',
      'image',
      'video',
    ]);
    expect(result.post.assets.map((asset) => asset.suggestedFilename)).toEqual([
      'unifetch_threads_demo_Synthetic-mixed-Threads-carous_01.mp4',
      'unifetch_threads_demo_Synthetic-mixed-Threads-carous_02.jpg',
      'unifetch_threads_demo_Synthetic-mixed-Threads-carous_03.mp4',
    ]);
  });

  it('parses against the final publisher after a same-shortcode account redirect', async () => {
    const renamed = structuredClone(image);
    renamed.user.username = 'unifetch_threads_renamed';
    const adapter = acquisition(ssr(renamed));
    adapter.acquirePost.mockResolvedValueOnce({
      html: ssr(renamed),
      network: [{ origin: 'https://www.threads.com', purpose: 'metadata' }],
      ref: ref(imageCode, 'unifetch_threads_renamed'),
    });
    const result = await resolveThreadsPost(ref(imageCode), adapter);
    expect(result.post.author?.username).toBe('unifetch_threads_renamed');
    expect(result.post.canonicalUrl).toBe(
      'https://www.threads.com/@unifetch_threads_renamed/post/synthetic-threads-image/',
    );
    expect(result.post.assets[0].suggestedFilename).toBe(
      'unifetch_threads_renamed_Synthetic-Threads-image-for-pa.jpg',
    );
  });

  it('rejects a redirect whose SSR publisher still differs from the final URL', async () => {
    const adapter = acquisition(ssr(image));
    adapter.acquirePost.mockResolvedValueOnce({
      html: ssr(image),
      network: [{ origin: 'https://www.threads.com', purpose: 'metadata' }],
      ref: ref(imageCode, 'some_other_publisher'),
    });
    await expect(
      resolveThreadsPost(ref(imageCode), adapter),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' });
  });

  it('rejects a response owned by a different publisher', () => {
    const other = structuredClone(image);
    other.user.username = 'different_publisher';
    expect(() => parseThreadsSsrHtml(ssr(other), ref(imageCode))).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_CONTENT' }),
    );
  });

  it('rejects ambiguous media records for the same shortcode', () => {
    const second = structuredClone(image);
    second.id = 'different-id';
    const payload = {
      require: [
        [
          'ScheduledServerJS',
          'handle',
          null,
          [
            {
              __bbox: {
                result: {
                  data: { media: image, related: { media: second } },
                },
              },
            },
          ],
        ],
      ],
    };
    const html = `<script type="application/json">${JSON.stringify(payload)}</script>`;
    expect(() => parseThreadsSsrHtml(html, ref(imageCode))).toThrow(
      expect.objectContaining({ code: 'PARSER_OUTDATED' }),
    );
  });

  it('does not download a quoted or related post as the selected media', () => {
    const quoted = structuredClone(video);
    quoted.code = 'synthetic-quoted-post';
    quoted.user.username = 'quoted_author';
    const payload = {
      data: {
        media: image,
        quoted: { media: quoted },
        relatedPosts: [{ media: quoted }],
      },
    };
    const html = `<script type="application/json">${JSON.stringify(payload)}</script>`;
    const parsed = parseThreadsSsrHtml(html, ref(imageCode));
    expect(parsed.kind).toBe('image');
    const normalized = normalizeThreadsMedia(
      parsed,
      ref(imageCode).canonicalUrl,
    );
    expect(normalized.post.assets[0].url).toContain('synthetic-image-high');
    expect(JSON.stringify(parsed)).not.toContain('synthetic-quoted-post');
  });

  it('marks a private post as login-required', () => {
    const privatePost = structuredClone(image);
    privatePost.user.text_post_app_is_private = true;
    expect(() => parseThreadsSsrHtml(ssr(privatePost), ref(imageCode))).toThrow(
      expect.objectContaining({ code: 'LOGIN_REQUIRED' }),
    );
  });

  it('rejects a text post without downloadable media', () => {
    const text = {
      ...structuredClone(image),
      media_type: 19,
      image_versions2: null,
      giphy_media_info: null,
      code: 'synthetic-text-only',
    };
    expect(() =>
      parseThreadsSsrHtml(ssr(text), ref('synthetic-text-only')),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CONTENT' }));
  });
});

describe('Threads GIF fallback', () => {
  it('never treats the canonical placeholder as the GIF', () => {
    const parsed = parseThreadsSsrHtml(ssr(gif), ref(gifCode));
    expect(parsed.kind).toBe('gif');
    expect(parsed.gif?.directUrl).toBeUndefined();
    expect(parsed.gif?.placeholderUrl).toContain('static.cdninstagram.com');
    expect(() =>
      normalizeThreadsMedia(parsed, ref(gifCode).canonicalUrl),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CONTENT' }));
  });

  it('extracts the direct animated GIF URL from the exact post embed', () => {
    expect(parseThreadsEmbedGif(embedHtml, ref(gifCode))).toEqual({
      url: 'https://media.giphy.com/media/synthetic/200.gif',
    });
  });

  it('rejects an embed for a different post or publisher', () => {
    expect(() =>
      parseThreadsEmbedGif(embedHtml, ref(gifCode, 'different_publisher')),
    ).toThrow(expect.objectContaining({ code: 'PARSER_OUTDATED' }));
    expect(() =>
      parseThreadsEmbedGif(embedHtml, ref('different-code')),
    ).toThrow(expect.objectContaining({ code: 'PARSER_OUTDATED' }));
  });

  it('rejects an embed with only a non-Giphy preview', () => {
    expect(() =>
      parseThreadsEmbedGif(
        '<a href="https://www.threads.com/&#064;unifetch_threads_demo/post/synthetic-threads-gif">x</a><img src="https://scontent.cdninstagram.com/synthetic.gif">',
        ref(gifCode),
      ),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CONTENT' }));
  });

  it('normalizes an animated GIF with its original MIME and extension', () => {
    const parsed = parseThreadsSsrHtml(ssr(gif), ref(gifCode));
    const result = normalizeThreadsMedia(
      parsed,
      ref(gifCode).canonicalUrl,
      'https://media.giphy.com/media/synthetic/200.gif',
    );
    expect(result.post.assets[0]).toMatchObject({
      type: 'image',
      mimeType: 'image/gif',
      url: 'https://media.giphy.com/media/synthetic/200.gif',
      suggestedFilename:
        'unifetch_threads_demo_Synthetic-Threads-GIF-for-pars.gif',
    });
  });

  it('fetches the embed fallback only for a GIF placeholder', async () => {
    const adapter = acquisition(ssr(gif));
    const result = await resolveThreadsPost(ref(gifCode), adapter);
    expect(adapter.acquirePost).toHaveBeenCalledOnce();
    expect(adapter.acquireEmbed).toHaveBeenCalledOnce();
    expect(result.source).toBe('live');
    expect(result.kind).toBe('image');
    expect(result.post.assets[0].mimeType).toBe('image/gif');
    expect(result.trace.network).toEqual([
      { origin: 'https://www.threads.com', purpose: 'metadata' },
    ]);
  });

  it('does not fetch the embed for an image or video post', async () => {
    const adapter = acquisition(ssr(image));
    await resolveThreadsPost(ref(imageCode), adapter);
    expect(adapter.acquireEmbed).not.toHaveBeenCalled();
    const videoAdapter = acquisition(ssr(video));
    await resolveThreadsPost(ref(videoCode), videoAdapter);
    expect(videoAdapter.acquireEmbed).not.toHaveBeenCalled();
  });
});

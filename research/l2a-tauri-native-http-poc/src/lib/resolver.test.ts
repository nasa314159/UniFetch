import { beforeEach, describe, expect, it, vi } from 'vitest';
import singleImage from '../../../../packages/meta-resolver/src/instagram/__fixtures__/single-image-response.json';
import carousel from '../../../../packages/meta-resolver/src/instagram/__fixtures__/carousel-response.json';
import type { MediaAsset } from '@unifetch/core';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { resolveNative, saveNative, toPocError } from './resolver';
import type { InstagramFetch, ThreadsFetch } from './contracts';

const instagramDiagnostics = [
  {
    stage: 'INSTAGRAM_GRAPHQL_BODY',
    outcome: 'ok' as const,
    status: 200,
    bytes: 1234,
    elapsedMs: 12,
  },
];

function instagramFetch(
  body: unknown,
  overrides: Partial<InstagramFetch> = {},
): InstagramFetch {
  return {
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
    bootstrapStatus: 200,
    csrfFound: true,
    shortcode: 'unifetch-raw-image',
    kind: 'post',
    canonicalUrl: 'https://www.instagram.com/p/unifetch-raw-image/',
    diagnostics: instagramDiagnostics,
    ...overrides,
  };
}

const threadsMedia = {
  code: 'Abc_12',
  id: 'Abc_12_1001',
  pk: '1001',
  media_type: 1,
  user: {
    username: 'demo',
    full_name: 'Demo Publisher',
  },
  caption: { text: 'Synthetic Threads image for the L2A adapter test.' },
  taken_at: 1767225600,
  image_versions2: {
    candidates: [
      {
        url: 'https://scontent.cdninstagram.com/v/t51/l2a-demo.jpg',
        width: 1600,
        height: 1200,
      },
    ],
  },
};

function threadsHtml(media: unknown = threadsMedia): string {
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

function threadsFetch(overrides: Partial<ThreadsFetch> = {}): ThreadsFetch {
  return {
    status: 200,
    contentType: 'text/html; charset=utf-8',
    html: threadsHtml(),
    requestedUsername: 'demo',
    requestedShortcode: 'Abc_12',
    finalUsername: 'demo',
    finalShortcode: 'Abc_12',
    finalUrl: 'https://www.threads.com/@demo/post/Abc_12/',
    redirected: false,
    diagnostics: [
      {
        stage: 'THREADS_BODY',
        outcome: 'ok',
        status: 200,
        bytes: 4096,
        elapsedMs: 10,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe('native resolver adapters', () => {
  it('parses Instagram with the existing parser and never uses fetch', async () => {
    invokeMock.mockResolvedValueOnce(instagramFetch(singleImage));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const resolution = await resolveNative(
      'https://www.instagram.com/p/unifetch-raw-image/',
    );

    expect(invokeMock).toHaveBeenCalledWith('resolve_instagram', {
      shortcode: 'unifetch-raw-image',
      kind: 'post',
    });
    expect(resolution.source).toBe('instagram-native');
    expect(resolution.kind).toBe('image');
    expect(resolution.result.post.platform).toBe('instagram');
    expect(resolution.result.post.assets).toHaveLength(1);
    expect(resolution.result.post.assets[0].suggestedFilename).toBe(
      'instagram_unifetch-raw-image.jpg',
    );
    expect(resolution.result.trace).toMatchObject({
      processedLocally: true,
      remoteProxyUsed: false,
      metadataResolverUsed: false,
      credentialsExported: false,
    });
    expect(resolution.result.trace.network).toEqual([
      { origin: 'https://www.instagram.com', purpose: 'metadata' },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('parses Threads with the existing SSR parser and publisher check', async () => {
    invokeMock.mockResolvedValueOnce(threadsFetch());

    const resolution = await resolveNative(
      'https://www.threads.com/@demo/post/Abc_12/',
    );

    expect(invokeMock).toHaveBeenCalledWith('resolve_threads', {
      username: 'demo',
      shortcode: 'Abc_12',
    });
    expect(resolution.source).toBe('threads-native');
    expect(resolution.result.post.author?.username).toBe('demo');
    expect(resolution.result.post.assets).toHaveLength(1);
    expect(resolution.result.post.assets[0].type).toBe('image');
    expect(resolution.result.post.assets[0].suggestedFilename).toMatch(
      /\.jpg$/,
    );
    expect(resolution.result.trace.network).toEqual([
      { origin: 'https://www.threads.com', purpose: 'metadata' },
    ]);
  });

  it('accepts only a same-shortcode Threads alias redirect', async () => {
    invokeMock.mockResolvedValueOnce(
      threadsFetch({
        requestedUsername: 'old_name',
        finalUsername: 'demo',
        finalUrl: 'https://www.threads.com/@demo/post/Abc_12/',
        redirected: true,
      }),
    );

    const resolution = await resolveNative(
      'https://www.threads.com/@old_name/post/Abc_12/',
    );

    expect(resolution.result.post.canonicalUrl).toBe(
      'https://www.threads.com/@demo/post/Abc_12/',
    );
    expect(resolution.result.post.author?.username).toBe('demo');
  });

  it('rejects a Threads response whose final shortcode changed', async () => {
    invokeMock.mockResolvedValueOnce(
      threadsFetch({
        finalShortcode: 'different',
        finalUrl: 'https://www.threads.com/@demo/post/different/',
      }),
    );

    await expect(
      resolveNative('https://www.threads.com/@demo/post/Abc_12/'),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' });
  });

  it('rejects a Threads response whose publisher does not match the served URL', async () => {
    invokeMock.mockResolvedValueOnce(
      threadsFetch({
        finalUsername: 'other',
        finalUrl: 'https://www.threads.com/@other/post/Abc_12/',
      }),
    );

    await expect(
      resolveNative('https://www.threads.com/@demo/post/Abc_12/'),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' });
  });

  it('rejects Instagram carousels in this single-image milestone', async () => {
    invokeMock.mockResolvedValueOnce(
      instagramFetch(carousel, {
        shortcode: 'unifetch-demo-carousel',
        canonicalUrl: 'https://www.instagram.com/p/unifetch-demo-carousel/',
      }),
    );

    await expect(
      resolveNative('https://www.instagram.com/p/unifetch-demo-carousel/'),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' });
  });

  it('rejects non-HTTPS and unsupported platform inputs before invoking Rust', async () => {
    await expect(
      resolveNative('http://www.instagram.com/p/unifetch-raw-image/'),
    ).rejects.toMatchObject({ code: 'INVALID_URL' });
    await expect(
      resolveNative('https://www.facebook.com/watch/?v=1'),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PLATFORM' });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('sends only the parser asset URL and filename to the save command', async () => {
    invokeMock.mockResolvedValueOnce({
      fileName: 'instagram_unifetch-raw-image.jpg',
      savedPath: '/app-data/downloads/instagram_unifetch-raw-image.jpg',
      bytes: 12345,
      sha256: 'a'.repeat(64),
      detectedType: 'jpeg',
      mimeType: 'image/jpeg',
      exists: true,
      nonEmpty: true,
    });
    const asset: MediaAsset = {
      id: 'asset',
      type: 'image',
      url: 'https://scontent.cdninstagram.com/v/t51/example.jpg?token=secret',
      suggestedFilename: 'instagram_unifetch-raw-image.jpg',
    };

    const result = await saveNative(asset);

    expect(invokeMock).toHaveBeenCalledWith('save_media', {
      url: asset.url,
      suggestedFilename: asset.suggestedFilename,
    });
    expect(result.exists).toBe(true);
    expect(result.nonEmpty).toBe(true);
  });

  it('rejects non-image assets before invoking Rust', async () => {
    const asset: MediaAsset = {
      id: 'video',
      type: 'video',
      url: 'https://scontent.cdninstagram.com/v/t51/example.mp4',
      suggestedFilename: 'example.mp4',
    };
    await expect(saveNative(asset)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('normalizes typed and unknown errors without exposing raw values', () => {
    expect(
      toPocError({
        code: 'LOGIN_REQUIRED',
        message: 'The upstream service requires authentication.',
        stage: 'INSTAGRAM_GRAPHQL',
      }),
    ).toEqual({
      code: 'LOGIN_REQUIRED',
      message: 'The upstream service requires authentication.',
      stage: 'INSTAGRAM_GRAPHQL',
    });
    expect(
      toPocError(new Error('https://signed.example/?token=secret')),
    ).toEqual({
      code: 'UNKNOWN',
      message: 'Something went wrong. Please try again.',
      stage: 'ui',
    });
  });
});

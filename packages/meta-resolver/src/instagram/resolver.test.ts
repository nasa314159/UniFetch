import { afterEach, describe, expect, it, vi } from 'vitest';
import { UniFetchError, type RuntimeAdapter } from '@unifetch/core';
import { createResolver } from '@unifetch/meta-resolver';
import { parseSharedPayload } from '../../../share-target/src/index';
import image from './__fixtures__/single-image-response.json';
import carousel from './__fixtures__/carousel-response.json';
import reel from './__fixtures__/reel-response.json';

function runtime(raw: unknown = image) {
  const request = vi.fn(
    async (input: import('@unifetch/core').RuntimeSessionRequest) => {
      void input;
      return {
        status: 200,
        body: new TextEncoder().encode(JSON.stringify(raw)),
      };
    },
  );
  const prepareOriginSession = vi.fn(async () => ({ request }));
  const adapter: RuntimeAdapter = {
    request: vi.fn(async () => {
      throw new Error('Use session');
    }),
    download: async () => {},
    capabilities: () => ({ downloads: true, crossOriginRequests: false }),
    prepareOriginSession,
  };
  return { adapter, request, prepareOriginSession };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Production Instagram pipeline integration with deterministic transport', () => {
  it.each([
    ['image', 1, 'image'],
    ['carousel', 4, 'carousel'],
    ['reel', 1, 'video'],
  ] as const)(
    'keeps demo %s on the local fixture path',
    async (kind, count, mediaKind) => {
      const { adapter, prepareOriginSession } = runtime();
      const result = await createResolver(adapter).resolve(
        `https://www.instagram.com/${kind === 'reel' ? 'reel' : 'p'}/unifetch-demo-${kind}/`,
      );
      expect(result.source).toBe('fixture');
      expect(result.kind).toBe(mediaKind);
      expect(result.post.assets).toHaveLength(count);
      expect(result.trace.network).toEqual([]);
      expect(prepareOriginSession).not.toHaveBeenCalled();
      expect(adapter.request).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['p', image, 'image'],
    ['reel', reel, 'video'],
    ['reels', reel, 'video'],
  ] as const)(
    'composes acquisition/parser/normalizer for /%s/',
    async (path, raw, kind) => {
      const { adapter, request, prepareOriginSession } = runtime(raw);
      const result = await createResolver(adapter).resolve(
        `https://m.instagram.com/${path}/synthetic-M4C-test/?igsh=ignored`,
      );
      expect(prepareOriginSession).toHaveBeenCalledOnce();
      expect(request).toHaveBeenCalledOnce();
      const body = new URLSearchParams(request.mock.calls[0]?.[0]?.body);
      expect(JSON.parse(body.get('variables') ?? '{}').shortcode).toBe(
        'synthetic-M4C-test',
      );
      expect(result.source).toBe('live');
      expect(result.kind).toBe(kind);
      expect(result.post.platform).toBe('instagram');
      expect(result.post.canonicalUrl).toBe(
        `https://www.instagram.com/${path === 'p' ? 'p' : 'reel'}/synthetic-M4C-test/`,
      );
      expect(result.post.assets[0].url).toContain('-high.');
      expect(result.trace).toEqual({
        processedLocally: true,
        remoteProxyUsed: false,
        credentialsExported: false,
        network: [{ origin: 'https://www.instagram.com', purpose: 'metadata' }],
      });
    },
  );
  it('response structure wins over Reel path for mixed carousel', async () => {
    const { adapter } = runtime(carousel);
    const result = await createResolver(adapter).resolve(
      'https://instagram.com/reel/synthetic-carousel/',
    );
    expect(result.kind).toBe('carousel');
    expect(result.post.assets.map((asset) => asset.type)).toEqual([
      'image',
      'image',
      'video',
      'image',
    ]);
  });
  it.each([
    'BROWSER_RESTRICTION',
    'RATE_LIMITED',
    'LOGIN_REQUIRED',
    'CONTENT_UNAVAILABLE',
  ] as const)(
    'propagates %s without fabricated success trace',
    async (code) => {
      const { adapter, prepareOriginSession } = runtime();
      const failure = new UniFetchError(code, 'Safe typed failure');
      prepareOriginSession.mockRejectedValueOnce(failure);
      await expect(
        createResolver(adapter).resolve(
          'https://instagram.com/p/synthetic-error/',
        ),
      ).rejects.toBe(failure);
    },
  );
  it('absent media semantics produce UNKNOWN', async () => {
    const { adapter } = runtime({ data: { changed: true } });
    await expect(
      createResolver(adapter).resolve(
        'https://instagram.com/p/synthetic-schema/',
      ),
    ).rejects.toMatchObject({ code: 'UNKNOWN' });
  });
  it('accepts shared live-shaped URLs through the same pipeline without persistence', async () => {
    const storage = { setItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    const input = parseSharedPayload({
      text: 'Check this https://m.instagram.com/reels/synthetic-share/?igsh=ignored',
    });
    expect(input).not.toBeNull();
    const { adapter } = runtime(reel);
    const result = await createResolver(adapter).resolve(input!);
    expect(result.source).toBe('live');
    expect(result.post.canonicalUrl).toBe(
      'https://www.instagram.com/reel/synthetic-share/',
    );
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('does not invoke direct global fetch outside the runtime', async () => {
    const fetch = vi.fn(() => {
      throw new Error('Unexpected fetch');
    });
    vi.stubGlobal('fetch', fetch);
    const { adapter } = runtime();
    await createResolver(adapter).resolve(
      'https://instagram.com/p/synthetic-offline/',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects unsupported live paths before acquisition', async () => {
    const { adapter, prepareOriginSession } = runtime();
    await expect(
      createResolver(adapter).resolve(
        'https://instagram.com/stories/synthetic/',
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' });
    expect(prepareOriginSession).not.toHaveBeenCalled();
  });
});

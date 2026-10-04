import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebResolver } from './resolver-client';
import {
  normalizeInstagramMedia,
  parseInstagramMediaResponse,
} from '@unifetch/meta-resolver/instagram';
import { parseSharedPayload } from '@unifetch/share-target';
import { resolutionErrorMessage, resolutionErrorTitle } from './error-messages';
import { UniFetchError } from '@unifetch/core';
import raw from '../../../packages/meta-resolver/src/instagram/__fixtures__/single-image-response.json';
const input = 'https://www.instagram.com/p/synthetic-client/';
function body() {
  const result = normalizeInstagramMedia(
    parseInstagramMediaResponse(raw, 'synthetic-client'),
    input,
  );
  return {
    ok: true,
    result: {
      ...result,
      trace: {
        ...result.trace,
        processedLocally: false,
        remoteProxyUsed: true,
        metadataResolverUsed: true,
        mediaProxyUsed: false,
        network: [{ origin: 'https://www.instagram.com', purpose: 'metadata' }],
      },
    },
    kind: 'image',
    transport: {
      metadataResolver: 'unifetch-cloudflare-worker',
      mediaProxyUsed: false,
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
});
describe('Web metadata Resolver client', () => {
  it.each(['image', 'carousel', 'reel'])(
    'keeps demo %s network-free',
    async (kind) => {
      const fetcher = vi.fn();
      const result = await createWebResolver(
        'https://resolver.invalid',
        fetcher,
      ).resolve(
        `https://instagram.com/${kind === 'reel' ? 'reel' : 'p'}/unifetch-demo-${kind}/`,
      );
      expect(result.source).toBe('fixture');
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it('uses only configured Resolver API for live-shaped URLs and records precise privacy', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(body()), {
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const result = await createWebResolver(
      'https://resolver.invalid',
      fetcher,
    ).resolve(input);
    expect(String(fetcher.mock.calls[0][0])).toBe(
      'https://resolver.invalid/api/resolve',
    );
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      credentials: 'omit',
      cache: 'no-store',
      method: 'POST',
      body: JSON.stringify({ url: input }),
    });
    expect(result.source).toBe('worker');
    expect(result.trace).toMatchObject({
      processedLocally: false,
      metadataResolverUsed: true,
      mediaProxyUsed: false,
      remoteProxyUsed: true,
    });
    expect(result.trace.network[0].origin).toBe('https://resolver.invalid');
  });
  it('passes a shared supported URL into Resolver without persistent storage', async () => {
    const storage = { setItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    const fetcher = vi.fn(async () => new Response(JSON.stringify(body())));
    const shared = parseSharedPayload({ url: input });
    await createWebResolver('https://resolver.invalid', fetcher).resolve(
      shared!,
    );
    expect(fetcher).toHaveBeenCalledOnce();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('does not fall back to direct Instagram when no Resolver is configured', async () => {
    const fetcher = vi.fn();
    await expect(
      createWebResolver(undefined, fetcher).resolve(input),
    ).rejects.toMatchObject({ code: 'BROWSER_RESTRICTION' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    'LOGIN_REQUIRED',
    'RATE_LIMITED',
    'CONTENT_UNAVAILABLE',
    'PARSER_OUTDATED',
    'NETWORK_ERROR',
    'GRAPHQL_EXECUTION_ERROR',
  ])('preserves safe API error %s', async (code) => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: { code, message: 'Safe diagnostic' },
          }),
          { status: 502 },
        ),
    );
    await expect(
      createWebResolver('https://resolver.invalid', fetcher).resolve(input),
    ).rejects.toMatchObject({ code });
  });
  it('presents a Worker GraphQL failure without substituting parser drift or exposing upstream text', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: 'GRAPHQL_EXECUTION_ERROR',
              message:
                'Instagram returned an application-level error for this request.',
            },
          }),
          { status: 502 },
        ),
    );
    const failure = await createWebResolver('https://resolver.invalid', fetcher)
      .resolve(input)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UniFetchError);
    const error = failure as UniFetchError;
    expect(error.code).toBe('GRAPHQL_EXECUTION_ERROR');
    expect(resolutionErrorTitle(error)).toBe(
      "Instagram couldn't return this post",
    );
    expect(resolutionErrorMessage(error)).toBe(
      'Instagram returned an application-level error for this request.',
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('rejects raw or unknown API responses', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(raw)));
    await expect(
      createWebResolver('https://resolver.invalid', fetcher).resolve(input),
    ).rejects.toMatchObject({ code: 'PARSER_OUTDATED' });
  });
  it('rejects misleading trace semantics', async () => {
    const changed = body();
    changed.result.trace.processedLocally = true;
    const fetcher = vi.fn(async () => new Response(JSON.stringify(changed)));
    await expect(
      createWebResolver('https://resolver.invalid', fetcher).resolve(input),
    ).rejects.toMatchObject({ code: 'PARSER_OUTDATED' });
  });
});

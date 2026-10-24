import {
  UniFetchError,
  parseSupportedUrl,
  resolverApiResponseSchema,
  type RuntimeAdapter,
} from '@unifetch/core';
import {
  createResolver,
  isInstagramFixtureUrl,
  type WebResolutionResult,
} from '@unifetch/meta-resolver';
import { parseInstagramContentRef } from '@unifetch/meta-resolver/instagram';
import {
  isThreadsSharePath,
  parseThreadsContentRef,
  parseThreadsShareRef,
} from '@unifetch/meta-resolver/threads';
import { WebRuntime } from '@unifetch/runtime-web';

type ApiFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function createWebResolver(
  configuredOrigin?: string,
  fetcher: ApiFetch = fetch,
  runtime: RuntimeAdapter = new WebRuntime(),
) {
  const fixtureResolver = createResolver(runtime);

  async function resolveRemote(
    inputUrl: string,
    platform: 'instagram' | 'threads',
    expectedCanonicalUrl?: string,
  ): Promise<WebResolutionResult> {
    if (!configuredOrigin)
      throw new UniFetchError(
        'BROWSER_RESTRICTION',
        'The UniFetch metadata Resolver is not configured. Demo mode remains available.',
      );
    let origin: URL;
    try {
      origin = new URL(configuredOrigin);
    } catch {
      throw new UniFetchError(
        'NETWORK_ERROR',
        'The Resolver configuration is invalid.',
      );
    }
    if (
      !['http:', 'https:'].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    )
      throw new UniFetchError(
        'NETWORK_ERROR',
        'The Resolver configuration must be an HTTP(S) origin without credentials.',
      );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetcher(new URL('/api/resolve', origin), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: inputUrl }),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      const parsed = resolverApiResponseSchema.safeParse(await response.json());
      if (!parsed.success)
        throw new UniFetchError(
          'PARSER_OUTDATED',
          'The UniFetch Resolver returned an unrecognized response.',
        );
      if (!parsed.data.ok)
        throw new UniFetchError(
          parsed.data.error.code,
          parsed.data.error.message,
        );
      if (!response.ok)
        throw new UniFetchError(
          'NETWORK_ERROR',
          'The Resolver request failed.',
        );
      const { result, kind } = parsed.data;
      if (result.post.platform !== platform)
        throw new UniFetchError(
          'PARSER_OUTDATED',
          'The Resolver returned a result for a different platform.',
        );
      if (expectedCanonicalUrl) {
        if (result.post.canonicalUrl !== expectedCanonicalUrl)
          throw new UniFetchError(
            'PARSER_OUTDATED',
            'The Resolver returned a result for a different URL.',
          );
      } else {
        // A share URL is expanded by the Resolver; require the response to
        // carry one canonical Threads post permalink rather than the token URL.
        let canonical;
        try {
          canonical = parseThreadsContentRef(result.post.canonicalUrl);
        } catch {
          throw new UniFetchError(
            'PARSER_OUTDATED',
            'The Resolver did not expand the share link to a canonical post.',
          );
        }
        if (canonical.canonicalUrl !== result.post.canonicalUrl)
          throw new UniFetchError(
            'PARSER_OUTDATED',
            'The Resolver returned a non-canonical share expansion.',
          );
      }
      return {
        ...result,
        source: 'worker',
        kind,
        trace: {
          ...result.trace,
          network: [
            { origin: origin.origin, purpose: 'metadata' },
            ...result.trace.network,
          ],
        },
      };
    } catch (error) {
      if (error instanceof UniFetchError) throw error;
      throw new UniFetchError(
        'NETWORK_ERROR',
        'The UniFetch Resolver could not be reached or the request timed out.',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async resolve(input: string): Promise<WebResolutionResult> {
      const { url, platform } = parseSupportedUrl(input);
      if (platform === 'threads') {
        if (isThreadsSharePath(url.pathname)) {
          const share = parseThreadsShareRef(url);
          return resolveRemote(share.canonicalShareUrl, 'threads');
        }
        const ref = parseThreadsContentRef(url);
        return resolveRemote(ref.canonicalUrl, 'threads', ref.canonicalUrl);
      }
      if (platform !== 'instagram' || isInstagramFixtureUrl(url))
        return fixtureResolver.resolve(input);
      const ref = parseInstagramContentRef(url);
      return resolveRemote(ref.canonicalUrl, 'instagram', ref.canonicalUrl);
    },
  };
}

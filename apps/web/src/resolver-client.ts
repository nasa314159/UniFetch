import {
  UniFetchError,
  parseSupportedUrl,
  resolverApiResponseSchema,
  type RuntimeAdapter,
} from '@unifetch/core';
import {
  createResolver,
  isInstagramFixtureUrl,
  type InstagramResolutionResult,
} from '@unifetch/meta-resolver';
import { parseInstagramContentRef } from '@unifetch/meta-resolver/instagram';
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
  return {
    async resolve(input: string): Promise<InstagramResolutionResult> {
      const { url, platform } = parseSupportedUrl(input);
      if (platform !== 'instagram' || isInstagramFixtureUrl(url))
        return fixtureResolver.resolve(input);
      const ref = parseInstagramContentRef(url);
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
          body: JSON.stringify({ url: ref.canonicalUrl }),
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
        });
        const parsed = resolverApiResponseSchema.safeParse(
          await response.json(),
        );
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
        if (result.post.canonicalUrl !== ref.canonicalUrl)
          throw new UniFetchError(
            'PARSER_OUTDATED',
            'The Resolver returned a result for a different URL.',
          );
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
    },
  };
}

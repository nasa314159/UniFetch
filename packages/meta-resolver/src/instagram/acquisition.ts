import {
  UniFetchError,
  type ResolveContext,
  type RuntimeResponse,
} from '@unifetch/core';
import { inspectInstagramGraphql } from './graphql-errors';
import type { InstagramContentRef } from './content-ref';
import { POLARIS_POST_ROOT_PROFILE_V1 as profile } from './endpoint-profile';
import { buildInstagramPostRootRequest } from './request-builder';

export interface InstagramAcquisitionResult {
  raw: unknown;
  network: { origin: string; purpose: 'metadata' }[];
}
export interface InstagramAcquisitionAdapter {
  acquirePublicMedia(
    ref: InstagramContentRef,
    context: ResolveContext,
  ): Promise<InstagramAcquisitionResult>;
}
function fail(
  code:
    | 'RATE_LIMITED'
    | 'LOGIN_REQUIRED'
    | 'CONTENT_UNAVAILABLE'
    | 'NETWORK_ERROR'
    | 'PARSER_OUTDATED'
    | 'GRAPHQL_EXECUTION_ERROR'
    | 'UNKNOWN',
): never {
  const messages = {
    RATE_LIMITED: 'Instagram has rate-limited this request. Try again later.',
    LOGIN_REQUIRED:
      'Instagram requires login for this content. No login flow is available.',
    CONTENT_UNAVAILABLE: 'This Instagram content is unavailable.',
    NETWORK_ERROR: 'The Instagram request could not be completed.',
    UNKNOWN: 'Instagram metadata could not be processed.',
    GRAPHQL_EXECUTION_ERROR:
      'Instagram returned an application-level error for this request.',
    PARSER_OUTDATED:
      'Instagram did not return a structured response recognized by this profile.',
  };
  throw new UniFetchError(code, messages[code]);
}
/** Transport/error classification only; the M4A parser owns media schemas. */
function classify(response: RuntimeResponse): unknown {
  if (response.status === 429) fail('RATE_LIMITED');
  if (
    response.redirected ||
    (response.status >= 300 && response.status < 400) ||
    response.status === 401 ||
    response.status === 403
  )
    fail('LOGIN_REQUIRED');
  if (response.status === 404 || response.status === 410)
    fail('CONTENT_UNAVAILABLE');
  if (response.status === 0)
    throw new UniFetchError(
      'BROWSER_RESTRICTION',
      'The browser did not expose a readable response.',
    );
  if (response.status !== 200) fail('UNKNOWN');
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(response.body));
  } catch {
    fail('GRAPHQL_EXECUTION_ERROR');
  }
  const summary = inspectInstagramGraphql(raw);
  if (summary.category) fail(summary.category);
  return raw;
}

export class PolarisPostRootAcquisitionAdapter implements InstagramAcquisitionAdapter {
  async acquirePublicMedia(
    ref: InstagramContentRef,
    context: ResolveContext,
  ): Promise<InstagramAcquisitionResult> {
    const request = buildInstagramPostRootRequest(ref);
    const origin = new URL(profile.endpoint).origin;
    if (!context.runtime.prepareOriginSession)
      throw new UniFetchError(
        'BROWSER_RESTRICTION',
        'This runtime cannot prepare the required origin session.',
      );
    try {
      // The runtime owns the GET bootstrap, cookie context and CSRF injection.
      const session = await context.runtime.prepareOriginSession(origin, {
        csrfCookieName: profile.csrfCookieName,
      });
      const response = await session.request(request);
      return {
        raw: classify(response),
        network: [{ origin, purpose: 'metadata' }],
      };
    } catch (error) {
      if (error instanceof UniFetchError) throw error;
      fail('UNKNOWN');
    }
  }
}

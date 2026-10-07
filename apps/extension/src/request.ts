import {
  buildInstagramPostRootRequest,
  type InstagramContentRef,
} from '@unifetch/meta-resolver/instagram';

export interface StrategyRequest {
  endpoint: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  csrfHeader: string;
}

/**
 * Reuses the single existing Polaris profile and request builder. The builder
 * never returns a Cookie header or a CSRF token value; the runtime owns those.
 */
export function buildStrategyRequest(
  ref: InstagramContentRef,
): StrategyRequest {
  const request = buildInstagramPostRootRequest(ref);
  return {
    endpoint: request.url,
    method: 'POST',
    headers: { ...(request.headers ?? {}) },
    body: request.body ?? '',
    csrfHeader: request.csrfHeader ?? 'X-CSRFToken',
  };
}

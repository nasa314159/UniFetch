import type {
  AuthenticatedResponseKind,
  InjectedRequestInput,
  RawStrategyOutcome,
} from './contracts';

const responseKinds: readonly AuthenticatedResponseKind[] = [
  'JSON',
  'HTML',
  'EMPTY',
];

const MAX_BODY_CHARS = 1024 * 1024;

/**
 * Validates the request parameters before they cross into an injected context.
 * Malformed messages and any Cookie-named header are rejected.
 */
export function validateBridgeRequest(
  value: unknown,
): InjectedRequestInput | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const input = value as Record<string, unknown>;
  if (typeof input.endpoint !== 'string' || !input.endpoint) return undefined;
  if (typeof input.body !== 'string') return undefined;
  if (typeof input.csrfHeader !== 'string' || !input.csrfHeader)
    return undefined;
  if (
    !input.headers ||
    typeof input.headers !== 'object' ||
    Array.isArray(input.headers)
  )
    return undefined;
  const headers: Record<string, string> = {};
  for (const [name, raw] of Object.entries(
    input.headers as Record<string, unknown>,
  )) {
    if (typeof raw !== 'string') return undefined;
    if (name.toLowerCase() === 'cookie') return undefined;
    headers[name] = raw;
  }
  const csrfToken =
    typeof input.csrfToken === 'string' && input.csrfToken
      ? input.csrfToken
      : undefined;
  return {
    endpoint: input.endpoint,
    body: input.body,
    headers,
    csrfHeader: input.csrfHeader,
    ...(csrfToken ? { csrfToken } : {}),
  };
}

/**
 * Validates an outcome returning from an injected context and copies only the
 * whitelisted fields. Cookie, session and arbitrary page state are dropped.
 */
export function validateInjectedOutcome(
  value: unknown,
): RawStrategyOutcome | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const outcome = value as Record<string, unknown>;
  if (typeof outcome.reached !== 'boolean') return undefined;
  if (
    typeof outcome.httpStatus !== 'number' ||
    !Number.isFinite(outcome.httpStatus)
  )
    return undefined;
  if (
    typeof outcome.responseKind !== 'string' ||
    !responseKinds.includes(outcome.responseKind as AuthenticatedResponseKind)
  )
    return undefined;
  if (typeof outcome.csrfUsed !== 'boolean') return undefined;
  const contentType =
    typeof outcome.contentType === 'string' ? outcome.contentType : undefined;
  const jsonText =
    typeof outcome.jsonText === 'string'
      ? outcome.jsonText.slice(0, MAX_BODY_CHARS)
      : undefined;
  const redirected = outcome.redirected === true ? true : undefined;
  const error =
    outcome.error === 'NETWORK_ERROR' || outcome.error === 'BROWSER_RESTRICTION'
      ? outcome.error
      : undefined;
  return {
    reached: outcome.reached,
    httpStatus: outcome.httpStatus,
    responseKind: outcome.responseKind as AuthenticatedResponseKind,
    csrfUsed: outcome.csrfUsed,
    ...(contentType ? { contentType } : {}),
    ...(jsonText !== undefined ? { jsonText } : {}),
    ...(redirected ? { redirected } : {}),
    ...(error ? { error } : {}),
  };
}

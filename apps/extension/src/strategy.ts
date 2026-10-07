import type { RawStrategyOutcome } from './contracts';
import { extractCsrfToken } from './csrf';
import type { StrategyRequest } from './request';

export interface ResponseLike {
  status: number;
  redirected?: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const MAX_BODY_CHARS = 1024 * 1024;

export async function interpretResponse(
  response: ResponseLike,
  csrfUsed: boolean,
): Promise<RawStrategyOutcome> {
  let text = '';
  try {
    text = await response.text();
  } catch {
    text = '';
  }
  const contentType = response.headers.get('content-type') ?? undefined;
  const trimmed = text.trim();
  const isJson =
    /json/i.test(contentType ?? '') ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[');
  const responseKind = text.length === 0 ? 'EMPTY' : isJson ? 'JSON' : 'HTML';
  return {
    reached: true,
    httpStatus: response.status,
    responseKind,
    csrfUsed,
    ...(contentType ? { contentType } : {}),
    ...(responseKind === 'JSON'
      ? { jsonText: text.slice(0, MAX_BODY_CHARS) }
      : {}),
    ...(response.redirected ? { redirected: true } : {}),
  };
}

/**
 * Strategy C: the extension service worker with host permission. Cookies are
 * attached by the runtime via credentials; no Cookie header is constructed and
 * no cookie API is used.
 */
export async function runBackgroundFetch(
  request: StrategyRequest,
  csrfToken: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<RawStrategyOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  const csrfUsed = Boolean(csrfToken);
  try {
    const headers: Record<string, string> = { ...request.headers };
    if (csrfToken) headers[request.csrfHeader] = csrfToken;
    const response = await fetchImpl(request.endpoint, {
      method: request.method,
      headers,
      body: request.body,
      credentials: 'include',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
    });
    return await interpretResponse(response, csrfUsed);
  } catch {
    return {
      reached: false,
      httpStatus: 0,
      responseKind: 'EMPTY',
      error: 'NETWORK_ERROR',
      csrfUsed,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mirrors the existing profile's bootstrap step without any cookie API: a
 * same-origin GET whose HTML may carry the CSRF value used by the profile.
 */
export async function prepareCsrfContext(
  origin: string,
  fetchImpl: FetchLike = fetch,
): Promise<string | undefined> {
  try {
    const response = await fetchImpl(`${origin}/`, {
      method: 'GET',
      credentials: 'include',
      redirect: 'follow',
      cache: 'no-store',
    });
    if (response.status !== 200) return undefined;
    return extractCsrfToken(await response.text());
  } catch {
    return undefined;
  }
}

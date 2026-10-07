import type { InjectedRequestInput, RawStrategyOutcome } from './contracts';

/**
 * Strategy A + B. This function is intentionally self-contained: it is passed to
 * chrome.scripting.executeScript as `func`, so it must not close over any module
 * scope. It performs the profile request with the execution context's own
 * credentials. It never reads page cookies through any cookie API, never
 * constructs a Cookie header, never reads storage and returns only the sanitized
 * outcome.
 */
export async function authenticatedRequestFunction(
  input: InjectedRequestInput,
): Promise<RawStrategyOutcome> {
  if (
    !input ||
    typeof input.endpoint !== 'string' ||
    typeof input.body !== 'string' ||
    typeof input.csrfHeader !== 'string' ||
    !input.headers ||
    typeof input.headers !== 'object'
  )
    return {
      reached: false,
      httpStatus: 0,
      responseKind: 'EMPTY',
      error: 'BROWSER_RESTRICTION',
      csrfUsed: false,
    };
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    if (typeof value !== 'string') continue;
    // Defense in depth: a Cookie header is never sent by this PoC.
    if (name.toLowerCase() === 'cookie') continue;
    headers[name] = value;
  }
  const csrfToken =
    typeof input.csrfToken === 'string' && input.csrfToken
      ? input.csrfToken
      : undefined;
  if (csrfToken) headers[input.csrfHeader] = csrfToken;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(input.endpoint, {
      method: 'POST',
      headers,
      body: input.body,
      credentials: 'include',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
    });
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
      csrfUsed: Boolean(csrfToken),
      ...(contentType ? { contentType } : {}),
      ...(responseKind === 'JSON' ? { jsonText: text.slice(0, 1048576) } : {}),
      ...(response.redirected ? { redirected: true } : {}),
    };
  } catch {
    return {
      reached: false,
      httpStatus: 0,
      responseKind: 'EMPTY',
      error: 'NETWORK_ERROR',
      csrfUsed: Boolean(csrfToken),
    };
  } finally {
    clearTimeout(timer);
  }
}

import {
  UniFetchError,
  type RuntimeAdapter,
  type RuntimeRequest,
  type RuntimeResponse,
  type RuntimeSession,
  type RuntimeSessionOptions,
  type MediaAsset,
} from '@unifetch/core';
import {
  downloadLocalAsset,
  type DownloadAttemptResult,
} from '@unifetch/downloader';

function restriction(message: string): never {
  throw new UniFetchError('BROWSER_RESTRICTION', message);
}
const forbiddenHeaders = new Set([
  'host',
  'origin',
  'connection',
  'content-length',
  'user-agent',
  'cookie',
  'cookie2',
  'set-cookie',
  'referer',
]);
function checkedHeaders(input?: Record<string, string>): Headers {
  const headers = new Headers(input);
  for (const name of headers.keys()) {
    if (
      forbiddenHeaders.has(name) ||
      name.startsWith('sec-') ||
      name.startsWith('proxy-')
    )
      restriction('The browser owns this request header.');
  }
  return headers;
}
export class WebRuntime implements RuntimeAdapter {
  constructor(
    private readonly onDownload?: (result: DownloadAttemptResult) => void,
  ) {}
  capabilities() {
    return { downloads: true, crossOriginRequests: false };
  }
  private sameOrigin(input: string): URL {
    let url: URL;
    try {
      url = new URL(input, window.location.origin);
    } catch {
      restriction('The runtime request URL is invalid.');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== window.location.origin ||
      url.username ||
      url.password
    )
      restriction(
        'This web runtime cannot access another origin’s session or readable response.',
      );
    return url;
  }
  private async send(
    input: RuntimeRequest,
    credentials: 'omit' | 'same-origin',
  ): Promise<RuntimeResponse> {
    const url = this.sameOrigin(input.url);
    const headers = checkedHeaders(input.headers);
    try {
      const response = await fetch(url, {
        method: input.method ?? 'GET',
        headers,
        body: input.body,
        credentials,
        mode: 'same-origin',
        redirect: 'manual',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      if (
        response.type === 'opaque' ||
        response.type === 'opaqueredirect' ||
        response.status === 0
      )
        restriction('The browser did not expose a readable response.');
      return {
        status: response.status,
        body: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') ?? undefined,
        redirected: response.redirected,
      };
    } catch (error) {
      if (error instanceof UniFetchError) throw error;
      throw new UniFetchError(
        'NETWORK_ERROR',
        'The request could not be completed.',
      );
    }
  }
  request(input: RuntimeRequest): Promise<RuntimeResponse> {
    return this.send(input, 'omit');
  }
  async prepareOriginSession(
    origin: string,
    options: RuntimeSessionOptions,
  ): Promise<RuntimeSession> {
    const url = this.sameOrigin(origin);
    if (
      url.href !== `${url.origin}/` ||
      !/^[A-Za-z0-9_-]+$/.test(options.csrfCookieName)
    )
      restriction('The origin session configuration is invalid.');
    // Cross-origin contexts are rejected before bootstrap: ordinary web JS
    // cannot read that origin's cookie context. There is no bypass or fallback.
    const bootstrap = await this.send(
      { url: `${url.origin}/`, method: 'GET' },
      'same-origin',
    );
    if (bootstrap.status === 429)
      throw new UniFetchError(
        'RATE_LIMITED',
        'The origin has rate-limited the session request.',
      );
    if (
      bootstrap.redirected ||
      (bootstrap.status >= 300 && bootstrap.status < 400) ||
      bootstrap.status === 401 ||
      bootstrap.status === 403
    )
      throw new UniFetchError('LOGIN_REQUIRED', 'The origin requires login.');
    if (bootstrap.status === 404 || bootstrap.status === 410)
      throw new UniFetchError(
        'CONTENT_UNAVAILABLE',
        'The origin is unavailable.',
      );
    if (bootstrap.status < 200 || bootstrap.status >= 300)
      throw new UniFetchError(
        'NETWORK_ERROR',
        'The origin session request failed.',
      );
    // Read inside runtime only, without returning or retaining the token.
    const readToken = (): string => {
      let cookies: string;
      try {
        cookies = document.cookie;
      } catch {
        restriction(
          'The browser does not expose the required session context.',
        );
      }
      const prefix = `${options.csrfCookieName}=`;
      const value = cookies
        .split(';')
        .map((cookie) => cookie.trim())
        .find((cookie) => cookie.startsWith(prefix))
        ?.slice(prefix.length);
      if (!value)
        restriction(
          'The browser does not expose the required CSRF session context.',
        );
      return value;
    };
    readToken();
    return {
      request: async (input) => {
        const destination = this.sameOrigin(input.url);
        if (destination.origin !== url.origin)
          restriction('The session is bound to its original origin.');
        const headers = checkedHeaders(input.headers);
        if (input.csrfHeader) {
          if (!/^[A-Za-z0-9-]+$/.test(input.csrfHeader))
            restriction('The CSRF header name is invalid.');
          checkedHeaders({ [input.csrfHeader]: '' });
          headers.set(input.csrfHeader, readToken());
        }
        return this.send(
          { ...input, headers: Object.fromEntries(headers) },
          'same-origin',
        );
      },
    };
  }
  download(asset: MediaAsset): Promise<void> {
    return downloadLocalAsset(asset, this.onDownload);
  }
}

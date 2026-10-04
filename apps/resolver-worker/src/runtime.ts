import {
  UniFetchError,
  type RuntimeAdapter,
  type RuntimeRequest,
  type RuntimeResponse,
  type RuntimeSession,
  type RuntimeSessionOptions,
} from '@unifetch/core';
import {
  inspectInstagramGraphql,
  POLARIS_POST_ROOT_PROFILE_V1 as profile,
} from '@unifetch/meta-resolver/instagram';
import { boundedBody } from './bounded-body';
import {
  anonymousRequestHeaders,
  createAnonymousCookieJar,
  cookieHeader,
} from './anonymous-profile';
import {
  bodyDetails,
  exceptionDetails,
  fetchErrorCode,
  responseDetails,
  type DiagnosticObserver,
} from './diagnostics';

const origin = new URL(profile.endpoint).origin;
export type UpstreamFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
/** Instantiated per /api/resolve request; only known bootstrap/metadata destinations. */
export class CloudflareMetadataRuntime implements RuntimeAdapter {
  constructor(
    private readonly fetcher: UpstreamFetch = fetch,
    private readonly observe?: DiagnosticObserver,
  ) {}
  capabilities() {
    return { downloads: false, crossOriginRequests: true };
  }
  async download(): Promise<void> {
    throw new UniFetchError(
      'BROWSER_RESTRICTION',
      'This metadata runtime cannot download media.',
    );
  }
  request(input: RuntimeRequest): Promise<RuntimeResponse> {
    return this.send(input);
  }
  private async send(
    input: RuntimeRequest,
    sessionHeaders?: Headers,
  ): Promise<RuntimeResponse> {
    const bootstrap =
      input.url === `${origin}/` && (input.method ?? 'GET') === 'GET';
    if (
      !bootstrap &&
      !(input.url === profile.endpoint && input.method === profile.method)
    )
      throw new UniFetchError(
        'UNSUPPORTED_CONTENT',
        'The resolver only requests its fixed Instagram metadata profile.',
      );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const started = Date.now();
    let received = false;
    let readStarted = started;
    try {
      const fetcher = this.fetcher;
      const response = await fetcher(input.url, {
        method: input.method ?? 'GET',
        body: input.body,
        headers: sessionHeaders ?? anonymousRequestHeaders(input.headers),
        redirect: 'manual',
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      });
      received = true;
      this.observe?.({
        stage: bootstrap ? 'BOOTSTRAP_REQUEST' : 'GRAPHQL_REQUEST',
        fetchThrew: false,
        ...responseDetails(response),
        elapsedMs: Date.now() - started,
      });
      this.observe?.({
        stage: bootstrap ? 'BOOTSTRAP_RESPONSE' : 'GRAPHQL_RESPONSE',
        ...responseDetails(response),
        elapsedMs: Date.now() - started,
      });
      if (bootstrap) {
        await response.body?.cancel();
        return {
          status: response.status,
          body: new Uint8Array(),
          redirected: response.redirected,
        };
      }
      readStarted = Date.now();
      const body = await boundedBody(
        response.body,
        1024 * 1024,
        'PARSER_OUTDATED',
      );
      this.observe?.({
        stage: 'RESPONSE_READ',
        ...bodyDetails(body),
        elapsedMs: Date.now() - readStarted,
      });
      if (this.observe) {
        try {
          this.observe({
            stage: 'GRAPHQL_CLASSIFICATION',
            status: response.status,
            ...inspectInstagramGraphql(
              JSON.parse(new TextDecoder().decode(body)),
            ),
            elapsedMs: 0,
          });
        } catch {
          this.observe({
            stage: 'GRAPHQL_CLASSIFICATION',
            status: response.status,
            category: 'GRAPHQL_EXECUTION_ERROR',
            elapsedMs: 0,
          });
        }
      }
      return {
        status: response.status,
        body,
        contentType: response.headers.get('content-type') ?? undefined,
        redirected: response.redirected,
      };
    } catch (error) {
      this.observe?.({
        stage: received
          ? 'RESPONSE_READ'
          : bootstrap
            ? 'BOOTSTRAP_REQUEST'
            : 'GRAPHQL_REQUEST',
        fetchThrew: !received,
        ...exceptionDetails(error),
        elapsedMs: Date.now() - (received ? readStarted : started),
      });
      if (error instanceof UniFetchError) throw error;
      throw new UniFetchError(
        bootstrap && received ? 'UNKNOWN' : fetchErrorCode(error),
        bootstrap && received
          ? 'The bootstrap response could not be handled.'
          : fetchErrorCode(error) === 'UNKNOWN'
            ? 'The metadata runtime could not perform the request.'
            : 'The upstream metadata request failed or timed out.',
      );
    } finally {
      clearTimeout(timer);
    }
  }
  async prepareOriginSession(
    requestedOrigin: string,
    options: RuntimeSessionOptions,
  ): Promise<RuntimeSession> {
    if (
      requestedOrigin !== origin ||
      options.csrfCookieName !== profile.csrfCookieName
    )
      throw new UniFetchError(
        'UNSUPPORTED_CONTENT',
        'Unsupported metadata session configuration.',
      );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let bootstrap: Response;
    const cookies = createAnonymousCookieJar();
    const bootstrapHeaders = anonymousRequestHeaders();
    bootstrapHeaders.set('Cookie', cookieHeader(cookies));
    const started = Date.now();
    let received = false;
    try {
      const fetcher = this.fetcher;
      bootstrap = await fetcher(`${origin}/`, {
        method: 'GET',
        headers: bootstrapHeaders,
        redirect: 'manual',
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      });
      received = true;
      this.observe?.({
        stage: 'BOOTSTRAP_REQUEST',
        fetchThrew: false,
        ...responseDetails(bootstrap),
        elapsedMs: Date.now() - started,
      });
      this.observe?.({
        stage: 'BOOTSTRAP_RESPONSE',
        ...responseDetails(bootstrap),
        elapsedMs: Date.now() - started,
      });
      await bootstrap.body?.cancel();
    } catch (error) {
      this.observe?.({
        stage: received ? 'BOOTSTRAP_RESPONSE' : 'BOOTSTRAP_REQUEST',
        fetchThrew: !received,
        ...exceptionDetails(error),
        elapsedMs: Date.now() - started,
      });
      throw new UniFetchError(
        received ? 'UNKNOWN' : fetchErrorCode(error),
        received
          ? 'The bootstrap response could not be handled.'
          : fetchErrorCode(error) === 'UNKNOWN'
            ? 'The metadata runtime could not perform the request.'
            : 'The upstream session request failed or timed out.',
      );
    } finally {
      clearTimeout(timer);
    }
    if (bootstrap.status === 429)
      throw new UniFetchError(
        'RATE_LIMITED',
        'Instagram temporarily limited the request.',
      );
    if (
      bootstrap.redirected ||
      (bootstrap.status >= 300 && bootstrap.status < 400) ||
      bootstrap.status === 401 ||
      bootstrap.status === 403
    )
      throw new UniFetchError(
        'LOGIN_REQUIRED',
        'This profile requires Instagram authentication.',
      );
    if (bootstrap.status === 404 || bootstrap.status === 410)
      throw new UniFetchError(
        'CONTENT_UNAVAILABLE',
        'The upstream content is unavailable.',
      );
    if (bootstrap.status !== 200)
      throw new UniFetchError(
        'UNKNOWN',
        'Instagram returned an unexpected bootstrap HTTP response.',
      );
    // Per-request cookies stay inside this runtime closure and are never returned.
    const extractionStarted = Date.now();
    let lines: string[];
    try {
      const cookieHeaders = bootstrap.headers as Headers & {
        getAll?: (name: string) => string[];
      };
      lines =
        typeof cookieHeaders.getSetCookie === 'function'
          ? cookieHeaders.getSetCookie()
          : typeof cookieHeaders.getAll === 'function'
            ? cookieHeaders.getAll('Set-Cookie')
            : [cookieHeaders.get('set-cookie') ?? ''];
    } catch (error) {
      this.observe?.({
        stage: 'SESSION_EXTRACTION',
        setCookiePresent: bootstrap.headers.has('set-cookie'),
        csrfTokenFound: false,
        ...exceptionDetails(error),
        elapsedMs: Date.now() - extractionStarted,
      });
      throw new UniFetchError(
        'UNKNOWN',
        'The bootstrap cookie headers could not be read.',
      );
    }
    for (const line of lines) {
      for (const cookie of line.split(/,(?=\s*[A-Za-z0-9_-]+=)/)) {
        const pair = cookie.split(';', 1)[0];
        const equal = pair.indexOf('=');
        if (equal > 0) {
          const name = pair.slice(0, equal).trim();
          const value = pair.slice(equal + 1).trim();
          if (
            name !== 'sessionid' &&
            name !== 'ds_user_id' &&
            /^[A-Za-z0-9_-]+$/.test(name) &&
            value &&
            !/[\r\n]/.test(value)
          )
            cookies.set(name, value);
        }
      }
    }
    this.observe?.({
      stage: 'SESSION_EXTRACTION',
      setCookiePresent: bootstrap.headers.has('set-cookie'),
      csrfTokenFound: Boolean(cookies.get(options.csrfCookieName)),
      elapsedMs: Date.now() - extractionStarted,
    });
    if (!cookies.get(options.csrfCookieName)) {
      cookies.clear();
      throw new UniFetchError(
        'LOGIN_REQUIRED',
        'The public upstream session did not provide the CSRF context required by this profile.',
      );
    }
    let used = false;
    return {
      request: async (input) => {
        if (
          used ||
          input.url !== profile.endpoint ||
          input.method !== profile.method ||
          input.csrfHeader !== profile.csrfHeader
        )
          throw new UniFetchError(
            'UNSUPPORTED_CONTENT',
            'The metadata session permits one fixed-profile request.',
          );
        used = true;
        try {
          const headers = anonymousRequestHeaders(input.headers);
          headers.set('Cookie', cookieHeader(cookies));
          headers.set(profile.csrfHeader, cookies.get(options.csrfCookieName)!);
          return await this.send(input, headers);
        } finally {
          cookies.clear();
        }
      },
    };
  }
}

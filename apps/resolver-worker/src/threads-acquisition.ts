import { UniFetchError } from '@unifetch/core';
import type {
  ThreadsAcquisitionAdapter,
  ThreadsAcquisitionResult,
  ThreadsContentRef,
} from '@unifetch/meta-resolver/threads';
import { boundedBody } from './bounded-body';
import {
  bodyDetails,
  exceptionDetails,
  fetchErrorCode,
  responseDetails,
  type DiagnosticObserver,
} from './diagnostics';
import type { UpstreamFetch } from './runtime';

const origin = 'https://www.threads.com';
const maxHtmlBytes = 4 * 1024 * 1024;
const requestHeaders: Readonly<Record<string, string>> = Object.freeze({
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
});

function postUrl(ref: ThreadsContentRef): string {
  return `${origin}/@${ref.username}/post/${ref.shortcode}/`;
}

function embedUrl(ref: ThreadsContentRef): string {
  return `${origin}/@${ref.username}/post/${ref.shortcode}/embed`;
}

function unavailable(): never {
  throw new UniFetchError(
    'CONTENT_UNAVAILABLE',
    'This Threads post is unavailable.',
  );
}

function classify(response: Response, target: string): void {
  if (response.status === 429)
    throw new UniFetchError(
      'RATE_LIMITED',
      'Threads temporarily limited this request.',
    );
  if (response.status === 401 || response.status === 403)
    throw new UniFetchError(
      'LOGIN_REQUIRED',
      'Threads requires authentication for this post.',
    );
  if (response.status === 404 || response.status === 410) unavailable();
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (location) {
      try {
        const redirect = new URL(location, target);
        if (
          redirect.origin === origin &&
          redirect.searchParams.get('error') === 'invalid_post'
        )
          unavailable();
        if (
          redirect.origin === origin &&
          redirect.pathname.startsWith('/@') &&
          redirect.pathname !== new URL(target).pathname
        )
          throw new UniFetchError(
            'UNSUPPORTED_CONTENT',
            'The Threads post did not match the requested account.',
          );
      } catch (error) {
        if (error instanceof UniFetchError) throw error;
      }
    }
    unavailable();
  }
  if (response.status !== 200)
    throw new UniFetchError(
      'NETWORK_ERROR',
      'The Threads request could not be completed.',
    );
}

/**
 * Worker-owned transport for one exact public Threads post. The upstream URL is
 * constructed only from a validated reference; redirects are never followed and
 * media bytes are never requested.
 */
export class CloudflareThreadsAcquisitionAdapter implements ThreadsAcquisitionAdapter {
  constructor(
    private readonly fetcher: UpstreamFetch = fetch,
    private readonly observe?: DiagnosticObserver,
  ) {}

  acquirePost(ref: ThreadsContentRef): Promise<ThreadsAcquisitionResult> {
    return this.fetchHtml(postUrl(ref), 'post');
  }

  acquireEmbed(ref: ThreadsContentRef): Promise<ThreadsAcquisitionResult> {
    return this.fetchHtml(embedUrl(ref), 'embed');
  }

  private async fetchHtml(
    target: string,
    kind: 'post' | 'embed',
  ): Promise<ThreadsAcquisitionResult> {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      throw new UniFetchError(
        'UNSUPPORTED_CONTENT',
        'The Threads acquisition target is invalid.',
      );
    }
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.port ||
      !url.pathname.startsWith('/@')
    )
      throw new UniFetchError(
        'UNSUPPORTED_CONTENT',
        'The Threads acquisition target is invalid.',
      );

    const requestStage =
      kind === 'post' ? 'THREADS_POST_REQUEST' : 'THREADS_EMBED_REQUEST';
    const responseStage =
      kind === 'post' ? 'THREADS_POST_RESPONSE' : 'THREADS_EMBED_RESPONSE';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const started = Date.now();
    let received = false;
    let readStarted = started;
    try {
      const fetcher = this.fetcher;
      const response = await fetcher(url.href, {
        method: 'GET',
        headers: requestHeaders,
        redirect: 'manual',
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      });
      received = true;
      this.observe?.({
        stage: requestStage,
        fetchThrew: false,
        ...responseDetails(response),
        elapsedMs: Date.now() - started,
      });
      this.observe?.({
        stage: responseStage,
        ...responseDetails(response),
        elapsedMs: Date.now() - started,
      });
      try {
        classify(response, url.href);
      } catch (error) {
        await response.body?.cancel();
        throw error;
      }
      readStarted = Date.now();
      const bytes = await boundedBody(
        response.body,
        maxHtmlBytes,
        'PARSER_OUTDATED',
      );
      this.observe?.({
        stage: 'THREADS_RESPONSE_READ',
        ...bodyDetails(bytes),
        elapsedMs: Date.now() - readStarted,
      });
      const html = new TextDecoder().decode(bytes);
      if (!html.trim())
        throw new UniFetchError(
          'PARSER_OUTDATED',
          'Threads returned an empty page for this post.',
        );
      return {
        html,
        network: [{ origin, purpose: 'metadata' }],
      };
    } catch (error) {
      if (!received) {
        this.observe?.({
          stage: requestStage,
          fetchThrew: true,
          ...exceptionDetails(error),
          elapsedMs: Date.now() - started,
        });
        if (error instanceof UniFetchError) throw error;
        const code = fetchErrorCode(error);
        throw new UniFetchError(
          code,
          code === 'UNKNOWN'
            ? 'The Threads request could not be performed.'
            : 'The Threads request failed or timed out.',
        );
      }
      if (error instanceof UniFetchError) throw error;
      this.observe?.({
        stage: 'THREADS_RESPONSE_READ',
        ...exceptionDetails(error),
        elapsedMs: Date.now() - readStarted,
      });
      throw new UniFetchError(
        'NETWORK_ERROR',
        'The Threads response could not be read.',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

import { UniFetchError } from '@unifetch/core';
import {
  parseThreadsContentRef,
  parseThreadsShareLocation,
  type ThreadsAcquisitionAdapter,
  type ThreadsAcquisitionResult,
  type ThreadsContentRef,
  type ThreadsShareExpansion,
  type ThreadsShareRef,
} from '@unifetch/meta-resolver/threads';
import type { ThreadsHeaderRule } from './header-rule';
import { THREADS_ORIGIN } from './permission';

const maxHtmlBytes = 4 * 1024 * 1024;
const defaultTimeoutMs = 10_000;

export type ThreadsFetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface ThreadsAcquisitionOptions {
  headerRule: ThreadsHeaderRule;
  fetchImpl?: ThreadsFetchLike;
  timeoutMs?: number;
}

interface FetchedHtml {
  html: string;
  finalUrl: string;
  redirected: boolean;
}

interface CachedPost {
  html: string;
  ref: ThreadsContentRef;
}

function postUrl(ref: ThreadsContentRef): string {
  return `${THREADS_ORIGIN}/@${ref.username}/post/${ref.shortcode}/`;
}

function embedUrl(ref: ThreadsContentRef): string {
  return `${THREADS_ORIGIN}/@${ref.username}/post/${ref.shortcode}/embed`;
}

function shareUrl(ref: ThreadsShareRef): string {
  return `${THREADS_ORIGIN}/share/${ref.token}/`;
}

function assertOfficialTarget(target: string, pattern: RegExp): URL {
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
    url.origin !== THREADS_ORIGIN ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !pattern.test(url.pathname)
  )
    throw new UniFetchError(
      'UNSUPPORTED_CONTENT',
      'The Threads acquisition target is invalid.',
    );
  return url;
}

function isLoginPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname.startsWith('/login/') ||
    pathname.startsWith('/accounts/')
  );
}

function assertFinalPost(
  ref: ThreadsContentRef,
  href: string,
  redirected: boolean,
): ThreadsContentRef {
  let final: URL;
  try {
    final = new URL(href);
  } catch {
    throw new UniFetchError(
      'UNSUPPORTED_CONTENT',
      'The Threads page did not resolve to a post.',
    );
  }
  if (isLoginPath(final.pathname))
    throw new UniFetchError(
      'LOGIN_REQUIRED',
      'Threads requires authentication for this post.',
    );
  let parsed: ThreadsContentRef;
  try {
    parsed = parseThreadsContentRef(href);
  } catch {
    throw new UniFetchError(
      'UNSUPPORTED_CONTENT',
      'The Threads page did not resolve to a supported post.',
    );
  }
  if (parsed.canonicalUrl === ref.canonicalUrl) return ref;
  // Threads can 301 a stale/former username to the same post's current
  // canonical handle. Only accept that when the server actually redirected and
  // the shortcode (the stable post identity) is unchanged. The parser then
  // validates the publisher against this final, served URL.
  if (parsed.shortcode !== ref.shortcode || !redirected)
    throw new UniFetchError(
      'UNSUPPORTED_CONTENT',
      'The Threads page did not match the requested post.',
    );
  return parsed;
}

function responseError(status: number, target: string): never {
  if (status === 429)
    throw new UniFetchError(
      'RATE_LIMITED',
      'Threads temporarily limited this request.',
    );
  if (status === 401 || status === 403)
    throw new UniFetchError(
      'LOGIN_REQUIRED',
      'Threads requires authentication for this post.',
    );
  if (status === 404 || status === 410)
    throw new UniFetchError(
      'CONTENT_UNAVAILABLE',
      'This Threads post is unavailable.',
    );
  if (status >= 300 && status < 400)
    throw new UniFetchError(
      'CONTENT_UNAVAILABLE',
      'This Threads page redirected unexpectedly.',
    );
  throw new UniFetchError(
    'NETWORK_ERROR',
    `The Threads ${target} request could not be completed.`,
  );
}

async function readBoundedText(
  response: Response,
  limit: number,
): Promise<string> {
  const body = response.body;
  if (!body) {
    const text = await response.text();
    if (text.length > limit)
      throw new UniFetchError(
        'PARSER_OUTDATED',
        'The Threads response was too large to inspect safely.',
      );
    return text;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new UniFetchError(
          'PARSER_OUTDATED',
          'The Threads response was too large to inspect safely.',
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A cancelled reader may already be released.
    }
  }
}

/**
 * Threads transport for the extension. Every request is a direct HTTPS fetch
 * to the official origin with the source credentials omitted, a bounded body
 * and a timeout. The narrowly scoped header rule only makes the request look
 * like a top-level navigation so Threads returns its SSR metadata; it does not
 * add cookies or authenticated state. Media bytes are never requested here.
 */
export function createThreadsAcquisition(
  options: ThreadsAcquisitionOptions,
): ThreadsAcquisitionAdapter {
  const cache = new Map<string, CachedPost>();
  const fetcher = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;

  async function fetchHtml(
    target: string,
    kind: 'post' | 'share' | 'embed',
  ): Promise<FetchedHtml> {
    const url = assertOfficialTarget(
      target,
      kind === 'embed'
        ? /^\/@[^/]+\/post\/[A-Za-z0-9_-]+\/embed\/?$/
        : kind === 'share'
          ? /^\/share\/[A-Za-z0-9_-]{8,32}\/$/
          : /^\/@[^/]+\/post\/[A-Za-z0-9_-]+\/?$/,
    );
    return options.headerRule.withHeaders(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetcher(url.href, {
            method: 'GET',
            headers: {
              Accept: 'text/html,application/xhtml+xml',
            },
            credentials: 'omit',
            redirect: 'follow',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
            signal: controller.signal,
          });
        } catch (error) {
          const aborted = error instanceof Error && error.name === 'AbortError';
          throw new UniFetchError(
            aborted ? 'NETWORK_ERROR' : 'BROWSER_RESTRICTION',
            aborted
              ? 'The Threads request timed out.'
              : 'The extension could not perform the public Threads request.',
          );
        }
        if (response.type === 'opaque' || response.status === 0)
          throw new UniFetchError(
            'BROWSER_RESTRICTION',
            'The browser blocked the public Threads response.',
          );
        if (!response.ok) responseError(response.status, kind);
        const finalUrl = response.url || url.href;
        const html = await readBoundedText(response, maxHtmlBytes);
        return {
          html,
          finalUrl,
          redirected: Boolean(response.redirected) || finalUrl !== url.href,
        };
      } finally {
        clearTimeout(timer);
      }
    });
  }

  function network(): ThreadsAcquisitionResult['network'] {
    return [{ origin: THREADS_ORIGIN, purpose: 'metadata' }];
  }

  return {
    async acquirePost(
      ref: ThreadsContentRef,
    ): Promise<ThreadsAcquisitionResult> {
      const cached = cache.get(ref.canonicalUrl);
      if (cached)
        return { html: cached.html, network: network(), ref: cached.ref };
      const page = await fetchHtml(postUrl(ref), 'post');
      const finalRef = assertFinalPost(ref, page.finalUrl, page.redirected);
      const entry = { html: page.html, ref: finalRef };
      cache.set(finalRef.canonicalUrl, entry);
      // A stale username is a valid alias for the same post. Cache the alias
      // too so a follow-up call does not repeat the redirect.
      cache.set(ref.canonicalUrl, entry);
      return {
        html: page.html,
        network: network(),
        ...(finalRef !== ref ? { ref: finalRef } : {}),
      };
    },

    async acquireShare(ref: ThreadsShareRef): Promise<ThreadsShareExpansion> {
      const page = await fetchHtml(shareUrl(ref), 'share');
      if (!page.redirected)
        throw new UniFetchError(
          'CONTENT_UNAVAILABLE',
          'This Threads share link is unavailable.',
        );
      let final: URL;
      try {
        final = new URL(page.finalUrl);
      } catch {
        throw new UniFetchError(
          'UNSUPPORTED_CONTENT',
          'The Threads share link did not resolve to a post.',
        );
      }
      if (
        final.origin === THREADS_ORIGIN &&
        final.searchParams.get('error') === 'invalid_post'
      )
        throw new UniFetchError(
          'CONTENT_UNAVAILABLE',
          'This Threads share link is unavailable.',
        );
      const postRef = parseThreadsShareLocation(ref, page.finalUrl);
      cache.set(postRef.canonicalUrl, { html: page.html, ref: postRef });
      return { location: page.finalUrl, network: network() };
    },

    async acquireEmbed(
      ref: ThreadsContentRef,
    ): Promise<ThreadsAcquisitionResult> {
      const page = await fetchHtml(embedUrl(ref), 'embed');
      let final: URL;
      try {
        final = new URL(page.finalUrl);
      } catch {
        throw new UniFetchError(
          'UNSUPPORTED_CONTENT',
          'The Threads embed resolved outside the official host.',
        );
      }
      if (isLoginPath(final.pathname))
        throw new UniFetchError(
          'LOGIN_REQUIRED',
          'Threads requires authentication for this post.',
        );
      if (
        final.origin !== THREADS_ORIGIN ||
        !/^\/@[^/]+\/post\/[A-Za-z0-9_-]+\/embed\/?$/.test(final.pathname)
      )
        throw new UniFetchError(
          'UNSUPPORTED_CONTENT',
          'The Threads embed resolved outside the official post.',
        );
      return { html: page.html, network: network() };
    },
  };
}

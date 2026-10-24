import { parseSupportedUrl, UniFetchError } from '@unifetch/core';

export interface ThreadsContentRef {
  username: string;
  shortcode: string;
  canonicalUrl: string;
}

/** One official Threads share token, before the server-side expansion. */
export interface ThreadsShareRef {
  token: string;
  canonicalShareUrl: string;
}

const usernamePattern = /^[A-Za-z0-9._]{1,64}$/;
const shortcodePattern = /^[A-Za-z0-9_-]{1,64}$/;
// Observed official share tokens are 9-10 URL-safe characters. Keep a small
// bounded window so a malformed path is rejected before any network request.
const shareTokenPattern = /^[A-Za-z0-9_-]{8,32}$/;

export function isThreadsSharePath(pathname: string): boolean {
  return pathname === '/share' || pathname.startsWith('/share/');
}

function invalid(message: string): never {
  throw new UniFetchError('INVALID_URL', message);
}

/**
 * Accepts only one explicit public Threads post. Host aliases are normalized
 * by core first; all query parameters and decorative slug/media segments are
 * discarded so the Worker fetches one deterministic canonical URL.
 */
export function parseThreadsContentRef(input: string | URL): ThreadsContentRef {
  const { url, platform } = parseSupportedUrl(String(input));
  if (platform !== 'threads')
    throw new UniFetchError('UNSUPPORTED_PLATFORM', 'Use a Threads post URL.');
  if (!['www.threads.com', 'www.threads.net'].includes(url.hostname))
    invalid('Use the canonical www.threads.com Threads host.');
  if (url.pathname === '/t' || url.pathname.startsWith('/t/'))
    throw new UniFetchError(
      'UNSUPPORTED_CONTENT',
      'Open the canonical Threads post link instead of a /t/ short link.',
    );
  if (url.pathname === '/share' || url.pathname.startsWith('/share/'))
    throw new UniFetchError(
      'UNSUPPORTED_CONTENT',
      'Threads share links are not supported. Open the original post link.',
    );

  const match = /^\/@([^/]+)\/post\/([A-Za-z0-9_-]+)(?:\/[^/]+)?\/?$/.exec(
    url.pathname,
  );
  if (!match) {
    const knownPostPath = /^\/@[^/]+\/post(?:\/|$)/.test(url.pathname);
    if (knownPostPath)
      throw new UniFetchError(
        'INVALID_URL',
        'The Threads link has a missing or malformed post identifier.',
      );
    throw new UniFetchError(
      'UNSUPPORTED_CONTENT',
      'Only one explicit public Threads post URL is supported.',
    );
  }

  let username: string;
  try {
    username = decodeURIComponent(match[1]).toLowerCase();
  } catch {
    invalid('The Threads username is malformed.');
  }
  if (!usernamePattern.test(username))
    invalid('The Threads username is malformed.');
  const shortcode = match[2];
  if (!shortcodePattern.test(shortcode))
    invalid('The Threads post identifier is malformed.');

  url.protocol = 'https:';
  url.hostname = 'www.threads.com';
  url.pathname = `/@${username}/post/${shortcode}/`;
  url.search = '';
  url.hash = '';
  return { username, shortcode, canonicalUrl: url.href };
}

/**
 * Accepts one official Threads share URL. Expansion to a canonical post is
 * deliberately not done here: it requires a controlled, redirect-aware network
 * request and must be validated by the caller.
 */
export function parseThreadsShareRef(input: string | URL): ThreadsShareRef {
  const { url, platform } = parseSupportedUrl(String(input));
  if (platform !== 'threads')
    throw new UniFetchError('UNSUPPORTED_PLATFORM', 'Use a Threads share URL.');
  if (!['www.threads.com', 'www.threads.net'].includes(url.hostname))
    invalid('Use the canonical www.threads.com Threads host.');
  const match = /^\/share\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
  if (!match)
    throw new UniFetchError(
      'UNSUPPORTED_CONTENT',
      'Only one official Threads share link is supported.',
    );
  const token = match[1];
  if (!shareTokenPattern.test(token))
    throw new UniFetchError(
      'INVALID_URL',
      'The Threads share token is malformed.',
    );
  url.protocol = 'https:';
  url.hostname = 'www.threads.com';
  url.pathname = `/share/${token}/`;
  url.search = '';
  url.hash = '';
  return { token, canonicalShareUrl: url.href };
}

import { UniFetchError } from '@unifetch/core';
import {
  parseThreadsContentRef,
  type ThreadsContentRef,
  type ThreadsShareRef,
} from './content-ref';

const threadsOrigin = 'https://www.threads.com';

function rejected(message: string): never {
  throw new UniFetchError('UNSUPPORTED_CONTENT', message);
}

/**
 * Validates the single redirect destination observed for a Threads share link.
 * Only an HTTPS canonical Threads post on the exact official origin is
 * accepted. Query tokens on the destination (for example `xmt`) are discarded
 * by the canonical content-ref parser; no other redirect is followed.
 */
export function parseThreadsShareLocation(
  ref: ThreadsShareRef,
  location: string,
): ThreadsContentRef {
  let redirect: URL;
  try {
    redirect = new URL(location, ref.canonicalShareUrl);
  } catch {
    rejected('The Threads share link did not resolve to a post.');
  }
  if (
    redirect.protocol !== 'https:' ||
    redirect.origin !== threadsOrigin ||
    redirect.username ||
    redirect.password ||
    redirect.port
  )
    rejected('The Threads share link resolved outside the official host.');
  if (redirect.pathname === '/login' || redirect.pathname.startsWith('/login/'))
    throw new UniFetchError(
      'LOGIN_REQUIRED',
      'Threads requires authentication to expand this share link.',
    );
  // Share expansion is stricter than user-supplied permalinks: only the exact
  // post path is accepted, never a decorative slug or nested segment.
  if (!/^\/@[^/]+\/post\/[A-Za-z0-9_-]+\/?$/.test(redirect.pathname))
    rejected('The Threads share link did not resolve to a supported post.');
  try {
    return parseThreadsContentRef(redirect.href);
  } catch (error) {
    if (error instanceof UniFetchError && error.code === 'LOGIN_REQUIRED')
      throw error;
    rejected('The Threads share link did not resolve to a supported post.');
  }
}

import type { InstagramContentRef } from '@unifetch/meta-resolver/instagram';
import { assertInstagramTabUrl } from './orchestrate';

export type PathCategory =
  | 'post'
  | 'reel'
  | 'root'
  | 'profile-like'
  | 'other'
  | 'non-http'
  | 'unavailable';

export type UrlSource =
  'scripting-location' | 'tab-url' | 'canonical' | 'og-url' | 'none';

/** Sanitized preflight diagnostics: no full URL, no shortcode, no query. */
export interface PreflightDiagnostic {
  urlObtained: boolean;
  source: UrlSource;
  hostname?: string;
  pathCategory: PathCategory;
}

export interface UrlCandidate {
  url?: string;
  source: UrlSource;
}

export type PreflightResult =
  | { ok: true; ref: InstagramContentRef }
  | { ok: false; error: string; diagnostic: PreflightDiagnostic };

export function categorizePath(pathname: string): PathCategory {
  if (pathname === '' || pathname === '/') return 'root';
  if (/^\/p\/[A-Za-z0-9_-]+\/?$/.test(pathname)) return 'post';
  if (/^\/reels?\/[A-Za-z0-9_-]+\/?$/.test(pathname)) return 'reel';
  if (/^\/[A-Za-z0-9_.]+\/?$/.test(pathname)) return 'profile-like';
  return 'other';
}

export function describeUrl(
  url: string | undefined,
  source: UrlSource,
): PreflightDiagnostic {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url))
    return {
      urlObtained: typeof url === 'string' && url.length > 0,
      source,
      pathCategory: url ? 'non-http' : 'unavailable',
    };
  try {
    const parsed = new URL(url);
    return {
      urlObtained: true,
      source,
      hostname: parsed.hostname,
      pathCategory: categorizePath(parsed.pathname),
    };
  } catch {
    return { urlObtained: true, source, pathCategory: 'other' };
  }
}

/**
 * Resolves the explicit current-tab content reference from ordered candidates.
 * Only the existing content-ref parser decides acceptance.
 */
export function resolveContentRef(
  candidates: readonly UrlCandidate[],
): PreflightResult {
  let lastError = 'Open an Instagram post or Reel tab first.';
  let last: UrlCandidate | undefined;
  for (const candidate of candidates) {
    last = candidate;
    if (!candidate.url) continue;
    try {
      return { ok: true, ref: assertInstagramTabUrl(candidate.url) };
    } catch (error) {
      if (error instanceof Error) lastError = error.message;
    }
  }
  return {
    ok: false,
    error: lastError,
    diagnostic: describeUrl(last?.url, last?.source ?? 'none'),
  };
}

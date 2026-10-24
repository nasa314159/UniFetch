import { UniFetchError } from '@unifetch/core';
import { mediaUrl } from './parser';
import type { ThreadsContentRef } from './content-ref';
import type { ThreadsEmbedGif } from './types';

function numericEntity(value: string, radix: 10 | 16): string {
  const code = Number.parseInt(value, radix);
  return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : '';
}

function decodeAttribute(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => numericEntity(hex, 16))
    .replace(/&#(\d+);/g, (_, decimal: string) => numericEntity(decimal, 10))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function isExactPostLink(value: string, ref: ThreadsContentRef): boolean {
  let url: URL;
  try {
    url = new URL(decodeAttribute(value));
  } catch {
    return false;
  }
  if (
    ![
      'www.threads.com',
      'threads.com',
      'www.threads.net',
      'threads.net',
    ].includes(url.hostname)
  )
    return false;
  const match = /^\/@([^/]+)\/post\/([A-Za-z0-9_-]+)(?:\/.*)?\/?$/.exec(
    url.pathname,
  );
  if (!match || match[2] !== ref.shortcode) return false;
  try {
    return decodeURIComponent(match[1]).toLowerCase() === ref.username;
  } catch {
    return false;
  }
}

function isImageProxyHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'fbcdn.net' || host.endsWith('.fbcdn.net');
}

function giphyUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  return mediaUrl(value, 'gif');
}

/**
 * Reads only the public embed page for the exact requested post. The embed uses
 * a Facebook image proxy whose `url` parameter contains the direct Giphy GIF.
 * We return the inner direct URL; UniFetch never proxies the media.
 */
export function parseThreadsEmbedGif(
  html: string,
  ref: ThreadsContentRef,
): ThreadsEmbedGif {
  const links = [...html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].map(
    (match) => decodeAttribute(match[1]),
  );
  if (!links.some((link) => isExactPostLink(link, ref)))
    throw new UniFetchError(
      'PARSER_OUTDATED',
      'The Threads embed did not match the requested post.',
    );

  const candidates = new Set<string>();
  for (const match of html.matchAll(
    /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi,
  )) {
    const source = decodeAttribute(match[1]);
    let src: URL;
    try {
      src = new URL(source, 'https://www.threads.com');
    } catch {
      continue;
    }
    if (isImageProxyHost(src.hostname)) {
      const inner = giphyUrl(src.searchParams.get('url'));
      if (inner) candidates.add(inner);
      continue;
    }
    const direct = mediaUrl(source, 'gif');
    if (direct) candidates.add(direct);
  }

  if (candidates.size === 0)
    throw new UniFetchError(
      'UNSUPPORTED_CONTENT',
      'This Threads GIF has no publicly available animated media.',
    );
  if (candidates.size > 1)
    throw new UniFetchError(
      'PARSER_OUTDATED',
      'The Threads embed contained ambiguous GIF media.',
    );
  return { url: [...candidates][0] };
}

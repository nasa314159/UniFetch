import { parseSupportedUrl, UniFetchError } from '@unifetch/core';

export interface InstagramContentRef {
  kind: 'post' | 'reel';
  shortcode: string;
  canonicalUrl: string;
}

export function parseInstagramContentRef(
  input: string | URL,
): InstagramContentRef {
  const { url, platform } = parseSupportedUrl(String(input));
  if (platform !== 'instagram')
    throw new UniFetchError(
      'UNSUPPORTED_PLATFORM',
      'Use an Instagram post or Reel URL.',
    );
  const match = /^\/(p|reel|reels)\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
  if (!match) {
    const knownPath = /^\/(p|reel|reels)(?:\/|$)/.test(url.pathname);
    throw new UniFetchError(
      knownPath ? 'INVALID_URL' : 'UNSUPPORTED_CONTENT',
      knownPath
        ? 'The Instagram link has a missing or malformed shortcode.'
        : 'Only Instagram post and Reel paths are supported.',
    );
  }
  const kind = match[1] === 'p' ? 'post' : 'reel';
  url.protocol = 'https:';
  url.pathname = `/${kind === 'post' ? 'p' : 'reel'}/${match[2]}/`;
  return { kind, shortcode: match[2], canonicalUrl: url.href };
}

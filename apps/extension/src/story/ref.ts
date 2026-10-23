import { parseSupportedUrl, UniFetchError } from '@unifetch/core';

/** Minimum identifiers needed for one explicit Story acquisition. */
export interface InstagramStoryRef {
  kind: 'story';
  username: string;
  storyId: string;
  canonicalUrl: string;
}

/** Username-level Story URL (`/stories/<username>/`) without an item id. */
export interface InstagramProfileStoryRef {
  username: string;
  canonicalUrl: string;
}

const usernameSegment = '([A-Za-z0-9._]+)';
const idSegment = '([A-Za-z0-9_-]+)';
const numericId = /^[0-9]{5,25}$/;
const idQueryKeys = [
  'story_media_id',
  'media_id',
  'story_id',
  'storyId',
  'mediaId',
  'pk',
  'id',
] as const;

function readStoryIdFromQuery(url: URL): string | undefined {
  for (const key of idQueryKeys) {
    const value = url.searchParams.get(key);
    if (value && numericId.test(value)) return value;
  }
  return undefined;
}

function instagramUrl(input: string | URL): URL {
  const { url, platform } = parseSupportedUrl(String(input));
  if (platform !== 'instagram')
    throw new UniFetchError(
      'UNSUPPORTED_PLATFORM',
      'Use one explicit Instagram Story URL.',
    );
  return url;
}

/**
 * Accepts only one canonical explicit Story URL:
 *   https://www.instagram.com/stories/<username>/<story-id>/
 * or a username-level URL that already carries the current item id in a query
 * parameter. Rejects profile-only URLs without an id, Highlights, feed/modal
 * shapes and other platforms.
 */
export function parseInstagramStoryRef(input: string | URL): InstagramStoryRef {
  const url = instagramUrl(input);
  const pathMatch = new RegExp(
    `^/stories/${usernameSegment}/${idSegment}/?$`,
  ).exec(url.pathname);
  if (pathMatch && pathMatch[1].toLowerCase() !== 'highlights') {
    url.protocol = 'https:';
    url.pathname = `/stories/${pathMatch[1]}/${pathMatch[2]}/`;
    url.search = '';
    return {
      kind: 'story',
      username: pathMatch[1],
      storyId: pathMatch[2],
      canonicalUrl: url.href,
    };
  }
  const profileMatch = new RegExp(`^/stories/${usernameSegment}/?$`).exec(
    url.pathname,
  );
  if (profileMatch && profileMatch[1].toLowerCase() !== 'highlights') {
    const storyId = readStoryIdFromQuery(url);
    if (storyId) {
      url.protocol = 'https:';
      url.pathname = `/stories/${profileMatch[1]}/${storyId}/`;
      url.search = '';
      return {
        kind: 'story',
        username: profileMatch[1],
        storyId,
        canonicalUrl: url.href,
      };
    }
  }
  throw new UniFetchError(
    'UNSUPPORTED_CONTENT',
    'Only one explicit Instagram Story URL is supported.',
  );
}

/** Accepts only a username-level Story URL with no item id yet. */
export function parseInstagramProfileStoryRef(
  input: string | URL,
): InstagramProfileStoryRef {
  const url = instagramUrl(input);
  const match = new RegExp(`^/stories/${usernameSegment}/?$`).exec(
    url.pathname,
  );
  if (!match || match[1].toLowerCase() === 'highlights')
    throw new UniFetchError(
      'UNSUPPORTED_CONTENT',
      'Only one explicit Instagram Story URL is supported.',
    );
  url.protocol = 'https:';
  url.pathname = `/stories/${match[1]}/`;
  url.search = '';
  return { username: match[1], canonicalUrl: url.href };
}

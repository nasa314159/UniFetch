import { UniFetchError } from '@unifetch/core';
import type { InstagramResolvedAsset } from '@unifetch/meta-resolver/instagram';
import {
  collectTimestampCandidates,
  selectStoryPublication,
  type TimestampCandidateTrace,
} from './timestamp';

export interface InstagramStoryMedia {
  items: InstagramResolvedAsset[];
  /** Response owner username, when present. Never used as an identifier. */
  ownerUsername?: string;
  /**
   * Publication/upload time (epoch seconds) chosen from a trustworthy
   * publication field. When only a coarse date is trustworthy, the exact time
   * is omitted and `publishedDateOnly` is set.
   */
  publishedAt?: number;
  publishedDateOnly?: boolean;
  /** Sanitized provenance trace; field names and kinds only, never values. */
  timestampSources?: TimestampCandidateTrace[];
}

export interface StoryCandidate {
  url: string;
  width?: number;
  height?: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function outdated(): never {
  throw new UniFetchError(
    'PARSER_OUTDATED',
    'The Instagram Story response does not contain a recognized media structure.',
  );
}

function unavailable(): never {
  throw new UniFetchError(
    'CONTENT_UNAVAILABLE',
    'No usable Story media is available.',
  );
}

function mediaUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function dimension(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

export function storyCandidates(value: unknown): StoryCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = record(entry);
    const url = mediaUrl(item?.url);
    if (!url) return [];
    return [
      { url, width: dimension(item?.width), height: dimension(item?.height) },
    ];
  });
}

export function bestStoryCandidate(
  items: readonly StoryCandidate[],
): StoryCandidate | undefined {
  let best: StoryCandidate | undefined;
  let bestArea = -1;
  for (const item of items) {
    if (!mediaUrl(item.url)) continue;
    const area =
      item.width !== undefined && item.height !== undefined
        ? item.width * item.height
        : -1;
    if (!best || area > bestArea) {
      best = item;
      bestArea = area;
    }
  }
  return best;
}

function parseAsset(raw: unknown): InstagramResolvedAsset {
  const item = record(raw);
  if (!item) outdated();
  const rawImages = record(item.image_versions2)?.candidates;
  const rawVideos = item.video_versions;
  const imageCandidates = storyCandidates(rawImages);
  const videoCandidates = storyCandidates(rawVideos);
  const type =
    item.media_type === 1
      ? 'image'
      : item.media_type === 2
        ? 'video'
        : videoCandidates.length
          ? 'video'
          : imageCandidates.length
            ? 'image'
            : undefined;
  if (!type) outdated();
  const usable = type === 'image' ? imageCandidates : videoCandidates;
  if (!usable.length) {
    const source = type === 'image' ? rawImages : rawVideos;
    if (Array.isArray(source) && source.length === 0) unavailable();
    outdated();
  }
  return {
    type,
    ...(imageCandidates.length ? { imageCandidates } : {}),
    ...(videoCandidates.length && type === 'video' ? { videoCandidates } : {}),
    ...(type === 'video'
      ? { thumbnailUrl: bestStoryCandidate(imageCandidates)?.url }
      : {}),
  };
}

/**
 * Separate Story parser: the Story media response is not the Post/Reel
 * `xdt_api__v1__media__shortcode__web_info` wrapper. It accepts a root `items`
 * array or a `data.items` array of Story media items.
 */
export function parseInstagramStoryResponse(raw: unknown): InstagramStoryMedia {
  const root = record(raw);
  const direct = root?.items;
  const nested = record(root?.data)?.items;
  const items = Array.isArray(direct)
    ? direct
    : Array.isArray(nested)
      ? nested
      : undefined;
  if (!items) outdated();
  if (items.length === 0) unavailable();
  const first = record(items[0]);
  const owner = record(first?.user) ?? record(first?.owner);
  const ownerUsername =
    typeof owner?.username === 'string' && owner.username.trim()
      ? owner.username
      : undefined;
  // Inspect only this item's own time-like fields; never enumerate others.
  const selection = selectStoryPublication(
    collectTimestampCandidates(first, Date.now()),
  );
  return {
    items: items.map(parseAsset),
    ...(ownerUsername ? { ownerUsername } : {}),
    ...(selection.exactSeconds !== undefined
      ? { publishedAt: selection.exactSeconds }
      : selection.fallbackSeconds !== undefined
        ? { publishedAt: selection.fallbackSeconds, publishedDateOnly: true }
        : {}),
    ...(selection.sources.length
      ? { timestampSources: selection.sources }
      : {}),
  };
}

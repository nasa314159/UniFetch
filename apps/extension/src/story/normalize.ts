import {
  UniFetchError,
  type MediaAsset,
  type ResolveResult,
} from '@unifetch/core';
import {
  createStoryFilename,
  type StoryFilenameMetadata,
  type StoryTimeZone,
} from './filename';
import { bestStoryCandidate, type InstagramStoryMedia } from './parser';

/**
 * Maps parsed Story media to a ResolveResult-compatible shape. The post id is
 * intentionally omitted so no Story identifier is carried into the result.
 * Filenames come only from reliable local metadata; `metadata.index` is the
 * visible progress index and is the only source of a Story index.
 */
export function normalizeInstagramStory(
  media: InstagramStoryMedia,
  canonicalUrl: string,
  metadata: StoryFilenameMetadata = {},
  timeZone?: StoryTimeZone,
): ResolveResult {
  if (media.items.length === 0)
    throw new UniFetchError(
      'CONTENT_UNAVAILABLE',
      'No usable Story media is available.',
    );
  // Response publication time takes priority over viewer-derived fallbacks.
  const username = media.ownerUsername ?? metadata.username;
  const publishedAt = media.publishedAt ?? metadata.publishedAt;
  const dateOnly =
    media.publishedAt !== undefined
      ? media.publishedDateOnly === true
      : metadata.dateOnly;
  const assets: MediaAsset[] = media.items.map((item, index) => {
    const candidate = bestStoryCandidate(
      (item.type === 'image' ? item.imageCandidates : item.videoCandidates) ??
        [],
    );
    if (!candidate)
      throw new UniFetchError(
        'CONTENT_UNAVAILABLE',
        'No usable Story media is available.',
      );
    return {
      id: `story_${String(index + 1).padStart(2, '0')}`,
      type: item.type,
      url: candidate.url,
      width: candidate.width,
      height: candidate.height,
      ...(item.type === 'video'
        ? {
            thumbnailUrl:
              bestStoryCandidate(item.imageCandidates ?? [])?.url ??
              item.thumbnailUrl,
          }
        : {}),
      suggestedFilename: createStoryFilename(
        { username, publishedAt, dateOnly, index: metadata.index },
        item.type,
        timeZone,
      ),
    };
  });
  return {
    post: {
      platform: 'instagram',
      canonicalUrl,
      assets,
    },
    trace: {
      processedLocally: true,
      remoteProxyUsed: false,
      credentialsExported: false,
      network: [],
    },
  };
}

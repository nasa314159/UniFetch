import type { MediaAsset, ResolveResult } from '@unifetch/core';
import type { InstagramResolvedMedia } from './types';
import {
  bestCandidate,
  mediaUrl,
  outdated,
  unavailable,
  validateShortcode,
} from './validation';

/** Maps offline parsed media only; acquisition/network traces are future work. */
export function normalizeInstagramMedia(
  media: InstagramResolvedMedia,
  canonicalUrl: string,
): ResolveResult {
  validateShortcode(media.shortcode);
  if (media.items.length === 0) unavailable();
  const numbered = media.kind === 'carousel' || media.items.length > 1;
  const assets: MediaAsset[] = media.items.map((item, index) => {
    if (item.type !== 'image' && item.type !== 'video') outdated();
    const candidate = bestCandidate(
      (item.type === 'image' ? item.imageCandidates : item.videoCandidates) ??
        [],
    );
    if (!candidate) unavailable();
    const suffix = numbered ? `_${String(index + 1).padStart(2, '0')}` : '';
    return {
      id: item.id ?? `${media.shortcode}_${String(index + 1).padStart(2, '0')}`,
      type: item.type,
      url: candidate.url,
      width: candidate.width,
      height: candidate.height,
      ...(item.type === 'video'
        ? {
            thumbnailUrl:
              bestCandidate(item.imageCandidates ?? [])?.url ??
              mediaUrl(item.thumbnailUrl),
          }
        : {}),
      suggestedFilename: `instagram_${media.shortcode}${suffix}.${item.type === 'image' ? 'jpg' : 'mp4'}`,
    };
  });
  return {
    post: {
      platform: 'instagram',
      id: media.shortcode,
      canonicalUrl,
      ...(media.owner ? { author: { ...media.owner } } : {}),
      caption: media.caption,
      publishedAt: media.takenAt,
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

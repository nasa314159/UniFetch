import {
  UniFetchError,
  type MediaAsset,
  type ResolveResult,
} from '@unifetch/core';
import { bestThreadsCandidate } from './parser';
import type {
  ThreadsResolvedAsset,
  ThreadsResolvedKind,
  ThreadsResolvedMedia,
} from './types';

function unavailable(): never {
  throw new UniFetchError(
    'CONTENT_UNAVAILABLE',
    'No usable media is available.',
  );
}

function assetDimensions(
  asset: ThreadsResolvedAsset,
  candidateWidth?: number,
  candidateHeight?: number,
): { width?: number; height?: number } {
  const width = candidateWidth ?? asset.width;
  const height = candidateHeight ?? asset.height;
  return {
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
}

function normalizeAsset(
  item: ThreadsResolvedAsset,
  shortcode: string,
  index: number,
  numbered: boolean,
): MediaAsset {
  const suffix = numbered ? `_${String(index + 1).padStart(2, '0')}` : '';
  const id = item.id ?? `${shortcode}_${String(index + 1).padStart(2, '0')}`;
  if (item.type === 'video') {
    const candidate = item.videoCandidates[0];
    if (!candidate) unavailable();
    return {
      id,
      type: 'video',
      url: candidate.url,
      mimeType: 'video/mp4',
      ...assetDimensions(item, candidate.width, candidate.height),
      thumbnailUrl:
        bestThreadsCandidate(item.imageCandidates)?.url ?? item.thumbnailUrl,
      suggestedFilename: `threads_${shortcode}${suffix}.mp4`,
    };
  }
  const candidate = bestThreadsCandidate(item.imageCandidates);
  if (!candidate) unavailable();
  return {
    id,
    type: 'image',
    url: candidate.url,
    ...assetDimensions(item, candidate.width, candidate.height),
    suggestedFilename: `threads_${shortcode}${suffix}.jpg`,
  };
}

/** Maps one exact public Threads post to the shared application domain. */
export function normalizeThreadsMedia(
  media: ThreadsResolvedMedia,
  canonicalUrl: string,
  gifUrl?: string,
): ResolveResult {
  if (media.kind === 'gif') {
    if (!gifUrl)
      throw new UniFetchError(
        'UNSUPPORTED_CONTENT',
        'No publicly available animated GIF was found for this Threads post.',
      );
    return {
      post: {
        platform: 'threads',
        id: media.shortcode,
        canonicalUrl,
        author: {
          username: media.username,
          ...(media.displayName ? { displayName: media.displayName } : {}),
        },
        ...(media.caption ? { caption: media.caption } : {}),
        ...(media.publishedAt ? { publishedAt: media.publishedAt } : {}),
        assets: [
          {
            id: `${media.shortcode}_01`,
            type: 'image',
            url: gifUrl,
            mimeType: 'image/gif',
            ...(media.gif?.directUrl && media.gif.width
              ? { width: media.gif.width }
              : {}),
            ...(media.gif?.directUrl && media.gif.height
              ? { height: media.gif.height }
              : {}),
            suggestedFilename: `threads_${media.shortcode}.gif`,
          },
        ],
      },
      trace: {
        processedLocally: true,
        remoteProxyUsed: false,
        credentialsExported: false,
        network: [],
      },
    };
  }

  if (media.assets.length === 0) unavailable();
  const numbered = media.kind === 'carousel' || media.assets.length > 1;
  const assets = media.assets.map((item, index) =>
    normalizeAsset(item, media.shortcode, index, numbered),
  );
  return {
    post: {
      platform: 'threads',
      id: media.shortcode,
      canonicalUrl,
      author: {
        username: media.username,
        ...(media.displayName ? { displayName: media.displayName } : {}),
      },
      ...(media.caption ? { caption: media.caption } : {}),
      ...(media.publishedAt ? { publishedAt: media.publishedAt } : {}),
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

export function threadsResultKind(
  media: ThreadsResolvedMedia,
): ThreadsResolvedKind {
  return media.kind === 'gif' ? 'image' : media.kind;
}

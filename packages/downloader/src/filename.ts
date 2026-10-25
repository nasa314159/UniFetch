import type { MediaType, Platform } from '@unifetch/core';

export interface FilenameInput {
  platform: Platform;
  username?: string;
  caption?: string;
  assetIndex: number;
  assetCount: number;
  mediaType: MediaType;
  mimeType?: string;
  shortcode?: string;
  contentKind?: 'post' | 'reel';
}

export interface CaptionFilenameInput {
  username?: string;
  caption?: string;
  mediaType: MediaType;
  /** Provisional MIME; the downloader re-derives the extension from final bytes. */
  mimeType?: string;
  /** One-based original asset index, only for a carousel. */
  index?: number;
  /** Used when the author is missing; keeps the platform's existing fallback. */
  authorFallback: string;
  /** Used when the caption has no usable text (for example, no caption). */
  identityFallback: string;
  /**
   * When true, a caption containing only emoji/punctuation is treated as
   * unusable and `identityFallback` is used. Defaults to false so existing
   * Instagram output is unchanged.
   */
  requireMeaningfulCaption?: boolean;
}

const CAPTION_SNIPPET_MAX = 30;
const AUTHOR_MAX = 64;
const FALLBACK_MAX = 64;

export function component(value: string, maxLength: number): string {
  const clean = value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069/\\:*?"<>|]/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/^[ .]+|[ .]+$/g, '');
  return Array.from(clean)
    .slice(0, maxLength)
    .join('')
    .replace(/[ .]+$/g, '')
    .replace(/ /g, '-');
}

export function extensionForMime(mimeType: string): string {
  const mime = mimeType.split(';', 1)[0].trim().toLowerCase();
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/avif': 'avif',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/ogg': 'ogg',
  };
  return extensions[mime] ?? 'bin';
}

/** Replace the previous suffix; the final extension comes only from final bytes' MIME. */
export function finalizeDownloadFilename(
  filename: string,
  mimeType: string,
): string {
  const stem = filename.replace(
    /(?:\.(?:jpg|jpeg|webp|png|gif|avif|svg|bmp|tiff|heic|heif|mp4|webm|mov|mp3|m4a|ogg|bin))+$/i,
    '',
  );
  return `${component(stem, 160) || 'instagram_post_01'}.${extensionForMime(mimeType)}`;
}

/**
 * Shared caption-first naming policy. Instagram and Threads both use
 * `<author>_<caption-snippet>[_NN].<ext>`; the caller supplies the platform's
 * missing-author fallback and the identity fallback used when no usable caption
 * exists (Threads uses its stable shortcode).
 */
export function createCaptionFilename(input: CaptionFilenameInput): string {
  const author =
    component(input.username ?? '', AUTHOR_MAX) ||
    component(input.authorFallback, AUTHOR_MAX) ||
    input.authorFallback;
  const caption = component(input.caption ?? '', CAPTION_SNIPPET_MAX);
  const meaningful =
    input.requireMeaningfulCaption === true
      ? /[\p{L}\p{N}]/u.test(caption)
      : Boolean(caption);
  const fallback =
    component(input.identityFallback, FALLBACK_MAX) || input.identityFallback;
  const snippet = meaningful ? caption : fallback;
  const index =
    input.index !== undefined &&
    Number.isInteger(input.index) &&
    input.index > 0
      ? `_${String(input.index).padStart(2, '0')}`
      : '';
  const mimeType =
    input.mimeType ??
    (input.mediaType === 'video' ? 'video/mp4' : 'image/jpeg');
  return finalizeDownloadFilename(`${author}_${snippet}${index}`, mimeType);
}

/** assetIndex is zero-based in the original post, including when downloading a selection. */
export function createDownloadFilename(input: FilenameInput): string {
  const author = component(input.username ?? '', 64) || input.platform;
  const caption =
    component(input.caption ?? '', 30) || input.contentKind || 'post';
  const index = String(input.assetIndex + 1).padStart(
    Math.max(2, String(input.assetCount).length),
    '0',
  );
  return finalizeDownloadFilename(
    `${author}_${caption}_${index}`,
    input.mimeType ??
      (input.mediaType === 'image' ? 'image/jpeg' : 'application/octet-stream'),
  );
}

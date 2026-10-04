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

function component(value: string, maxLength: number): string {
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

import { component, finalizeDownloadFilename } from '@unifetch/downloader';

/**
 * M8D shared Instagram filename policy (Post / Carousel / Reel). Filenames
 * begin with the content author's username when known, followed by a short
 * human-readable caption snippet. The Instagram shortcode is never used in a
 * normal filename.
 *
 * Reuses the existing UniFetch filename sanitizer (`component`) and final MIME
 * extension logic (`finalizeDownloadFilename`); Unicode is preserved.
 */
export type InstagramContentKind = 'post' | 'reel';

export interface InstagramFilenameInput {
  username?: string;
  caption?: string;
  mediaType: 'image' | 'video';
  /** Provisional MIME; the downloader re-derives the extension from final bytes. */
  mimeType?: string;
  /** One-based original asset index, only for a Carousel. */
  index?: number;
  contentKind: InstagramContentKind;
}

/** Conservative caption snippet length so filenames stay reasonable. */
const CAPTION_SNIPPET_MAX = 30;
const USERNAME_MAX = 64;

export function createInstagramFilename(input: InstagramFilenameInput): string {
  const author = component(input.username ?? '', USERNAME_MAX) || 'instagram';
  const fallback = input.contentKind === 'reel' ? 'reel' : 'post';
  const snippet =
    component(input.caption ?? '', CAPTION_SNIPPET_MAX) || fallback;
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

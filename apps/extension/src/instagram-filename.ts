import { createCaptionFilename } from '@unifetch/downloader';

/**
 * M8D shared Instagram filename policy (Post / Carousel / Reel). Filenames
 * begin with the content author's username when known, followed by a short
 * human-readable caption snippet. The Instagram shortcode is never used in a
 * normal filename.
 *
 * Reuses the shared UniFetch caption filename policy (`createCaptionFilename`),
 * which provides sanitization, truncation and the final MIME extension; Unicode
 * is preserved. Instagram output is intentionally unchanged.
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

export function createInstagramFilename(input: InstagramFilenameInput): string {
  return createCaptionFilename({
    username: input.username,
    caption: input.caption,
    mediaType: input.mediaType,
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    ...(input.index !== undefined ? { index: input.index } : {}),
    authorFallback: 'instagram',
    identityFallback: input.contentKind === 'reel' ? 'reel' : 'post',
    requireMeaningfulCaption: false,
  });
}

/** Internal Threads parser domain; the public application domain lives in core. */
export type ThreadsResolvedKind = 'image' | 'video' | 'carousel';

export interface ThreadsImageCandidate {
  url: string;
  width?: number;
  height?: number;
}

export interface ThreadsVideoCandidate {
  url: string;
  width?: number;
  height?: number;
}

export interface ThreadsResolvedAsset {
  id?: string;
  type: 'image' | 'video';
  imageCandidates: ThreadsImageCandidate[];
  videoCandidates: ThreadsVideoCandidate[];
  thumbnailUrl?: string;
  width?: number;
  height?: number;
}

export interface ThreadsGifInfo {
  /** Giphy's numeric id, when the page exposes it. Never used as a URL. */
  id?: string;
  /** A direct Giphy GIF URL already present in the canonical page, if any. */
  directUrl?: string;
  /** A known static/placeholder preview that must not be downloaded as the GIF. */
  placeholderUrl?: string;
  width?: number;
  height?: number;
  altText?: string;
}

export interface ThreadsResolvedMedia {
  shortcode: string;
  username: string;
  displayName?: string;
  caption?: string;
  publishedAt?: string;
  kind: ThreadsResolvedKind | 'gif';
  assets: ThreadsResolvedAsset[];
  gif?: ThreadsGifInfo;
}

export interface ThreadsEmbedGif {
  url: string;
}

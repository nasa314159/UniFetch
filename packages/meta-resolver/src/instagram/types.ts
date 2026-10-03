/** Internal parser domain; the public application domain remains in core. */
export type InstagramResolvedKind = 'image' | 'video' | 'carousel';
export interface InstagramImageCandidate {
  url: string;
  width?: number;
  height?: number;
}
export interface InstagramVideoCandidate {
  url: string;
  width?: number;
  height?: number;
}
export interface InstagramResolvedAsset {
  id?: string;
  type: 'image' | 'video';
  imageCandidates?: InstagramImageCandidate[];
  videoCandidates?: InstagramVideoCandidate[];
  thumbnailUrl?: string;
}
export interface InstagramResolvedMedia {
  shortcode: string;
  kind: InstagramResolvedKind;
  owner?: { username?: string; displayName?: string };
  caption?: string;
  takenAt?: string;
  items: InstagramResolvedAsset[];
}

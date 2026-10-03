import type { InstagramResolvedAsset, InstagramResolvedMedia } from './types';
import {
  bestCandidate,
  candidates,
  outdated,
  record,
  unavailable,
  validateShortcode,
} from './validation';

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
function identifier(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value))
    return String(value);
  return undefined;
}
function timestamp(value: unknown): string | undefined {
  let milliseconds: number;
  if (typeof value === 'number') milliseconds = value * 1000;
  else if (typeof value === 'string' && value.trim()) {
    milliseconds = /^-?\d+(\.\d+)?$/.test(value)
      ? Number(value) * 1000
      : Date.parse(value);
  } else return undefined;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
function parseAsset(raw: unknown): InstagramResolvedAsset {
  const item = record(raw);
  if (!item) outdated();
  const rawImages = record(item.image_versions2)?.candidates;
  const rawVideos = item.video_versions;
  const imageCandidates = candidates(rawImages);
  const videoCandidates = candidates(rawVideos);
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
    id: identifier(item.id),
    type,
    ...(imageCandidates.length ? { imageCandidates } : {}),
    ...(videoCandidates.length && type === 'video' ? { videoCandidates } : {}),
    ...(type === 'video'
      ? { thumbnailUrl: bestCandidate(imageCandidates)?.url }
      : {}),
  };
}

/** Offline only. The supplied shortcode is authoritative; raw code is ignored. */
export function parseInstagramMediaResponse(
  raw: unknown,
  expectedShortcode: string,
): InstagramResolvedMedia {
  validateShortcode(expectedShortcode);
  const data = record(record(raw)?.data);
  const response = record(data?.xdt_api__v1__media__shortcode__web_info);
  if (!response || !Array.isArray(response.items)) outdated();
  if (response.items.length === 0) unavailable();
  const root = record(response.items[0]);
  if (!root) outdated();
  const carousel =
    Object.hasOwn(root, 'carousel_media') ||
    root.media_type === 8 ||
    root.product_type === 'carousel_container';
  let items: InstagramResolvedAsset[];
  if (carousel) {
    if (!Array.isArray(root.carousel_media)) outdated();
    if (root.carousel_media.length === 0) unavailable();
    // Never skip malformed children: doing so would silently change source order.
    items = root.carousel_media.map(parseAsset);
  } else items = [parseAsset(root)];
  const user = record(root.user);
  const username = optionalText(user?.username);
  const displayName = optionalText(user?.full_name);
  return {
    shortcode: expectedShortcode,
    kind: carousel ? 'carousel' : items[0].type,
    ...(username !== undefined || displayName !== undefined
      ? { owner: { username, displayName } }
      : {}),
    caption: optionalText(record(root.caption)?.text),
    takenAt: timestamp(root.taken_at),
    items,
  };
}

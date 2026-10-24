import { UniFetchError } from '@unifetch/core';
import type {
  ThreadsImageCandidate,
  ThreadsResolvedAsset,
  ThreadsResolvedMedia,
  ThreadsVideoCandidate,
} from './types';

const MAX_SCRIPT_CANDIDATES = 24;
const MAX_JSON_NODES = 50_000;
const MAX_MEDIA_MATCHES = 8;

function outdated(
  message = 'The Threads response does not contain a recognized media structure.',
): never {
  throw new UniFetchError('PARSER_OUTDATED', message);
}

function unavailable(message = 'No usable media is available.'): never {
  throw new UniFetchError('CONTENT_UNAVAILABLE', message);
}

function unsupported(message: string): never {
  throw new UniFetchError('UNSUPPORTED_CONTENT', message);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function identifier(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value))
    return String(value);
  return undefined;
}

function dimension(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
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

function hostAllowed(host: string, kind: 'media' | 'gif'): boolean {
  const normalized = host.toLowerCase();
  if (kind === 'gif')
    return normalized === 'giphy.com' || normalized.endsWith('.giphy.com');
  return (
    normalized === 'cdninstagram.com' ||
    normalized.endsWith('.cdninstagram.com') ||
    normalized === 'fbcdn.net' ||
    normalized.endsWith('.fbcdn.net')
  );
}

/** Only direct public CDN resources; no credentials, custom ports or lookalikes. */
export function mediaUrl(
  value: unknown,
  kind: 'media' | 'gif' = 'media',
): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !hostAllowed(url.hostname, kind)
  )
    return undefined;
  if (kind === 'gif' && !url.pathname.toLowerCase().endsWith('.gif'))
    return undefined;
  return url.href;
}

function safePreviewUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port)
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function imageCandidates(value: unknown): ThreadsImageCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = record(entry);
    const url = mediaUrl(item?.url, 'media');
    if (!url) return [];
    return [
      {
        url,
        width: dimension(item?.width),
        height: dimension(item?.height),
      },
    ];
  });
}

function videoCandidates(value: unknown): ThreadsVideoCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = record(entry);
    const url = mediaUrl(item?.url, 'media');
    if (!url) return [];
    return [
      {
        url,
        width: dimension(item?.width),
        height: dimension(item?.height),
      },
    ];
  });
}

export function bestThreadsCandidate<
  T extends { width?: number; height?: number },
>(items: readonly T[]): T | undefined {
  let best: T | undefined;
  let bestArea = -1;
  for (const item of items) {
    const area =
      item.width !== undefined && item.height !== undefined
        ? item.width * item.height
        : -1;
    if (!best || area > bestArea) {
      best = item;
      bestArea = area;
    }
  }
  return best;
}

function parseAsset(raw: unknown): ThreadsResolvedAsset {
  const item = record(raw);
  if (!item) outdated();
  const images = imageCandidates(record(item.image_versions2)?.candidates);
  const videos = videoCandidates(item.video_versions);
  const type =
    item.media_type === 1
      ? 'image'
      : item.media_type === 2
        ? 'video'
        : undefined;
  if (!type) outdated();
  if (type === 'image' && images.length === 0) {
    if (Array.isArray(record(item.image_versions2)?.candidates)) unavailable();
    outdated();
  }
  if (type === 'video' && videos.length === 0) {
    if (Array.isArray(item.video_versions)) unavailable();
    outdated();
  }
  return {
    id: identifier(item.id) ?? identifier(item.pk),
    type,
    imageCandidates: images,
    videoCandidates: type === 'video' ? videos : [],
    width: dimension(item.original_width),
    height: dimension(item.original_height),
    ...(type === 'video'
      ? { thumbnailUrl: bestThreadsCandidate(images)?.url }
      : {}),
  };
}

function parseGif(
  media: Record<string, unknown>,
): Pick<ThreadsResolvedMedia, 'kind' | 'assets' | 'gif'> {
  const giphy = record(media.giphy_media_info);
  if (!giphy) unsupported('This Threads post contains no downloadable media.');
  const images = record(giphy.images);
  const variants = images
    ? Object.values(images).flatMap((value) => {
        const item = record(value);
        return item ? [item] : [];
      })
    : [];
  const directUrl = variants
    .map((item) => mediaUrl(item.url, 'gif'))
    .find((value): value is string => Boolean(value));
  const preview = variants
    .map((item) => safePreviewUrl(item.url))
    .find((value): value is string => Boolean(value));
  const fixed = record(images?.fixed_height) ?? variants[0];
  const gifId = identifier(giphy.id);
  if (!directUrl && !gifId)
    unsupported('This Threads GIF does not expose a usable media reference.');
  return {
    kind: 'gif',
    assets: [],
    gif: {
      ...(gifId ? { id: gifId } : {}),
      ...(directUrl ? { directUrl } : {}),
      ...(!directUrl && preview ? { placeholderUrl: preview } : {}),
      ...(dimension(fixed?.width) ? { width: dimension(fixed?.width) } : {}),
      ...(dimension(fixed?.height) ? { height: dimension(fixed?.height) } : {}),
      ...(text(media.accessibility_caption)
        ? { altText: text(media.accessibility_caption) }
        : {}),
    },
  };
}

function scriptPayloads(html: string, shortcode: string): string[] {
  const needles = [`"code":"${shortcode}"`, `"code": "${shortcode}"`];
  const starts = new Set<number>();
  const payloads: string[] = [];
  for (const needle of needles) {
    let from = 0;
    while (true) {
      const index = html.indexOf(needle, from);
      if (index < 0) break;
      from = index + needle.length;
      const start = html.lastIndexOf('<script', index);
      const openEnd = start < 0 ? -1 : html.indexOf('>', start);
      const end = html.indexOf('</script>', index);
      if (start < 0 || openEnd < 0 || end <= openEnd || starts.has(start))
        continue;
      const tag = html.slice(start, openEnd + 1);
      if (!/type\s*=\s*["']application\/json["']/i.test(tag)) continue;
      starts.add(start);
      if (starts.size > MAX_SCRIPT_CANDIDATES)
        outdated(
          'The Threads page contained too many candidate post payloads.',
        );
      payloads.push(html.slice(openEnd + 1, end));
    }
  }
  return payloads;
}

function mediaObjects(
  root: unknown,
  shortcode: string,
): Record<string, unknown>[] {
  const matches: Record<string, unknown>[] = [];
  const stack: unknown[] = [root];
  let visited = 0;
  while (stack.length) {
    if (++visited > MAX_JSON_NODES)
      outdated('The Threads page payload was too large to inspect safely.');
    const value = stack.pop();
    if (Array.isArray(value)) {
      for (const entry of value) stack.push(entry);
      continue;
    }
    const item = record(value);
    if (!item) continue;
    if (
      item.code === shortcode &&
      typeof item.media_type === 'number' &&
      record(item.user)
    ) {
      matches.push(item);
      if (matches.length > MAX_MEDIA_MATCHES)
        outdated('The Threads page contained ambiguous post data.');
      // Do not walk into a matched post; related/quoted records stay separate.
      continue;
    }
    for (const key of Object.keys(item)) stack.push(item[key]);
  }
  return matches;
}

function selectExactMedia(
  html: string,
  expected: { username: string; shortcode: string },
): Record<string, unknown> {
  const payloads = scriptPayloads(html, expected.shortcode);
  if (payloads.length === 0)
    outdated('The Threads page did not include the expected post data.');
  const unique = new Map<string, Record<string, unknown>>();
  for (const payload of payloads) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    for (const media of mediaObjects(parsed, expected.shortcode)) {
      const key = [
        identifier(media.id) ?? '',
        identifier(media.pk) ?? '',
        text(media.code) ?? '',
        text(record(media.user)?.username) ?? '',
        String(media.media_type),
      ].join('|');
      unique.set(key, media);
    }
  }
  if (unique.size === 0)
    outdated('The Threads page did not include the requested post.');
  if (unique.size > 1)
    outdated('The Threads page returned ambiguous post data.');
  const media = [...unique.values()][0];
  if (text(media.code) !== expected.shortcode)
    outdated('The Threads response did not match the requested post.');
  const owner = text(record(media.user)?.username);
  if (!owner || owner.toLowerCase() !== expected.username.toLowerCase())
    throw new UniFetchError(
      'UNSUPPORTED_CONTENT',
      'The Threads response did not match the requested account.',
    );
  return media;
}

/**
 * Parses one canonical public Threads permalink. The requested shortcode and
 * publisher are authoritative; matching objects elsewhere in the page are
 * never merged into the selected post.
 */
export function parseThreadsSsrHtml(
  html: string,
  expected: { username: string; shortcode: string },
): ThreadsResolvedMedia {
  const media = selectExactMedia(html, expected);
  const user = record(media.user);
  if (user?.text_post_app_is_private === true)
    throw new UniFetchError(
      'LOGIN_REQUIRED',
      'Threads requires authentication for this post.',
    );
  const postInfo = record(media.text_post_app_info);
  if (
    postInfo?.is_post_unavailable === true ||
    postInfo?.post_tombstone_info != null ||
    postInfo?.post_unavailable_reason != null
  )
    unavailable('This Threads post is unavailable.');

  const base = {
    shortcode: expected.shortcode,
    username: expected.username,
    ...(text(user?.full_name) ? { displayName: text(user?.full_name) } : {}),
    ...(text(record(media.caption)?.text)
      ? { caption: text(record(media.caption)?.text) }
      : {}),
    ...(timestamp(media.taken_at)
      ? { publishedAt: timestamp(media.taken_at) }
      : {}),
  };

  const mediaType = media.media_type;
  if (mediaType === 19) return { ...base, ...parseGif(media) };
  if (mediaType === 1 || mediaType === 2) {
    return {
      ...base,
      kind: mediaType === 1 ? 'image' : 'video',
      assets: [parseAsset(media)],
    };
  }
  if (mediaType === 8) {
    if (!Array.isArray(media.carousel_media)) outdated();
    if (media.carousel_media.length === 0) unavailable();
    const assets = media.carousel_media.map(parseAsset);
    return { ...base, kind: 'carousel', assets };
  }
  unsupported('This Threads post contains no downloadable media.');
}

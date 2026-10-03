import { UniFetchError } from '@unifetch/core';
import type { InstagramImageCandidate } from './types';

export function outdated(): never {
  throw new UniFetchError(
    'PARSER_OUTDATED',
    'The Instagram response does not contain a recognized media structure.',
  );
}
export function unavailable(): never {
  throw new UniFetchError(
    'CONTENT_UNAVAILABLE',
    'No usable media is available.',
  );
}
export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
export function mediaUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return undefined;
    return value;
  } catch {
    return undefined;
  }
}
function dimension(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}
export function candidates(value: unknown): InstagramImageCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = record(entry);
    const url = mediaUrl(item?.url);
    if (!url) return [];
    return [
      { url, width: dimension(item?.width), height: dimension(item?.height) },
    ];
  });
}
/** Complete dimensions win; largest area wins; ties/unknown areas retain order. */
export function bestCandidate(
  items: readonly InstagramImageCandidate[],
): InstagramImageCandidate | undefined {
  let best: InstagramImageCandidate | undefined;
  let bestArea = -1;
  for (const item of items) {
    if (!mediaUrl(item.url)) continue;
    const width = dimension(item.width);
    const height = dimension(item.height);
    const area =
      width !== undefined && height !== undefined ? width * height : -1;
    if (!best || area > bestArea) {
      best = item;
      bestArea = area;
    }
  }
  return best;
}
export function validateShortcode(value: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) outdated();
}

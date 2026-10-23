import { finalizeDownloadFilename } from '@unifetch/downloader';

/**
 * M8C Story filename metadata. Only ever populated from reliable, locally
 * available signals: the authenticated Story response owner/`taken_at`, the
 * viewer URL username, a reliable DOM `datetime` attribute, the visible Story
 * progress index, or nothing. Relative UI text such as "17 hours ago" is never
 * converted into a fabricated timestamp, and no internal numeric Story/media id
 * is ever used.
 */
export interface StoryFilenameMetadata {
  username?: string;
  publishedAt?: number | string;
  /** True when only a publication date (no reliable time) is available. */
  dateOnly?: boolean;
  /** One-based index of the currently visible Story progress segment. */
  index?: number;
}

/**
 * A parsed publication value. A `datetime` is an absolute instant; a `date` is
 * a calendar date with no time (and therefore no timezone conversion).
 */
export type StoryPublishedAt =
  | { kind: 'datetime'; seconds: number }
  | { kind: 'date'; year: number; month: number; day: number };

/** Minutes east of UTC, e.g. `{ offsetMinutes: 480 }` for UTC+8. */
export interface StoryTimeZone {
  offsetMinutes: number;
}

const isoDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/;
const isoDateTime = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

/** The browser's current local timezone offset as minutes east of UTC. */
export function localTimeZone(): StoryTimeZone {
  return { offsetMinutes: -new Date().getTimezoneOffset() };
}

/**
 * Accepts only a numeric epoch (seconds or ms) or an ISO date/datetime.
 * A date-only value is kept as calendar components so it is never shifted by a
 * timezone. Anything else (notably relative UI text like "17 hours ago") is
 * rejected so no fake exact time is ever produced.
 */
export function parseStoryPublishedAt(
  value: number | string | undefined,
): StoryPublishedAt | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return undefined;
    const seconds = Math.floor((value < 1e12 ? value * 1000 : value) / 1000);
    return seconds > 0 ? { kind: 'datetime', seconds } : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (/^\d{9,}$/.test(trimmed)) return parseStoryPublishedAt(Number(trimmed));
  const dateOnly = isoDateOnly.exec(trimmed);
  if (dateOnly)
    return {
      kind: 'date',
      year: Number(dateOnly[1]),
      month: Number(dateOnly[2]),
      day: Number(dateOnly[3]),
    };
  const dateTime = isoDateTime.exec(trimmed);
  if (!dateTime) return undefined;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return { kind: 'datetime', seconds: Math.floor(parsed / 1000) };
}

/**
 * Formats a publication value in the requested timezone using local wall-clock
 * components (never `toISOString()`, never UTC by default). A `date` value keeps
 * its calendar date; a `datetime` value is shifted by the offset and read back
 * with UTC getters, which yields the correct local wall clock for any offset.
 */
export function formatStoryTimestamp(
  published: StoryPublishedAt,
  options: { timeZone?: StoryTimeZone; dateOnly?: boolean } = {},
): string {
  if (published.kind === 'date')
    return `${String(published.year).padStart(4, '0')}${String(
      published.month,
    ).padStart(2, '0')}${String(published.day).padStart(2, '0')}`;
  const offsetMinutes =
    options.timeZone?.offsetMinutes ?? localTimeZone().offsetMinutes;
  const date = new Date(published.seconds * 1000 + offsetMinutes * 60_000);
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  if (options.dateOnly) return `${yyyy}${mm}${dd}`;
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

/**
 * One observed Story progress segment. Either `current` (aria-current), an
 * active `value` (aria-valuenow, 0..1) or an active `width` (fill width, 0..1).
 */
export interface StoryProgressSegment {
  value?: number;
  width?: number;
  current?: boolean;
}

function activeFraction(segment: StoryProgressSegment): number | undefined {
  const raw = segment.value ?? segment.width;
  if (raw === undefined || !Number.isFinite(raw) || raw < 0) return undefined;
  // Accept either a 0..1 fraction or a 0..100 percentage.
  return raw > 1 ? raw / 100 : raw;
}

/**
 * One-based Story index from the currently visible progress segments. Only a
 * single unambiguous active signal is accepted: an `aria-current` segment or
 * exactly one segment with partial (in-progress) progress. Ambiguous or
 * incomplete progress data omits the index rather than guessing.
 */
export function storyIndexFromSegments(
  segments: readonly StoryProgressSegment[],
): number | undefined {
  if (segments.length === 0) return undefined;
  const current = segments
    .map((segment, index) => (segment.current ? index : -1))
    .filter((index) => index >= 0);
  if (current.length === 1) return current[0] + 1;
  if (current.length > 1) return undefined;
  const partial = segments
    .map((segment, index) => {
      const fraction = activeFraction(segment);
      return fraction !== undefined && fraction > 0 && fraction < 1
        ? index
        : -1;
    })
    .filter((index) => index >= 0);
  if (partial.length === 1) return partial[0] + 1;
  return undefined;
}

/**
 * `<username>[_<YYYYMMDD>]_story[_NN].<ext>` built through the existing UniFetch
 * filename sanitizer. Addresses the fact that an exact Story publication time
 * cannot be trusted: only a publication DATE is emitted, never HHMMSS. Missing
 * metadata is omitted gracefully; the extension is provisional and replaced
 * from the final bytes' MIME by the reused downloader.
 */
export function createStoryFilename(
  metadata: StoryFilenameMetadata,
  mediaType: 'image' | 'video',
  timeZone: StoryTimeZone = localTimeZone(),
): string {
  const username =
    typeof metadata.username === 'string' && metadata.username.trim()
      ? metadata.username
      : undefined;
  const parts: string[] = [username ?? 'instagram'];
  const published =
    metadata.publishedAt !== undefined
      ? parseStoryPublishedAt(metadata.publishedAt)
      : undefined;
  if (published)
    parts.push(formatStoryTimestamp(published, { timeZone, dateOnly: true }));
  const index =
    metadata.index !== undefined &&
    Number.isInteger(metadata.index) &&
    metadata.index > 0
      ? metadata.index
      : undefined;
  parts.push(index ? `story_${String(index).padStart(2, '0')}` : 'story');
  return finalizeDownloadFilename(
    parts.join('_'),
    mediaType === 'video' ? 'video/mp4' : 'image/jpeg',
  );
}

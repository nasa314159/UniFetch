/**
 * M8D Story publication timestamp provenance. The Story media response may
 * carry several time-like fields (publication, capture/import, expiry). Only a
 * field whose name semantically represents Story *publication/upload* time is
 * used for an exact filename timestamp; otherwise the exact time is omitted.
 *
 * The candidate comparison model is sanitized: it exposes field names and
 * semantic kinds only, never raw values, Story ids, URLs or usernames.
 */
export type TimestampSemanticKind =
  'unix-seconds' | 'unix-ms' | 'iso-datetime' | 'unknown';

export type TimestampRole = 'publication' | 'ambiguous' | 'expiry' | 'capture';

export interface TimestampCandidateTrace {
  fieldName: string;
  semanticKind: TimestampSemanticKind;
  /** Diagnostic only: minutes from now (negative = in the past). */
  approximateDeltaFromNowMinutes?: number;
}

export interface StoryTimestampCandidate extends TimestampCandidateTrace {
  role: TimestampRole;
  /** Internal only; never exposed. */
  seconds?: number;
  /** True when the source carried a date but no time. */
  dateOnly: boolean;
}

export interface StoryPublicationSelection {
  /** Exact publication epoch seconds, only from a trustworthy publication field. */
  exactSeconds?: number;
  /** Coarse (date-only) fallback epoch seconds when no exact field exists. */
  fallbackSeconds?: number;
  sources: TimestampCandidateTrace[];
}

// Field-name semantics. Story publication/upload names win over ambiguous
// server `taken_at` and over capture/import or expiry names.
const publicationFields = new Set([
  'story_created_at',
  'story_created_at_ms',
  'story_posted_at',
  'story_published_at',
  'story_publication_time',
  'story_publish_time',
  'created_at',
  'created_at_utc',
  'published_at',
  'published_at_utc',
  'upload_time',
  'uploaded_at',
  'post_time',
  'published_time',
]);
const ambiguousFields = new Set([
  'taken_at',
  'taken_at_timestamp',
  'media_taken_at',
]);
const captureFields = new Set([
  'device_timestamp',
  'original_taken_at',
  'capture_time',
  'import_time',
]);
const expiryFields = new Set([
  'expiring_at',
  'expires_at',
  'expiry_at',
  'expiration_time',
]);

function normalizeField(fieldName: string): string {
  return fieldName.trim().toLowerCase();
}

function isTimeLikeField(fieldName: string): boolean {
  const name = normalizeField(fieldName);
  if (
    publicationFields.has(name) ||
    ambiguousFields.has(name) ||
    captureFields.has(name) ||
    expiryFields.has(name)
  )
    return true;
  return (
    /(^|_)(at|timestamp|time)$/.test(name) ||
    /created|published|publish|expir/.test(name)
  );
}

export function roleForField(fieldName: string): TimestampRole {
  const name = normalizeField(fieldName);
  if (publicationFields.has(name)) return 'publication';
  if (captureFields.has(name)) return 'capture';
  if (expiryFields.has(name)) return 'expiry';
  return 'ambiguous';
}

export function classifyTimestampValue(
  value: unknown,
):
  | { semanticKind: TimestampSemanticKind; seconds: number; dateOnly: boolean }
  | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return undefined;
    if (value >= 1e12)
      return {
        semanticKind: 'unix-ms',
        seconds: Math.floor(value / 1000),
        dateOnly: false,
      };
    if (value >= 1e8)
      return {
        semanticKind: 'unix-seconds',
        seconds: Math.floor(value),
        dateOnly: false,
      };
    return undefined;
  }
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (/^\d{13}$/.test(text))
    return {
      semanticKind: 'unix-ms',
      seconds: Math.floor(Number(text) / 1000),
      dateOnly: false,
    };
  if (/^\d{9,}$/.test(text))
    return {
      semanticKind: 'unix-seconds',
      seconds: Number(text),
      dateOnly: false,
    };
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly)
    return {
      semanticKind: 'iso-datetime',
      seconds: Math.floor(
        Date.UTC(
          Number(dateOnly[1]),
          Number(dateOnly[2]) - 1,
          Number(dateOnly[3]),
        ) / 1000,
      ),
      dateOnly: true,
    };
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const parsed = Date.parse(text);
    if (Number.isFinite(parsed))
      return {
        semanticKind: 'iso-datetime',
        seconds: Math.floor(parsed / 1000),
        dateOnly: false,
      };
  }
  return undefined;
}

/**
 * Bounded scan of one Story item's own top-level time-like fields. Never walks
 * the whole response or enumerates other Stories.
 */
export function collectTimestampCandidates(
  item: unknown,
  nowMs: number,
): StoryTimestampCandidate[] {
  if (item === null || typeof item !== 'object' || Array.isArray(item))
    return [];
  const candidates: StoryTimestampCandidate[] = [];
  for (const [fieldName, value] of Object.entries(
    item as Record<string, unknown>,
  )) {
    if (!isTimeLikeField(fieldName)) continue;
    const parsed = classifyTimestampValue(value);
    const delta =
      parsed !== undefined
        ? Math.round(nowMs / 1000 - parsed.seconds) / 60
        : undefined;
    candidates.push({
      fieldName: normalizeField(fieldName),
      role: roleForField(fieldName),
      semanticKind: parsed?.semanticKind ?? 'unknown',
      ...(parsed !== undefined ? { seconds: parsed.seconds } : {}),
      dateOnly: parsed?.dateOnly ?? false,
      ...(delta !== undefined
        ? { approximateDeltaFromNowMinutes: Math.round(delta) }
        : {}),
    });
  }
  return candidates;
}

/**
 * Chooses an exact publication timestamp only from a `publication` field. When
 * nobody trustworthy exists, returns a coarse date-only fallback (from the best
 * available field) so the filename keeps a date without inventing a time.
 */
export function selectStoryPublication(
  candidates: readonly StoryTimestampCandidate[],
): StoryPublicationSelection {
  const sources: TimestampCandidateTrace[] = candidates.map(
    ({ fieldName, semanticKind, approximateDeltaFromNowMinutes }) => ({
      fieldName,
      semanticKind,
      ...(approximateDeltaFromNowMinutes !== undefined
        ? { approximateDeltaFromNowMinutes }
        : {}),
    }),
  );
  const withSeconds = candidates.filter(
    (candidate) => candidate.seconds !== undefined,
  );
  const publication = withSeconds.filter(
    (candidate) => candidate.role === 'publication',
  );
  const exact = publication.find((candidate) => !candidate.dateOnly);
  if (exact && exact.seconds !== undefined)
    return { exactSeconds: exact.seconds, sources };
  const fallback =
    publication[0] ??
    withSeconds.find((candidate) => candidate.role === 'ambiguous') ??
    withSeconds.find((candidate) => candidate.role === 'expiry');
  if (fallback && fallback.seconds !== undefined)
    return { fallbackSeconds: fallback.seconds, sources };
  return { sources };
}

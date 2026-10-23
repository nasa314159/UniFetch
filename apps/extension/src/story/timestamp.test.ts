import { describe, expect, it } from 'vitest';
import {
  classifyTimestampValue,
  collectTimestampCandidates,
  roleForField,
  selectStoryPublication,
} from './timestamp';
import { parseInstagramStoryResponse } from './parser';
import { normalizeInstagramStory } from './normalize';

// 2026-10-12T00:00:00Z, a fixed "now" for deterministic deltas.
const nowMs = Date.UTC(2026, 9, 12, 0, 0, 0);
const publication = Date.UTC(2026, 9, 10, 16, 0, 0) / 1000;
const capture = Date.UTC(2026, 9, 10, 9, 0, 0) / 1000;

function itemResponse(extra: Record<string, unknown>) {
  return {
    items: [
      {
        media_type: 1,
        image_versions2: {
          candidates: [
            { url: 'https://media.invalid/a.jpg', width: 100, height: 100 },
          ],
        },
        ...extra,
      },
    ],
  };
}

describe('timestamp field semantics', () => {
  it('treats explicit publication names as publication and taken_at as ambiguous', () => {
    for (const name of [
      'created_at',
      'created_at_utc',
      'story_created_at',
      'published_at',
      'story_published_at',
      'uploaded_at',
    ])
      expect(roleForField(name)).toBe('publication');
    expect(roleForField('taken_at')).toBe('ambiguous');
    expect(roleForField('taken_at_timestamp')).toBe('ambiguous');
    expect(roleForField('device_timestamp')).toBe('capture');
    expect(roleForField('expiring_at')).toBe('expiry');
  });

  it('classifies numeric semantics by magnitude', () => {
    expect(classifyTimestampValue(publication)?.semanticKind).toBe(
      'unix-seconds',
    );
    expect(classifyTimestampValue(publication * 1000)?.semanticKind).toBe(
      'unix-ms',
    );
    expect(
      classifyTimestampValue('2026-10-10T16:00:00.000Z')?.semanticKind,
    ).toBe('iso-datetime');
    expect(classifyTimestampValue('17 hours ago')).toBeUndefined();
    expect(classifyTimestampValue('not a time')).toBeUndefined();
  });
});

describe('publication field selection', () => {
  it('deprioritizes a wrong taken_at candidate (no exact time)', () => {
    const selection = selectStoryPublication(
      collectTimestampCandidates({ taken_at: publication }, nowMs),
    );
    expect(selection.exactSeconds).toBeUndefined();
    expect(selection.fallbackSeconds).toBe(publication);
    expect(selection.sources.map((source) => source.fieldName)).toEqual([
      'taken_at',
    ]);
  });

  it('chooses a publication field when present, over taken_at', () => {
    const selection = selectStoryPublication(
      collectTimestampCandidates(
        { taken_at: capture, created_at: publication },
        nowMs,
      ),
    );
    expect(selection.exactSeconds).toBe(publication);
    expect(selection.sources.map((source) => source.fieldName).sort()).toEqual([
      'created_at',
      'taken_at',
    ]);
  });

  it('never chooses a capture/import field over a publication field', () => {
    const selection = selectStoryPublication(
      collectTimestampCandidates(
        { device_timestamp: capture, created_at: publication },
        nowMs,
      ),
    );
    expect(selection.exactSeconds).toBe(publication);
  });

  it('omits the exact timestamp when provenance is uncertain', () => {
    const captureOnly = selectStoryPublication(
      collectTimestampCandidates({ device_timestamp: capture }, nowMs),
    );
    expect(captureOnly.exactSeconds).toBeUndefined();
    expect(captureOnly.fallbackSeconds).toBeUndefined();
    const expiry = selectStoryPublication(
      collectTimestampCandidates({ expiring_at: publication }, nowMs),
    );
    expect(expiry.exactSeconds).toBeUndefined();
    expect(expiry.fallbackSeconds).toBe(publication);
  });

  it('never exposes raw values in the sanitized trace', () => {
    const selection = selectStoryPublication(
      collectTimestampCandidates({ created_at: publication }, nowMs),
    );
    const text = JSON.stringify(selection.sources);
    expect(text).not.toContain(String(publication));
    expect(text).toContain('created_at');
  });
});

describe('Story parser publication provenance', () => {
  it('uses a publication field when available', () => {
    const media = parseInstagramStoryResponse(
      itemResponse({ taken_at: capture, created_at: publication }),
    );
    expect(media.publishedAt).toBe(publication);
    expect(media.publishedDateOnly).toBeUndefined();
    expect(
      media.timestampSources?.map((source) => source.fieldName).sort(),
    ).toEqual(['created_at', 'taken_at']);
  });

  it('falls back to a date-only filename when only taken_at exists', () => {
    const media = parseInstagramStoryResponse(
      itemResponse({ taken_at: publication }),
    );
    expect(media.publishedAt).toBe(publication);
    expect(media.publishedDateOnly).toBe(true);
    const resolved = normalizeInstagramStory(
      media,
      'https://www.instagram.com/stories/nasa3.1415/',
      { username: 'nasa3.1415' },
      { offsetMinutes: 480 },
    );
    expect(resolved.post.assets[0].suggestedFilename).toBe(
      'nasa3.1415_20261011_story.jpg',
    );
  });

  it('omits the timestamp entirely for relative UI text', () => {
    const media = parseInstagramStoryResponse(
      itemResponse({ taken_at: '17 hours ago' }),
    );
    expect(media.publishedAt).toBeUndefined();
    const resolved = normalizeInstagramStory(
      media,
      'https://www.instagram.com/stories/nasa3.1415/',
      { username: 'nasa3.1415' },
      { offsetMinutes: 480 },
    );
    expect(resolved.post.assets[0].suggestedFilename).toBe(
      'nasa3.1415_story.jpg',
    );
  });
});

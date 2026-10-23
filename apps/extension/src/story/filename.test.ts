import { describe, expect, it } from 'vitest';
import {
  createStoryFilename,
  formatStoryTimestamp,
  parseStoryPublishedAt,
  storyIndexFromSegments,
  type StoryTimeZone,
} from './filename';
import { normalizeInstagramStory } from './normalize';

// Fixed UTC+8 so timestamp tests never depend on the CI machine timezone.
const utcPlus8: StoryTimeZone = { offsetMinutes: 480 };
// 2026-10-08 14:27:31 local UTC+8 (06:27:31 UTC).
const takenAtLocal1427 = Date.UTC(2026, 9, 8, 6, 27, 31) / 1000;
// 2026-10-07 22:40:00 local UTC+8 (14:40:00 UTC).
const publishedLocal2240 = Date.UTC(2026, 9, 7, 14, 40, 0) / 1000;

describe('Story filename timestamp uses local time', () => {
  it('formats a Unix publication timestamp in local time, not UTC', () => {
    expect(
      formatStoryTimestamp(
        { kind: 'datetime', seconds: publishedLocal2240 },
        { timeZone: utcPlus8 },
      ),
    ).toBe('20261007-224000');
    // The previous UTC-based behaviour was 8 hours early for UTC+8.
    expect(
      formatStoryTimestamp(
        { kind: 'datetime', seconds: publishedLocal2240 },
        { timeZone: { offsetMinutes: 0 } },
      ),
    ).toBe('20261007-144000');
  });

  it('emits only a local publication date, never HHMMSS', () => {
    expect(
      createStoryFilename(
        { username: 'bryan_u6', publishedAt: takenAtLocal1427, index: 3 },
        'video',
        utcPlus8,
      ),
    ).toBe('bryan_u6_20261008_story_03.mp4');
    expect(
      createStoryFilename(
        { username: 'bryan_u6', publishedAt: takenAtLocal1427, index: 3 },
        'video',
        utcPlus8,
      ),
    ).not.toMatch(/-\d{6}/);
  });

  it('never formats filenames with raw toISOString()', () => {
    expect(formatStoryTimestamp.toString()).not.toContain('toISOString');
    expect(createStoryFilename.toString()).not.toContain('toISOString');
  });

  it('keeps a date-only fallback as a local calendar date', () => {
    expect(
      formatStoryTimestamp(
        { kind: 'date', year: 2026, month: 10, day: 7 },
        { timeZone: utcPlus8 },
      ),
    ).toBe('20261007');
    expect(
      createStoryFilename(
        { username: 'bryan_u6', publishedAt: '2026-10-07', index: 3 },
        'image',
        utcPlus8,
      ),
    ).toBe('bryan_u6_20261007_story_03.jpg');
  });

  it('degrades gracefully when no timestamp is available', () => {
    expect(
      createStoryFilename(
        { username: 'bryan_u6', index: 3 },
        'image',
        utcPlus8,
      ),
    ).toBe('bryan_u6_story_03.jpg');
    expect(createStoryFilename({}, 'image', utcPlus8)).toBe(
      'instagram_story.jpg',
    );
  });

  it('never includes an Instagram Story/media numeric id', () => {
    const output = createStoryFilename(
      { username: 'bryan_u6', publishedAt: takenAtLocal1427, index: 3 },
      'image',
      utcPlus8,
    );
    expect(output).not.toContain('1234567890123456789');
    expect(output).not.toMatch(/\d{10,}/);
  });

  it('never converts relative UI text into a fake exact timestamp', () => {
    for (const relative of [
      '17 hours ago',
      '2 days ago',
      'just now',
      'yesterday',
    ])
      expect(parseStoryPublishedAt(relative)).toBeUndefined();
    expect(
      createStoryFilename(
        { username: 'bryan_u6', publishedAt: '17 hours ago', index: 3 },
        'image',
        utcPlus8,
      ),
    ).toBe('bryan_u6_story_03.jpg');
  });
});

describe('Story published time parsing', () => {
  it('accepts epoch seconds and ISO datetimes as exact instants', () => {
    expect(parseStoryPublishedAt(takenAtLocal1427)).toEqual({
      kind: 'datetime',
      seconds: takenAtLocal1427,
    });
    expect(parseStoryPublishedAt('2026-10-08T06:27:31.000Z')).toEqual({
      kind: 'datetime',
      seconds: takenAtLocal1427,
    });
  });

  it('keeps an ISO date-only value as calendar components', () => {
    expect(parseStoryPublishedAt('2026-10-08')).toEqual({
      kind: 'date',
      year: 2026,
      month: 10,
      day: 8,
    });
  });

  it('rejects empty, invalid and relative values', () => {
    for (const value of [
      undefined,
      '',
      '   ',
      'not a date',
      '17 hours ago',
      0,
      -5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ])
      expect(parseStoryPublishedAt(value)).toBeUndefined();
  });
});

describe('Story progress index from viewer segments', () => {
  it('uses an aria-current segment', () => {
    expect(storyIndexFromSegments([{}, { current: true }, {}])).toBe(2);
  });

  it('uses a single in-progress aria-valuenow segment', () => {
    expect(
      storyIndexFromSegments([{ value: 1 }, { value: 0.35 }, { value: 0 }]),
    ).toBe(2);
    // aria-valuenow expressed as a percentage
    expect(
      storyIndexFromSegments([
        { value: 1 },
        { value: 1 },
        { value: 35 },
        { value: 0 },
      ]),
    ).toBe(3);
  });

  it('uses an alternate width-fill progress shape', () => {
    expect(
      storyIndexFromSegments([
        { width: 1 },
        { width: 1 },
        { width: 0.5 },
        { width: 0 },
      ]),
    ).toBe(3);
  });

  it('omits the index for ambiguous or absent active segments', () => {
    for (const segments of [
      [],
      [{}, {}],
      [{ value: 1 }, { value: 1 }],
      [{ value: 0 }, { value: 0 }],
      [{ value: 0.3 }, { value: 0.6 }],
      [{ current: true }, { current: true }],
    ] as const)
      expect(storyIndexFromSegments(segments)).toBeUndefined();
  });

  it('pads a known index to two digits in the filename', () => {
    expect(
      createStoryFilename(
        { username: 'bryan_u6', index: 3 },
        'image',
        utcPlus8,
      ),
    ).toBe('bryan_u6_story_03.jpg');
    expect(
      createStoryFilename(
        { username: 'bryan_u6', index: 12 },
        'image',
        utcPlus8,
      ),
    ).toBe('bryan_u6_story_12.jpg');
  });
});

describe('normalizer uses response metadata locally', () => {
  it('applies the response owner and publication time to the filename', () => {
    const media = {
      items: [
        {
          type: 'image' as const,
          imageCandidates: [
            { url: 'https://media.invalid/x.jpg', width: 1080, height: 1920 },
          ],
        },
      ],
      ownerUsername: 'bryan_u6',
      publishedAt: takenAtLocal1427,
    };
    const resolved = normalizeInstagramStory(
      media,
      'https://www.instagram.com/stories/bryan_u6/',
      { index: 3 },
      utcPlus8,
    );
    expect(resolved.post.assets[0].suggestedFilename).toBe(
      'bryan_u6_20261008_story_03.jpg',
    );
    expect(resolved.post.id).toBeUndefined();
  });

  it('prefers response metadata over a viewer-URL fallback', () => {
    const media = {
      items: [
        {
          type: 'video' as const,
          videoCandidates: [{ url: 'https://media.invalid/v.mp4' }],
          imageCandidates: [{ url: 'https://media.invalid/thumb.jpg' }],
        },
      ],
      ownerUsername: 'response_owner',
      publishedAt: takenAtLocal1427,
    };
    const resolved = normalizeInstagramStory(
      media,
      'https://www.instagram.com/stories/url_name/',
      { username: 'url_name', publishedAt: '2020-01-01T00:00:00Z', index: 1 },
      utcPlus8,
    );
    expect(resolved.post.assets[0].suggestedFilename).toBe(
      'response_owner_20261008_story_01.mp4',
    );
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { RawStrategyOutcome } from '../contracts';
import { runBackgroundFetch, type FetchLike } from '../strategy';
import storyImage from './__fixtures__/story-image.json';
import storyVideo from './__fixtures__/story-video.json';
import {
  classifyStoryOutcome,
  resolveStoryIdentity,
  resolveStoryOutcome,
} from './classify';
import { normalizeInstagramStory } from './normalize';
import { parseInstagramStoryResponse } from './parser';
import { parseInstagramStoryRef, parseInstagramProfileStoryRef } from './ref';
import { buildInstagramStoryRequest } from './request';
import {
  collectReactStoryIdEvidence,
  collectStoryIdCandidates,
  currentStoryIdScanFunction,
  findStoryIdCandidates,
  findStoryIdInState,
  matchOwner,
  resolveCurrentStoryId,
  selectCurrentStoryId,
} from './current-id';

const storyUrl =
  'https://www.instagram.com/stories/fictional_account/1234567890123456789/';
const canonicalStoryUrl = storyUrl;

function outcome(overrides: Partial<RawStrategyOutcome>): RawStrategyOutcome {
  return {
    reached: true,
    httpStatus: 200,
    responseKind: 'JSON',
    csrfUsed: false,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    status,
    redirected: false,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('Story content reference', () => {
  it('accepts one canonical Story URL and strips tracking', () => {
    const ref = parseInstagramStoryRef(
      `${storyUrl}?igsh=secret&utm_source=share#fragment`,
    );
    expect(ref.kind).toBe('story');
    expect(ref.username).toBe('fictional_account');
    expect(ref.storyId).toBe('1234567890123456789');
    expect(ref.canonicalUrl).toBe(canonicalStoryUrl);
  });
  it.each([
    'https://www.instagram.com/stories/fictional_account/',
    'https://www.instagram.com/stories/fictional_account',
    'https://www.instagram.com/stories/highlights/17900000000000000/',
    'https://www.instagram.com/stories/fictional_account/123/extra/',
  ])('rejects profile-only or Highlight Story shape %s', (url) => {
    expect(() => parseInstagramStoryRef(url)).toThrow();
  });
  it.each([
    'https://example.com/stories/fictional_account/123/',
    'https://www.facebook.com/stories/fictional_account/123/',
    'not a url',
  ])('rejects non-Instagram Story input %s', (url) => {
    expect(() => parseInstagramStoryRef(url)).toThrow();
  });
  it('does not carry username, story id or URL into sanitized results', () => {
    const ref = parseInstagramStoryRef(storyUrl);
    const result = classifyStoryOutcome(
      outcome({ jsonText: JSON.stringify(storyImage) }),
      'background',
      ref.canonicalUrl,
    );
    const text = JSON.stringify(result);
    expect(text).not.toContain(ref.username);
    expect(text).not.toContain(ref.storyId);
    expect(text).not.toContain('https://');
    expect(text).not.toContain('stories');
  });
});

describe('Story request builder', () => {
  it('is a separate GET builder with no Cookie header or CSRF token', () => {
    const request = buildInstagramStoryRequest(
      parseInstagramStoryRef(storyUrl),
    );
    expect(request.method).toBe('GET');
    expect(request.body).toBeUndefined();
    expect(request.csrfHeader).toBeUndefined();
    const names = Object.keys(request.headers).map((name) =>
      name.toLowerCase(),
    );
    expect(names).not.toContain('cookie');
    expect(names).not.toContain('authorization');
  });
  it('targets only the Instagram single-media endpoint and never the Resolver', () => {
    const request = buildInstagramStoryRequest(
      parseInstagramStoryRef(storyUrl),
    );
    const url = new URL(request.endpoint);
    expect(url.origin).toBe('https://www.instagram.com');
    expect(url.pathname).toBe('/api/v1/media/1234567890123456789/info/');
    expect(url.search).toBe('');
    expect(request.endpoint).not.toContain('workers.dev');
    expect(request.endpoint).not.toContain('/api/resolve');
  });
  it('does not introduce Story profile enumeration', () => {
    const request = buildInstagramStoryRequest(
      parseInstagramStoryRef(storyUrl),
    );
    for (const token of ['reel_ids', 'reels_media', 'feed/user', 'highlights'])
      expect(request.endpoint).not.toContain(token);
  });
  it('uses runtime credentials with no cookie API or Cookie header', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(storyImage));
    const request = buildInstagramStoryRequest(
      parseInstagramStoryRef(storyUrl),
    );
    const raw = await runBackgroundFetch(request, undefined, fetchImpl);
    expect(raw.reached).toBe(true);
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
    expect(init.body).toBeUndefined();
    const names = Object.keys(
      (init.headers ?? {}) as Record<string, string>,
    ).map((name) => name.toLowerCase());
    expect(names).not.toContain('cookie');
  });
});

describe('Story parser and normalizer', () => {
  it('parses a sanitized image Story fixture', () => {
    const media = parseInstagramStoryResponse(storyImage);
    expect(media.items).toHaveLength(1);
    expect(media.items[0].type).toBe('image');
    const resolved = normalizeInstagramStory(media, canonicalStoryUrl);
    expect(resolved.post.assets).toHaveLength(1);
    expect(resolved.post.assets[0].type).toBe('image');
    expect(resolved.post.assets[0].url).toContain('story-image-high.jpg');
    expect(resolved.post.id).toBeUndefined();
    expect(resolved.trace.processedLocally).toBe(true);
    expect(resolved.trace.credentialsExported).toBe(false);
  });
  it('parses a sanitized video Story fixture', () => {
    const media = parseInstagramStoryResponse(storyVideo);
    expect(media.items[0].type).toBe('video');
    const resolved = normalizeInstagramStory(media, canonicalStoryUrl);
    expect(resolved.post.assets[0].type).toBe('video');
    expect(resolved.post.assets[0].thumbnailUrl).toContain(
      'story-video-thumb.jpg',
    );
  });
  it('classifies a sanitized image fixture as SUCCESS', () => {
    const result = classifyStoryOutcome(
      outcome({ jsonText: JSON.stringify(storyImage) }),
      'background',
      canonicalStoryUrl,
    );
    expect(result).toMatchObject({
      status: 'SUCCESS',
      httpStatus: 200,
      responseKind: 'JSON',
      itemCount: 1,
      assetTypes: ['image'],
      acquisitionContext: 'background',
    });
  });
  it('classifies a sanitized video fixture as SUCCESS', () => {
    const result = classifyStoryOutcome(
      outcome({ jsonText: JSON.stringify(storyVideo) }),
      'background',
      canonicalStoryUrl,
    );
    expect(result).toMatchObject({
      status: 'SUCCESS',
      itemCount: 1,
      assetTypes: ['video'],
    });
  });
  it.each([
    {},
    { data: { changed_schema: 1 } },
    { items: [{ media_type: 99 }] },
    { status: 'ok', num_results: 0 },
  ])('classifies malformed Story response %# as PARSER_OUTDATED', (raw) => {
    const result = classifyStoryOutcome(
      outcome({ jsonText: JSON.stringify(raw) }),
      'background',
      canonicalStoryUrl,
    );
    expect(result.status).toBe('PARSER_OUTDATED');
  });
  it('classifies an empty Story item list as HTTP_ERROR (no media)', () => {
    const result = classifyStoryOutcome(
      outcome({ jsonText: JSON.stringify({ items: [] }) }),
      'background',
      canonicalStoryUrl,
    );
    expect(result.status).toBe('HTTP_ERROR');
  });
  it.each([
    [{ message: 'login_required' }, 'LOGIN_REQUIRED'],
    [
      { data: null, errors: [{ message: 'Fictional execution error' }] },
      'GRAPHQL_EXECUTION_ERROR',
    ],
    [
      { status: 'fail', message: 'Please log in to continue' },
      'LOGIN_REQUIRED',
    ],
  ])(
    'classifies application access failure %# as %s, never PARSER_OUTDATED',
    (raw, expected) => {
      const result = classifyStoryOutcome(
        outcome({ jsonText: JSON.stringify(raw) }),
        'background',
        canonicalStoryUrl,
      );
      expect(result.status).toBe(expected);
      expect(result.status).not.toBe('PARSER_OUTDATED');
    },
  );
});

describe('current Story id resolution (username-level viewer URL)', () => {
  it('parses a username-level Story URL without an item id', () => {
    const profile = parseInstagramProfileStoryRef(
      'https://www.instagram.com/stories/fictional_account/?igsh=secret#x',
    );
    expect(profile.username).toBe('fictional_account');
    expect(profile.canonicalUrl).toBe(
      'https://www.instagram.com/stories/fictional_account/',
    );
  });
  it('rejects Highlights at the username level', () => {
    expect(() =>
      parseInstagramProfileStoryRef(
        'https://www.instagram.com/stories/highlights/',
      ),
    ).toThrow();
  });
  it('accepts an item id supplied in a query parameter', () => {
    const ref = parseInstagramStoryRef(
      'https://www.instagram.com/stories/fictional_account/?story_media_id=1234567890',
    );
    expect(ref.storyId).toBe('1234567890');
    expect(ref.canonicalUrl).toBe(
      'https://www.instagram.com/stories/fictional_account/1234567890/',
    );
  });
  it('ignores non-numeric or missing query ids', () => {
    expect(() =>
      parseInstagramStoryRef(
        'https://www.instagram.com/stories/fictional_account/?media_id=notanid',
      ),
    ).toThrow();
  });
  it('finds one numeric id in bounded nested page state', () => {
    expect(findStoryIdInState({ a: { b: { media_id: '1234567890' } } })).toBe(
      '1234567890',
    );
    expect(findStoryIdInState({ a: { pk: 987654321 } })).toBe('987654321');
    expect(findStoryIdInState({ a: 'username' })).toBeUndefined();
    expect(findStoryIdInState(null)).toBeUndefined();
    // A single media-specific id is preferred over a generic one alongside it.
    expect(
      findStoryIdInState({ a: { media_id: '1234567890', id: '987654321' } }),
    ).toBe('1234567890');
    // Two equally specific candidates remain ambiguous.
    expect(
      findStoryIdInState({
        a: { media_id: '1234567890', story_media_id: '987654321' },
      }),
    ).toBeUndefined();
  });
  it('scans bounded page state without collecting unrelated media ids', () => {
    expect(
      findStoryIdCandidates({ a: { b: { story_media_id: '1234567890' } } }),
    ).toEqual({
      ids: ['1234567890'],
      activeIds: [],
      strongIds: ['1234567890'],
      truncated: false,
      candidates: [
        {
          value: '1234567890',
          key: 'story_media_id',
          keyPath: ['a', 'b', 'story_media_id'],
          active: false,
          strong: true,
        },
      ],
    });
    expect(
      selectCurrentStoryId({
        ids: [],
        activeIds: [],
        strongIds: [],
        truncated: false,
      }).ok,
    ).toBe(false);
  });
  it('keeps the extractor self-contained and non-enumerating', () => {
    const source = currentStoryIdScanFunction.toString();
    expect(source).not.toContain('reels_media');
    expect(source).not.toContain('reel_ids');
    expect(source).not.toContain('document.cookie');
    expect(source).not.toContain('localStorage');
    expect(source).toContain('history.state');
  });
});

describe('Story transport classification', () => {
  it.each([
    [
      outcome({
        reached: false,
        httpStatus: 0,
        responseKind: 'EMPTY',
        error: 'BROWSER_RESTRICTION',
      }),
      'BROWSER_RESTRICTION',
    ],
    [
      outcome({
        reached: false,
        httpStatus: 0,
        responseKind: 'EMPTY',
        error: 'NETWORK_ERROR',
      }),
      'NETWORK_ERROR',
    ],
    [outcome({ httpStatus: 403 }), 'LOGIN_REQUIRED'],
    [outcome({ responseKind: 'HTML' }), 'LOGIN_REQUIRED'],
    [outcome({ httpStatus: 500 }), 'HTTP_ERROR'],
    [outcome({ redirected: true }), 'LOGIN_REQUIRED'],
  ] as const)('classifies Story outcome %# as %s', (raw, expected) => {
    expect(
      classifyStoryOutcome(raw, 'background', canonicalStoryUrl).status,
    ).toBe(expected);
  });
});

describe('username-only current id reuses the existing Story API path', () => {
  const username = 'fictional_account';

  function discoverCurrentId(): string {
    // The active Story media node owns exactly one media id in its current
    // React props; this is the proof the extractor requires.
    const resolution = resolveCurrentStoryId({
      evidence: [
        {
          source: 'react-current-props',
          ...collectReactStoryIdEvidence({
            __reactProps$test: { media_id: '1234567890123456789' },
          }),
        },
      ],
    });
    if (!resolution.id) throw new Error('expected a discovered id');
    return resolution.id;
  }

  function resolveThroughApi(fixture: unknown) {
    const id = discoverCurrentId();
    const canonical = `https://www.instagram.com/stories/${username}/${id}/`;
    const ref = parseInstagramStoryRef(canonical);
    const request = buildInstagramStoryRequest(ref);
    const resolved = resolveStoryOutcome(
      outcome({ jsonText: JSON.stringify(fixture) }),
      'background',
      ref.canonicalUrl,
    );
    return { id, request, resolved };
  }

  it('keeps a static image Story on the visible-media fallback shape', () => {
    // No id is provable for a static image viewer, so the visible-media path
    // still applies; the image fixture remains fully normalized.
    expect(
      collectReactStoryIdEvidence({ __reactProps$test: { playback: 'image' } })
        .ids,
    ).toEqual([]);
    const resolved = normalizeInstagramStory(
      parseInstagramStoryResponse(storyImage),
      canonicalStoryUrl,
    );
    expect(resolved.post.assets[0].type).toBe('image');
  });

  it('resolves a username-only native video Story through the API path', () => {
    const { id, request, resolved } = resolveThroughApi(storyVideo);
    expect(id).toBe('1234567890123456789');
    expect(request.endpoint).toContain(`/api/v1/media/${id}/info/`);
    expect(resolved.result.status).toBe('SUCCESS');
    expect(resolved.asset?.type).toBe('video');
  });

  it('discovers the current video id from a current-rooted React path (physical case B)', () => {
    // Models the observed physical shape: the active card's React subtree holds
    // a current-rooted media id while owner/collection ids are present too.
    const reactCandidates = collectStoryIdCandidates([
      {
        viewer: { current: { media: { mediaId: '1234567890123456789' } } },
        items: [{ pk: '4000000001' }, { pk: '4000000002' }],
        user: { pk: '9999999999' },
        reel: { id: '8888888888' },
      },
    ]).candidates;
    const resolution = resolveCurrentStoryId({
      evidence: [],
      activeRoot: 'proven',
      reactCandidates,
    });
    expect(resolution).toEqual({
      id: '1234567890123456789',
      idExtractionSource: 'react-current-props',
      candidateCount: 1,
      activeMarkerFound: true,
    });
    if (!resolution.id) throw new Error('expected a discovered id');
    const canonical = `https://www.instagram.com/stories/${username}/${resolution.id}/`;
    const request = buildInstagramStoryRequest(
      parseInstagramStoryRef(canonical),
    );
    expect(request.endpoint).toContain(`/api/v1/media/${resolution.id}/info/`);
    const resolved = resolveStoryOutcome(
      outcome({ jsonText: JSON.stringify(storyVideo) }),
      'background',
      canonical,
    );
    expect(resolved.result.status).toBe('SUCCESS');
    expect(resolved.asset?.type).toBe('video');
  });

  it('resolves a Reel shared into a Story through the same API path', () => {
    const { resolved } = resolveThroughApi(storyVideo);
    expect(resolved.result.status).toBe('SUCCESS');
    expect(resolved.asset?.type).toBe('video');
  });

  it('resolves a username-only image + music Story through the same API path', () => {
    const { resolved } = resolveThroughApi(storyVideo);
    expect(resolved.result.status).toBe('SUCCESS');
    expect(resolved.asset?.type).toBe('video');
  });
});

describe('Story identity integrity', () => {
  const route = 'fictional_account';

  it('exposes the API response publisher for owner checks', () => {
    const fixture = {
      items: [
        {
          media_type: 2,
          video_versions: [{ url: 'https://media.invalid/v.mp4' }],
          user: { username: 'other_account' },
        },
      ],
    };
    const resolved = resolveStoryOutcome(
      outcome({ jsonText: JSON.stringify(fixture) }),
      'background',
      canonicalStoryUrl,
    );
    expect(resolved.ownerUsername).toBe('other_account');
    // The sanitized result never carries the owner.
    expect(JSON.stringify(resolved.result)).not.toContain('other_account');
  });

  it('refuses an API response whose publisher differs from the route', () => {
    const responseOwnerMatch = matchOwner(route, 'other_account');
    expect(responseOwnerMatch).toBe(false);
    expect(
      resolveStoryIdentity({
        storySource: 'current-id-page-state',
        activeRoot: 'proven',
        responseOwnerMatch,
      }),
    ).toBe('mismatch');
  });

  it('refuses a candidate owner that differs from the route publisher', () => {
    expect(
      resolveStoryIdentity({
        storySource: 'current-id-page-state',
        activeRoot: 'proven',
        routeOwnerMatch: false,
      }),
    ).toBe('mismatch');
  });

  it('does not reject a repost when the Story publisher matches the route', () => {
    const fixture = {
      items: [
        {
          media_type: 2,
          video_versions: [{ url: 'https://media.invalid/v.mp4' }],
          user: { username: 'fictional_account' },
          original_creator: { username: 'original_creator' },
        },
      ],
    };
    const resolved = resolveStoryOutcome(
      outcome({ jsonText: JSON.stringify(fixture) }),
      'background',
      canonicalStoryUrl,
    );
    expect(resolved.ownerUsername).toBe('fictional_account');
    const responseOwnerMatch = matchOwner(route, resolved.ownerUsername);
    expect(responseOwnerMatch).toBe(true);
    expect(
      resolveStoryIdentity({
        storySource: 'current-id-page-state',
        activeRoot: 'ambiguous',
        responseOwnerMatch,
      }),
    ).toBe('proven');
  });

  it('marks a page-state id unproven without a proven active root or owner', () => {
    expect(
      resolveStoryIdentity({
        storySource: 'current-id-page-state',
        activeRoot: 'ambiguous',
        responseOwnerMatch: 'unknown',
      }),
    ).toBe('unproven');
    expect(
      resolveStoryIdentity({
        storySource: 'current-id-page-state',
        activeRoot: 'proven',
      }),
    ).toBe('proven');
  });

  it('keeps explicit-id and visible-media resolution proven', () => {
    expect(resolveStoryIdentity({ storySource: 'explicit-id-url' })).toBe(
      'proven',
    );
    expect(resolveStoryIdentity({ storySource: 'visible-current-media' })).toBe(
      'proven',
    );
  });
});

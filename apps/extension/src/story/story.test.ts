import { describe, expect, it, vi } from 'vitest';
import type { RawStrategyOutcome } from '../contracts';
import { runBackgroundFetch, type FetchLike } from '../strategy';
import storyImage from './__fixtures__/story-image.json';
import storyVideo from './__fixtures__/story-video.json';
import {
  classifyStoryOutcome,
  matchOwner,
  resolveStoryIdentity,
  resolveStoryOutcome,
} from './classify';
import { normalizeInstagramStory } from './normalize';
import { parseInstagramStoryResponse } from './parser';
import { parseInstagramProfileStoryRef, parseInstagramStoryRef } from './ref';
import { buildInstagramStoryRequest } from './request';
import { routeStoryUrls } from './route';

const storyId = '1234567890123456789';
const username = 'fictional_account';
const storyUrl = `https://www.instagram.com/stories/${username}/${storyId}/`;
const profileStoryUrl = `https://www.instagram.com/stories/${username}/`;

function outcome(overrides: Partial<RawStrategyOutcome>): RawStrategyOutcome {
  return {
    reached: true,
    httpStatus: 200,
    responseKind: 'JSON',
    csrfUsed: false,
    ...overrides,
  };
}

describe('Story content reference', () => {
  it('accepts one canonical explicit Story URL and strips tracking', () => {
    const ref = parseInstagramStoryRef(
      `${storyUrl}?igsh=secret&utm_source=share#fragment`,
    );
    expect(ref.kind).toBe('story');
    expect(ref.username).toBe(username);
    expect(ref.storyId).toBe(storyId);
    expect(ref.canonicalUrl).toBe(storyUrl);
  });
  it('accepts a username-level URL only when it carries an explicit item id', () => {
    const ref = parseInstagramStoryRef(
      `${profileStoryUrl}?story_media_id=${storyId}`,
    );
    expect(ref.storyId).toBe(storyId);
    expect(ref.canonicalUrl).toBe(storyUrl);
  });
  it.each([
    profileStoryUrl,
    `https://www.instagram.com/stories/${username}`,
    'https://www.instagram.com/stories/highlights/17900000000000000/',
    `https://www.instagram.com/stories/${username}/123/extra/`,
  ])('rejects profile-only, Highlight or malformed Story shape %s', (url) => {
    expect(() => parseInstagramStoryRef(url)).toThrow();
  });
  it.each([
    'https://example.com/stories/fictional_account/123/',
    'https://www.facebook.com/stories/fictional_account/123/',
    'not a url',
  ])('rejects non-Instagram Story input %s', (url) => {
    expect(() => parseInstagramStoryRef(url)).toThrow();
  });
  it('still recognizes a username-only URL for a clean fail-closed result', () => {
    expect(parseInstagramProfileStoryRef(profileStoryUrl)).toMatchObject({
      username,
      canonicalUrl: profileStoryUrl,
    });
  });
});

describe('Story routing', () => {
  it('selects the explicit id even when other candidates are present', () => {
    const route = routeStoryUrls([
      profileStoryUrl,
      'https://www.instagram.com/p/Abc_12/',
      storyUrl,
    ]);
    expect(route.status).toBe('explicit');
    if (route.status === 'explicit') expect(route.ref.storyId).toBe(storyId);
  });

  it('fails closed on a username-only URL without inventing an id', () => {
    const route = routeStoryUrls([profileStoryUrl]);
    expect(route.status).toBe('unsupported');
    if (route.status === 'unsupported') {
      expect(route.reason).toBe('username-only');
      expect(route.result).toMatchObject({
        status: 'UNSUPPORTED_CONTENT',
        acquisitionContext: 'background',
        identityResult: 'unproven',
      });
      expect(route.result.storySource).toBeUndefined();
    }
  });

  it('does not infer an id from a neighboring Story or post candidate', () => {
    // A username-only Story next to unrelated content must still fail closed.
    expect(
      routeStoryUrls([profileStoryUrl, 'https://www.instagram.com/p/Abc_12/']),
    ).toMatchObject({ status: 'unsupported', reason: 'username-only' });
    expect(
      routeStoryUrls([`https://www.instagram.com/p/Abc_12/`]),
    ).toMatchObject({ status: 'unsupported', reason: 'none' });
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
    expect(url.pathname).toBe(`/api/v1/media/${storyId}/info/`);
    expect(url.search).toBe('');
    expect(request.endpoint).not.toContain('workers.dev');
    expect(request.endpoint).not.toContain('/api/resolve');
  });
  it('does not introduce Story profile enumeration', () => {
    const request = buildInstagramStoryRequest(
      parseInstagramStoryRef(storyUrl),
    );
    const text = JSON.stringify(request);
    for (const token of ['reels_media', 'reel_ids', 'highlights', 'graphql'])
      expect(text).not.toContain(token);
  });
});

describe('explicit-id Story success path', () => {
  it('normalizes one image Story and one video Story without enumerating', () => {
    const image = resolveStoryOutcome(
      outcome({ jsonText: JSON.stringify(storyImage) }),
      'background',
      storyUrl,
      { username },
    );
    expect(image.result).toMatchObject({
      status: 'SUCCESS',
      itemCount: 1,
      assetTypes: ['image'],
    });
    expect(image.asset?.type).toBe('image');

    const video = resolveStoryOutcome(
      outcome({ jsonText: JSON.stringify(storyVideo) }),
      'background',
      storyUrl,
      { username },
    );
    expect(video.result).toMatchObject({
      status: 'SUCCESS',
      itemCount: 1,
      assetTypes: ['video'],
    });
    expect(video.asset?.type).toBe('video');
    expect(video.asset?.suggestedFilename).toMatch(/fictional_account/);
  });

  it('treats every explicit id as authoritative only after owner validation', () => {
    expect(
      resolveStoryIdentity({
        storySource: 'explicit-id-url',
        responseOwnerMatch: true,
      }),
    ).toBe('proven');
    expect(
      resolveStoryIdentity({
        storySource: 'explicit-id-url',
        responseOwnerMatch: 'unknown',
      }),
    ).toBe('proven');
  });
});

describe('Story identity integrity', () => {
  it('rejects a response whose publisher differs from the route publisher', () => {
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
      storyUrl,
    );
    const responseOwnerMatch = matchOwner(username, resolved.ownerUsername);
    expect(responseOwnerMatch).toBe(false);
    expect(
      resolveStoryIdentity({
        storySource: 'explicit-id-url',
        responseOwnerMatch,
      }),
    ).toBe('mismatch');
    // The sanitized result never carries the response owner.
    expect(JSON.stringify(resolved.result)).not.toContain('other_account');
  });

  it('accepts a matching publisher and ignores an original creator field', () => {
    const fixture = {
      items: [
        {
          media_type: 2,
          video_versions: [{ url: 'https://media.invalid/v.mp4' }],
          user: { username },
          original_creator: { username: 'original_creator' },
        },
      ],
    };
    const resolved = resolveStoryOutcome(
      outcome({ jsonText: JSON.stringify(fixture) }),
      'background',
      storyUrl,
    );
    expect(resolved.ownerUsername).toBe(username);
    expect(matchOwner(username, resolved.ownerUsername)).toBe(true);
  });

  it('never proves a Story without a supported source', () => {
    expect(resolveStoryIdentity({})).toBe('unproven');
    expect(resolveStoryIdentity({ responseOwnerMatch: 'unknown' })).toBe(
      'unproven',
    );
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
    expect(classifyStoryOutcome(raw, 'background', storyUrl).status).toBe(
      expected,
    );
  });
});

describe('Story network boundary', () => {
  it('sends no Cookie header while relying on the browser session', async () => {
    const fetchImpl = vi.fn<FetchLike>(
      async () =>
        ({
          status: 200,
          redirected: false,
          headers: {
            get: (name: string) =>
              name.toLowerCase() === 'content-type' ? 'application/json' : null,
          },
          text: async () => JSON.stringify(storyImage),
        }) as unknown as Response,
    );
    const result = await runBackgroundFetch(
      buildInstagramStoryRequest(parseInstagramStoryRef(storyUrl)),
      undefined,
      fetchImpl,
    );
    expect(result.httpStatus).toBe(200);
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    const names = Object.keys(
      (init.headers ?? {}) as Record<string, string>,
    ).map((name) => name.toLowerCase());
    expect(names).not.toContain('cookie');
    expect(names).not.toContain('authorization');
    expect(init.credentials).toBe('include');
    expect(init.cache).toBe('no-store');
  });
});

describe('Story result sanitization', () => {
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
  it('drops the asset when a response carries more than one item', () => {
    const fixture = {
      items: [
        {
          media_type: 1,
          image_versions2: {
            candidates: [
              { url: 'https://media.invalid/a.jpg', width: 10, height: 10 },
            ],
          },
        },
        {
          media_type: 1,
          image_versions2: {
            candidates: [
              { url: 'https://media.invalid/b.jpg', width: 10, height: 10 },
            ],
          },
        },
      ],
    };
    const resolved = resolveStoryOutcome(
      outcome({ jsonText: JSON.stringify(fixture) }),
      'background',
      storyUrl,
    );
    expect(resolved.result.itemCount).toBe(2);
    expect(resolved.asset).toBeUndefined();
  });
  it('keeps story asset metadata free of internal ids', () => {
    const resolved = normalizeInstagramStory(
      parseInstagramStoryResponse(storyVideo),
      storyUrl,
    );
    const text = JSON.stringify(resolved.post.assets);
    expect(text).not.toContain(storyId);
    expect(text).not.toContain(username);
  });
});

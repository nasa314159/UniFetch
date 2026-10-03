import { describe, expect, it, vi } from 'vitest';
import { UniFetchError, type ResolveResult } from '@unifetch/core';
import {
  normalizeInstagramMedia,
  parseInstagramMediaResponse,
  type InstagramResolvedMedia,
} from '@unifetch/meta-resolver/instagram';
import image from './__fixtures__/single-image-response.json';
import carousel from './__fixtures__/carousel-response.json';
import reel from './__fixtures__/reel-response.json';

const shortcode = 'unifetch-parser-demo';
const canonicalUrl = `https://www.instagram.com/p/${shortcode}/`;
const root = (fixture: typeof image | typeof carousel | typeof reel) =>
  fixture.data.xdt_api__v1__media__shortcode__web_info.items[0];
function response(item: Record<string, unknown>): unknown {
  return {
    data: { xdt_api__v1__media__shortcode__web_info: { items: [item] } },
  };
}
function normalize(raw: unknown): ResolveResult {
  return normalizeInstagramMedia(
    parseInstagramMediaResponse(raw, shortcode),
    canonicalUrl,
  );
}
function errorCode(
  raw: unknown,
  code: 'PARSER_OUTDATED' | 'CONTENT_UNAVAILABLE',
) {
  expect(() => parseInstagramMediaResponse(raw, shortcode)).toThrow(
    UniFetchError,
  );
  expect(() => parseInstagramMediaResponse(raw, shortcode)).toThrow(
    expect.objectContaining({ code }),
  );
}

describe('Offline Instagram structured-response parser', () => {
  it('parses a single image and preserves all candidates in source order', () => {
    const media = parseInstagramMediaResponse(image, shortcode);
    expect(media.kind).toBe('image');
    expect(media.items).toHaveLength(1);
    expect(media.items[0]).toMatchObject({
      id: 'fictional-image-root',
      type: 'image',
    });
    expect(media.items[0].imageCandidates?.map((item) => item.width)).toEqual([
      640, 1600, 320,
    ]);
    expect(media.owner).toEqual({
      username: 'unifetch_schema_demo',
      displayName: 'Fictional Schema Studio',
    });
    expect(media.caption).toBe(root(image).caption.text);
    expect(media.takenAt).toBe('2026-01-01T00:00:00.000Z');
  });
  it('parses a mixed carousel and preserves child IDs and type order', () => {
    const media = parseInstagramMediaResponse(carousel, shortcode);
    expect(media.kind).toBe('carousel');
    expect(media.items.map((item) => item.type)).toEqual([
      'image',
      'image',
      'video',
      'image',
    ]);
    expect(media.items.map((item) => item.id)).toEqual([
      'fictional-child-1',
      'fictional-child-2',
      'fictional-child-3',
      'fictional-child-4',
    ]);
    expect(media.items[2].videoCandidates).toHaveLength(3);
    expect(
      media.items.every((item) => item.imageCandidates?.length === 3),
    ).toBe(true);
  });
  it('parses a Reel with all video and thumbnail candidates', () => {
    const media = parseInstagramMediaResponse(reel, shortcode);
    expect(media.kind).toBe('video');
    expect(media.items[0].videoCandidates?.map((item) => item.width)).toEqual([
      720, 360, 1080,
    ]);
    expect(media.items[0].imageCandidates).toHaveLength(3);
    expect(media.items[0].thumbnailUrl).toBe(
      'https://media.invalid/unifetch/reel-thumbnail-high.jpg',
    );
  });
  it.each(['user', 'caption', 'taken_at'])(
    'does not require optional %s',
    (field) => {
      const item: Record<string, unknown> = structuredClone(root(image));
      delete item[field];
      expect(
        parseInstagramMediaResponse(response(item), shortcode).items,
      ).toHaveLength(1);
    },
  );
  it('ignores malformed optional metadata', () => {
    const media = parseInstagramMediaResponse(
      response({
        ...root(image),
        user: { username: 12, full_name: [] },
        caption: [],
        taken_at: {},
      }),
      shortcode,
    );
    expect(media.owner).toBeUndefined();
    expect(media.caption).toBeUndefined();
    expect(media.takenAt).toBeUndefined();
  });
  it('ignores unrelated fields at every level', () => {
    const altered = {
      ...image,
      extra: { irrelevant: true },
      data: {
        ...image.data,
        extra: ['ignored'],
        xdt_api__v1__media__shortcode__web_info: {
          items: [{ ...root(image), unused: { arbitrary: true } }],
          extra: 42,
        },
      },
    };
    expect(parseInstagramMediaResponse(altered, shortcode)).toEqual(
      parseInstagramMediaResponse(image, shortcode),
    );
  });
  it.each([
    null,
    undefined,
    42,
    'not JSON',
    [],
    {},
    { data: {} },
    { data: { xdt_api__v1__media__shortcode__web_info: { items: null } } },
    response(null as unknown as Record<string, unknown>),
  ])('reports malformed/missing root as PARSER_OUTDATED: %j', (raw) =>
    errorCode(raw, 'PARSER_OUTDATED'),
  );
  it('reports explicit empty items as CONTENT_UNAVAILABLE', () =>
    errorCode(
      { data: { xdt_api__v1__media__shortcode__web_info: { items: [] } } },
      'CONTENT_UNAVAILABLE',
    ));
  it('does not include raw payloads in parser error messages', () => {
    expect(() =>
      parseInstagramMediaResponse({ secret: 'DO-NOT-DISPLAY' }, shortcode),
    ).toThrow('recognized media structure');
    try {
      parseInstagramMediaResponse({ secret: 'DO-NOT-DISPLAY' }, shortcode);
    } catch (error) {
      expect((error as UniFetchError).message).not.toContain('DO-NOT-DISPLAY');
    }
  });
  it('filters malformed/unsafe candidates without losing valid source order', () => {
    const media = parseInstagramMediaResponse(
      response({
        ...root(image),
        image_versions2: {
          candidates: [
            null,
            {},
            'bad',
            { url: 'javascript:alert(1)' },
            { url: 'data:image/png,a' },
            { url: 'https://user:pass@media.invalid/a' },
            { url: '/relative.jpg' },
            {
              url: 'https://media.invalid/first.jpg',
              width: -10,
              height: 'wrong',
            },
            {
              url: 'https://media.invalid/second.jpg',
              width: Infinity,
              height: 500,
            },
          ],
        },
      }),
      shortcode,
    );
    expect(media.items[0].imageCandidates).toEqual([
      {
        url: 'https://media.invalid/first.jpg',
        width: undefined,
        height: undefined,
      },
      {
        url: 'https://media.invalid/second.jpg',
        width: undefined,
        height: 500,
      },
    ]);
  });
  it.each([null, {}, [null, { url: 42 }], [{ url: 'file:///a' }]])(
    'reports malformed required candidates as PARSER_OUTDATED: %j',
    (candidates) =>
      errorCode(
        response({ ...root(image), image_versions2: { candidates } }),
        'PARSER_OUTDATED',
      ),
  );
  it.each([1, 2])(
    'reports explicitly empty media candidates as unavailable for type %s',
    (type) =>
      errorCode(
        response({
          media_type: type,
          image_versions2: { candidates: [] },
          video_versions: [],
        }),
        'CONTENT_UNAVAILABLE',
      ),
  );
  it('reports unknown media_type without usable structures as PARSER_OUTDATED', () =>
    errorCode(response({ media_type: 999 }), 'PARSER_OUTDATED'));
  it.each([1, 2, 999])(
    'carousel_media wins over misleading media_type %s',
    (type) => {
      expect(
        parseInstagramMediaResponse(
          response({
            ...root(carousel),
            media_type: type,
            product_type: 'clips',
          }),
          shortcode,
        ).kind,
      ).toBe('carousel');
    },
  );
  it('carousel product_type wins without media_type', () => {
    const item: Record<string, unknown> = { ...root(carousel) };
    delete item.media_type;
    expect(parseInstagramMediaResponse(response(item), shortcode).kind).toBe(
      'carousel',
    );
  });
  it('carousel presence alone determines kind without metadata', () => {
    expect(
      parseInstagramMediaResponse(
        response({ carousel_media: root(carousel).carousel_media }),
        shortcode,
      ).kind,
    ).toBe('carousel');
  });
  it('does not silently skip malformed carousel children', () =>
    errorCode(
      response({
        ...root(carousel),
        carousel_media: [root(carousel).carousel_media[0], null],
      }),
      'PARSER_OUTDATED',
    ));
  it('does not flatten nested carousel structures', () =>
    errorCode(
      response({
        ...root(carousel),
        carousel_media: [
          { media_type: 8, carousel_media: root(carousel).carousel_media },
        ],
      }),
      'PARSER_OUTDATED',
    ));
  it('empty carousel is unavailable', () =>
    errorCode(
      response({ ...root(carousel), carousel_media: [] }),
      'CONTENT_UNAVAILABLE',
    ));
  it.each([undefined, null, {}])(
    'malformed carousel collection is PARSER_OUTDATED: %j',
    (children) =>
      errorCode(
        response({ ...root(carousel), carousel_media: children }),
        'PARSER_OUTDATED',
      ),
  );
  it.each([
    ['image', root(image)],
    ['video', root(reel)],
  ] as const)(
    'infers %s from usable candidates when type metadata is absent',
    (kind, item) => {
      const raw: Record<string, unknown> = { ...item };
      delete raw.media_type;
      expect(parseInstagramMediaResponse(response(raw), shortcode).kind).toBe(
        kind,
      );
    },
  );
  it('uses expected shortcode despite conflicting response code', () =>
    expect(parseInstagramMediaResponse(image, shortcode).shortcode).toBe(
      shortcode,
    ));
  it('uses expected shortcode when response code is absent', () => {
    const item: Record<string, unknown> = { ...root(image) };
    delete item.code;
    expect(
      parseInstagramMediaResponse(response(item), shortcode).shortcode,
    ).toBe(shortcode);
  });
  it.each(['', '../bad', 'a/b'])(
    'rejects unsafe filename shortcodes %j',
    (value) =>
      expect(() => parseInstagramMediaResponse(image, value)).toThrow(
        expect.objectContaining({ code: 'PARSER_OUTDATED' }),
      ),
  );
  it.each([NaN, Infinity, 1e30, 'invalid date', null, {}])(
    'ignores unsafe timestamp %j',
    (taken_at) =>
      expect(
        parseInstagramMediaResponse(
          response({ ...root(image), taken_at }),
          shortcode,
        ).takenAt,
      ).toBeUndefined(),
  );
  it.each(['1767225600', '2026-01-01T00:00:00Z'])(
    'handles string timestamp %s',
    (taken_at) =>
      expect(
        parseInstagramMediaResponse(
          response({ ...root(image), taken_at }),
          shortcode,
        ).takenAt,
      ).toBe('2026-01-01T00:00:00.000Z'),
  );
  it('does not mutate input JSON', () => {
    const before = structuredClone(carousel);
    parseInstagramMediaResponse(carousel, shortcode);
    expect(carousel).toEqual(before);
  });
});

describe('Offline Instagram normalization into core ResolveResult', () => {
  it('selects the largest image pixel area rather than first candidate', () => {
    expect(normalize(image).post.assets[0]).toMatchObject({
      type: 'image',
      url: 'https://media.invalid/unifetch/image-high.jpg',
      width: 1600,
      height: 1200,
      suggestedFilename: `instagram_${shortcode}.jpg`,
    });
  });
  it('selects largest Reel video and thumbnail independently', () => {
    const result = normalize(reel);
    expect(result.post.assets[0]).toMatchObject({
      type: 'video',
      url: 'https://media.invalid/unifetch/reel-high.mp4',
      width: 1080,
      height: 1920,
      thumbnailUrl: 'https://media.invalid/unifetch/reel-thumbnail-high.jpg',
      suggestedFilename: `instagram_${shortcode}.mp4`,
    });
  });
  it('preserves carousel order and selects each best media candidate', () => {
    const result = normalize(carousel);
    expect(result.post.assets.map((asset) => asset.type)).toEqual([
      'image',
      'image',
      'video',
      'image',
    ]);
    expect(result.post.assets.map((asset) => asset.url)).toEqual(
      [1, 2, 3, 4].map(
        (n) =>
          `https://media.invalid/unifetch/carousel-${n}-high.${n === 3 ? 'mp4' : 'jpg'}`,
      ),
    );
    expect(result.post.assets.map((asset) => asset.id)).toEqual(
      root(carousel).carousel_media.map((item) => item.id),
    );
  });
  it('uses pixel area rather than width alone', () => {
    expect(
      normalize(
        response({
          media_type: 1,
          image_versions2: {
            candidates: [
              {
                url: 'https://media.invalid/wider.jpg',
                width: 2000,
                height: 100,
              },
              {
                url: 'https://media.invalid/larger.jpg',
                width: 1000,
                height: 1000,
              },
            ],
          },
        }),
      ).post.assets[0].url,
    ).toBe('https://media.invalid/larger.jpg');
  });
  it('prefers complete dimensions over earlier dimensionless or partial candidates', () => {
    expect(
      normalize(
        response({
          media_type: 1,
          image_versions2: {
            candidates: [
              { url: 'https://media.invalid/no-size.jpg' },
              { url: 'https://media.invalid/partial.jpg', width: 5000 },
              { url: 'https://media.invalid/sized.jpg', width: 10, height: 10 },
            ],
          },
        }),
      ).post.assets[0].url,
    ).toBe('https://media.invalid/sized.jpg');
  });
  it('uses the first valid candidate when all dimensions are missing', () => {
    expect(
      normalize(
        response({
          media_type: 2,
          video_versions: [
            { url: 'javascript:alert(1)' },
            { url: 'https://media.invalid/first.mp4' },
            { url: 'https://media.invalid/second.mp4' },
          ],
        }),
      ).post.assets[0].url,
    ).toBe('https://media.invalid/first.mp4');
  });
  it('retains first candidate for tied pixel areas', () => {
    expect(
      normalize(
        response({
          media_type: 1,
          image_versions2: {
            candidates: [
              {
                url: 'https://media.invalid/first.jpg',
                width: 400,
                height: 200,
              },
              {
                url: 'https://media.invalid/second.jpg',
                width: 200,
                height: 400,
              },
            ],
          },
        }),
      ).post.assets[0].url,
    ).toBe('https://media.invalid/first.jpg');
  });
  it('generates deterministic indexed filenames', () => {
    const first = normalize(carousel);
    expect(first).toEqual(normalize(carousel));
    expect(first.post.assets.map((asset) => asset.suggestedFilename)).toEqual([
      `instagram_${shortcode}_01.jpg`,
      `instagram_${shortcode}_02.jpg`,
      `instagram_${shortcode}_03.mp4`,
      `instagram_${shortcode}_04.jpg`,
    ]);
  });
  it('keeps carousel numbering for one-child carousel', () =>
    expect(
      normalize(
        response({
          ...root(carousel),
          carousel_media: [root(carousel).carousel_media[0]],
        }),
      ).post.assets[0].suggestedFilename,
    ).toBe(`instagram_${shortcode}_01.jpg`));
  it.each([image, carousel, reel])(
    'never produces audio and maps existing core types',
    (raw) => {
      const result: ResolveResult = normalize(raw);
      expect(result.post.platform).toBe('instagram');
      expect(result.post.canonicalUrl).toBe(canonicalUrl);
      expect(result.post.id).toBe(shortcode);
      expect(
        result.post.assets.every((asset) =>
          ['image', 'video'].includes(asset.type),
        ),
      ).toBe(true);
      expect(result.post.author).toEqual({
        username: 'unifetch_schema_demo',
        displayName: 'Fictional Schema Studio',
      });
      expect(result.post.publishedAt).toBe('2026-01-01T00:00:00.000Z');
      expect(result.trace).toEqual({
        processedLocally: true,
        remoteProxyUsed: false,
        credentialsExported: false,
        network: [],
      });
    },
  );
  it('supplied /reel/ canonical URL does not override carousel structure', () => {
    const result = normalizeInstagramMedia(
      parseInstagramMediaResponse(carousel, shortcode),
      `https://www.instagram.com/reel/${shortcode}/`,
    );
    expect(result.post.assets.map((asset) => asset.type)).toEqual([
      'image',
      'image',
      'video',
      'image',
    ]);
    expect(result.post.canonicalUrl).toContain('/reel/');
  });
  it('keeps videos without thumbnail candidates usable', () => {
    const item: Record<string, unknown> = { ...root(reel) };
    delete item.image_versions2;
    expect(
      normalize(response(item)).post.assets[0].thumbnailUrl,
    ).toBeUndefined();
  });
  it('maps missing optional metadata without manufacturing it', () => {
    const result = normalize(
      response({ media_type: 1, image_versions2: root(image).image_versions2 }),
    );
    expect(result.post.author).toBeUndefined();
    expect(result.post.caption).toBeUndefined();
    expect(result.post.publishedAt).toBeUndefined();
    expect(result.post.assets[0].id).toBe(`${shortcode}_01`);
  });
  it('does not mutate the intermediate model', () => {
    const media = parseInstagramMediaResponse(carousel, shortcode);
    const before = structuredClone(media);
    normalizeInstagramMedia(media, canonicalUrl);
    expect(media).toEqual(before);
  });
  it('normalizer rejects unusable parsed media with typed unavailable error', () => {
    const media: InstagramResolvedMedia = {
      shortcode,
      kind: 'image',
      items: [{ type: 'image', imageCandidates: [] }],
    };
    expect(() => normalizeInstagramMedia(media, canonicalUrl)).toThrow(
      expect.objectContaining({ code: 'CONTENT_UNAVAILABLE' }),
    );
  });
  it('does not acquire media even if fetch is unavailable', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Offline parsing must never request the network');
    });
    try {
      for (const fixture of [image, carousel, reel]) {
        expect(normalize(fixture).trace.network).toEqual([]);
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
});

import { describe, expect, it } from 'vitest';
import { parseInstagramMediaResponse } from './parser';
import { mediaUrl } from './validation';
import image from './__fixtures__/single-image-response.json';
import carousel from './__fixtures__/carousel-response.json';
import reel from './__fixtures__/reel-response.json';
import nullable from './__fixtures__/nullable-image-response.json';
function root(raw: typeof nullable) {
  return raw.data.xdt_api__v1__media__shortcode__web_info.items[0];
}
describe('Nullable carousel field compatibility', () => {
  it.each([
    ['image', image, 'image', 1],
    ['carousel', carousel, 'carousel', 4],
    ['Reel', reel, 'video', 1],
  ] as const)('retains original %s fixture parsing', (_, raw, kind, count) => {
    const parsed = parseInstagramMediaResponse(raw, 'synthetic-regression');
    expect(parsed.kind).toBe(kind);
    expect(parsed.items).toHaveLength(count);
  });
  it('parses the sanitized image shape with null carousel and video fields', () => {
    const parsed = parseInstagramMediaResponse(
      nullable,
      'synthetic-nullable-image',
    );
    expect(parsed.kind).toBe('image');
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].imageCandidates?.[0]).toMatchObject({
      width: 1600,
      height: 1200,
    });
  });
  it('treats nullable carousel field exactly like an absent optional field', () => {
    const absent: Record<string, unknown> = structuredClone(root(nullable));
    delete absent.carousel_media;
    const raw = {
      data: { xdt_api__v1__media__shortcode__web_info: { items: [absent] } },
    };
    expect(
      parseInstagramMediaResponse(nullable, 'synthetic-nullable-image'),
    ).toEqual(parseInstagramMediaResponse(raw, 'synthetic-nullable-image'));
  });
  it('continues requiring an array for explicitly declared carousel media', () => {
    const raw = structuredClone(nullable);
    root(raw).media_type = 8;
    expect(() =>
      parseInstagramMediaResponse(raw, 'synthetic-regression'),
    ).toThrowError(expect.objectContaining({ code: 'PARSER_OUTDATED' }));
  });
  it('ignores unrelated unknown fields and missing/null optional metadata', () => {
    const item = {
      ...root(nullable),
      user: null,
      caption: null,
      taken_at: null,
      irrelevant: { ignored: true },
    };
    const parsed = parseInstagramMediaResponse(
      { data: { xdt_api__v1__media__shortcode__web_info: { items: [item] } } },
      'synthetic-regression',
    );
    expect(parsed.kind).toBe('image');
    expect(parsed.owner).toBeUndefined();
    expect(parsed.caption).toBeUndefined();
  });
  it.each([
    'javascript:alert(1)',
    'https://user:secret@media.invalid/image.jpg',
    'invalid url',
  ])('retains strict candidate URL validation', (url) => {
    const raw = structuredClone(nullable);
    root(raw).image_versions2.candidates[0].url = url;
    expect(() =>
      parseInstagramMediaResponse(raw, 'synthetic-regression'),
    ).toThrowError(expect.objectContaining({ code: 'PARSER_OUTDATED' }));
  });
  it('accepts absolute HTTPS CDN URLs with signed/escaped parameters without changing page input validation', () => {
    const url = `https://fictional-cdn.invalid/media/image.jpg?signature=${'fictional%2F%2B'.repeat(100)}&other=preserved`;
    expect(mediaUrl(url)).toBe(url);
  });
  it('still rejects missing required media structure', () => {
    const item = { ...root(nullable), image_versions2: undefined };
    expect(() =>
      parseInstagramMediaResponse(
        {
          data: { xdt_api__v1__media__shortcode__web_info: { items: [item] } },
        },
        'synthetic-regression',
      ),
    ).toThrowError(expect.objectContaining({ code: 'PARSER_OUTDATED' }));
  });
  it('does not parse GraphQL errors as media', () => {
    expect(() =>
      parseInstagramMediaResponse(
        { data: null, errors: [{ message: 'Synthetic execution error' }] },
        'synthetic-regression',
      ),
    ).toThrowError(expect.objectContaining({ code: 'PARSER_OUTDATED' }));
  });
});

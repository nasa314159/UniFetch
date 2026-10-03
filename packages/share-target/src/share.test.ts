import { describe, expect, it } from 'vitest';
import { parseSharedPayload } from './index';
const image = 'https://www.instagram.com/p/unifetch-demo-image/';
const reel = 'https://www.instagram.com/reel/unifetch-demo-reel/';
describe('Share payload parsing', () => {
  it('uses the URL field', () =>
    expect(parseSharedPayload({ url: image })).toBe(image));
  it('extracts a URL from text', () =>
    expect(parseSharedPayload({ text: `See this ${image} today` })).toBe(
      image,
    ));
  it('extracts a URL from title', () =>
    expect(parseSharedPayload({ title: `My link (${image}).` })).toBe(image));
  it('uses URL then text then title', () => {
    expect(parseSharedPayload({ url: image, text: reel, title: reel })).toBe(
      image,
    );
    expect(
      parseSharedPayload({ url: 'invalid', text: reel, title: image }),
    ).toBe(reel);
  });
  it('uses first supported embedded URL', () =>
    expect(
      parseSharedPayload({ text: `https://example.com ${image} ${reel}` }),
    ).toBe(image));
  it('recognizes planned platforms', () =>
    expect(parseSharedPayload({ url: 'https://facebook.com/post' })).toBe(
      'https://www.facebook.com/post',
    ));
  it('rejects unsupported URLs', () =>
    expect(
      parseSharedPayload({ url: 'https://example.com', text: 'hello' }),
    ).toBeNull());
  it.each([
    'javascript:alert(1)',
    'data:text/html,https://instagram.com/p/a',
    'file:///tmp/a',
    'javascript:https://instagram.com/p/a',
  ])('rejects malicious scheme %s', (url) => {
    expect(parseSharedPayload({ url })).toBeNull();
    expect(parseSharedPayload({ text: url })).toBeNull();
  });
  it('returns null for empty input', () =>
    expect(parseSharedPayload({})).toBeNull());
  it('normalizes tracking without discarding functional params', () =>
    expect(
      parseSharedPayload({ url: `${image}?igsh=secret&img_index=2#fragment` }),
    ).toBe(`${image}?img_index=2`));
});

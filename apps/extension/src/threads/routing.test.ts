import { describe, expect, it } from 'vitest';
import { parseManualInstagramUrl, parseManualUrl } from '../popup-support';
import {
  firstExtensionTarget,
  parseExtensionTarget,
  parseInstagramTarget,
  parseThreadsTarget,
} from '../target';

const canonical =
  'https://www.threads.com/@unifetch_threads_demo/post/synthetic-threads-image/';

describe('extension platform routing', () => {
  it('routes an Instagram post to the unchanged Instagram parser', () => {
    const target = parseExtensionTarget('https://www.instagram.com/p/Abc_12/');
    expect(target).toMatchObject({
      platform: 'instagram',
      kind: 'post',
      canonicalUrl: 'https://www.instagram.com/p/Abc_12/',
    });
    expect(
      parseInstagramTarget('https://www.instagram.com/p/Abc_12/')?.kind,
    ).toBe('post');
    expect(
      parseManualInstagramUrl('https://www.instagram.com/p/Abc_12/'),
    ).toEqual({
      kind: 'post',
      canonicalUrl: 'https://www.instagram.com/p/Abc_12/',
    });
  });

  it.each([
    'https://threads.net/@User.Name/post/synthetic-code/',
    'https://threads.com/@User.Name/post/synthetic-code?igsh=test',
    'https://www.threads.net/@User.Name/post/synthetic-code/decorative-slug',
    'https://www.threads.com/@User.Name/post/synthetic-code/media',
  ])('routes and canonicalizes a Threads permalink %s', (input) => {
    expect(parseThreadsTarget(input)).toMatchObject({
      platform: 'threads',
      kind: 'post',
      canonicalUrl: 'https://www.threads.com/@user.name/post/synthetic-code/',
    });
    expect(parseManualUrl(input)).toMatchObject({
      platform: 'threads',
      kind: 'post',
    });
  });

  it('routes an official Threads share link without expanding it locally', () => {
    expect(
      parseThreadsTarget(
        'https://www.threads.com/share/synthetic-share-token/',
      ),
    ).toMatchObject({
      platform: 'threads',
      kind: 'share',
      canonicalUrl: 'https://www.threads.com/share/synthetic-share-token/',
    });
    expect(
      parseManualUrl(
        'https://threads.net/share/synthetic-share-token?xmt=ignored',
      ),
    ).toMatchObject({
      platform: 'threads',
      kind: 'share',
      canonicalUrl: 'https://www.threads.com/share/synthetic-share-token/',
    });
  });

  it.each([
    'https://www.threads.com/@user',
    'https://www.threads.com/@user/media',
    'https://www.threads.com/search',
    'https://www.threads.com/t/synthetic-code',
    'https://www.threads.com/share/',
    'https://www.threads.com/share/../escape/',
    'https://threads.com.evil.invalid/@user/post/code/',
    'https://evil-threads.com/@user/post/code/',
    'https://www.threads.com.evil.invalid/share/synthetic-share-token/',
  ])('does not route an unsupported or lookalike Threads URL %s', (input) => {
    expect(parseThreadsTarget(input)).toBeUndefined();
    expect(parseExtensionTarget(input)).toBeUndefined();
    expect(parseManualUrl(input)).toBeUndefined();
  });

  it('preserves candidate order across platforms', () => {
    expect(
      firstExtensionTarget([
        'not a url',
        'https://www.threads.com/@user/post/synthetic-code/',
        'https://www.instagram.com/p/Abc_12/',
      ]),
    ).toMatchObject({ platform: 'threads', kind: 'post' });
    expect(
      firstExtensionTarget(['https://www.instagram.com/p/Abc_12/', canonical]),
    ).toMatchObject({ platform: 'instagram', kind: 'post' });
  });
});

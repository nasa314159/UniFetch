import { describe, expect, it } from 'vitest';
import {
  createCaptionFilename,
  createDownloadFilename,
  finalizeDownloadFilename,
} from './filename';
const base = {
  platform: 'instagram' as const,
  username: 'demo_studio',
  caption: 'A quiet morning',
  assetIndex: 0,
  assetCount: 1,
  mediaType: 'image' as const,
  mimeType: 'image/jpeg',
};
describe('Human-readable download filenames', () => {
  it('combines username, caption, index and final extension', () => {
    expect(createDownloadFilename(base)).toBe(
      'demo_studio_A-quiet-morning_01.jpg',
    );
  });
  it('preserves original carousel sequence numbers', () => {
    expect(
      [0, 1, 2].map((assetIndex) =>
        createDownloadFilename({ ...base, assetCount: 3, assetIndex }),
      ),
    ).toEqual([
      'demo_studio_A-quiet-morning_01.jpg',
      'demo_studio_A-quiet-morning_02.jpg',
      'demo_studio_A-quiet-morning_03.jpg',
    ]);
  });
  it('uses a post caption fallback', () =>
    expect(createDownloadFilename({ ...base, caption: undefined })).toBe(
      'demo_studio_post_01.jpg',
    ));
  it('uses a reel caption fallback when provided', () =>
    expect(
      createDownloadFilename({ ...base, caption: '', contentKind: 'reel' }),
    ).toBe('demo_studio_reel_01.jpg'));
  it('uses the platform when username is absent', () =>
    expect(createDownloadFilename({ ...base, username: undefined })).toBe(
      'instagram_A-quiet-morning_01.jpg',
    ));
  it.each(['虛構的山間風景', '架空の静かな朝', '가상의조용한아침'])(
    'preserves Unicode caption %s',
    (caption) =>
      expect(createDownloadFilename({ ...base, caption })).toBe(
        `demo_studio_${caption}_01.jpg`,
      ),
  );
  it('normalizes line breaks, tabs and repeated whitespace', () =>
    expect(
      createDownloadFilename({ ...base, caption: ' A\n\t quiet   morning ' }),
    ).toBe('demo_studio_A-quiet-morning_01.jpg'));
  it('removes filesystem-problematic characters and controls', () =>
    expect(
      createDownloadFilename({
        ...base,
        username: ' ../studio\\:*?"<>|\0 ',
        caption: '. /sun\\rise:\t. ',
      }),
    ).toBe('studio_sunrise_01.jpg'));
  it('falls back for empty sanitized components', () =>
    expect(
      createDownloadFilename({ ...base, username: '/\0', caption: ' ..:*? ' }),
    ).toBe('instagram_post_01.jpg'));
  it('truncates to 30 Unicode code points without splitting surrogate pairs', () =>
    expect(createDownloadFilename({ ...base, caption: '🌿'.repeat(35) })).toBe(
      `demo_studio_${'🌿'.repeat(30)}_01.jpg`,
    ));
  it.each(['photo.jpg.webp', 'photo.jpeg.webp', 'photo.png.webp'])(
    'replaces stacked source suffixes in %s',
    (filename) =>
      expect(finalizeDownloadFilename(filename, 'image/jpeg')).toBe(
        'photo.jpg',
      ),
  );
  it('uses the actual final video MIME', () =>
    expect(
      createDownloadFilename({
        ...base,
        assetIndex: 2,
        assetCount: 4,
        mediaType: 'video',
        mimeType: 'video/mp4',
      }),
    ).toBe('demo_studio_A-quiet-morning_03.mp4'));
  it('uses actual WebP MIME on conversion fallback', () =>
    expect(finalizeDownloadFilename('studio_post_01.jpg', 'image/webp')).toBe(
      'studio_post_01.webp',
    ));
  it('uses a neutral extension for unknown MIME, never a guessed jpg', () =>
    expect(finalizeDownloadFilename('studio_post_01.jpg', '')).toBe(
      'studio_post_01.bin',
    ));
});

describe('Shared caption-first filename policy', () => {
  const base = {
    authorFallback: 'instagram',
    identityFallback: 'post',
    mediaType: 'image' as const,
  };

  it('uses author, caption snippet and final extension', () => {
    expect(
      createCaptionFilename({
        ...base,
        username: 'demo_user',
        caption: 'A quiet morning',
      }),
    ).toBe('demo_user_A-quiet-morning.jpg');
  });

  it('uses the identity fallback when the caption is empty', () => {
    expect(
      createCaptionFilename({
        ...base,
        username: 'demo_user',
        caption: '   ',
        identityFallback: 'synthetic-code',
      }),
    ).toBe('demo_user_synthetic-code.jpg');
  });

  it('treats emoji-only captions as unusable when required', () => {
    expect(
      createCaptionFilename({
        ...base,
        username: 'demo_user',
        caption: '🌿🌿🌿',
        identityFallback: 'synthetic-code',
        requireMeaningfulCaption: true,
      }),
    ).toBe('demo_user_synthetic-code.jpg');
  });

  it('preserves the existing Instagram emoji-only behavior by default', () => {
    expect(
      createCaptionFilename({
        ...base,
        username: 'demo_user',
        caption: '🌿🌿🌿',
        identityFallback: 'post',
      }),
    ).toBe('demo_user_🌿🌿🌿.jpg');
  });

  it('preserves Unicode letters and numbers', () => {
    expect(
      createCaptionFilename({
        ...base,
        username: '架空のユーザー',
        caption: '真剣なミケ',
        identityFallback: 'synthetic-code',
        requireMeaningfulCaption: true,
      }),
    ).toBe('架空のユーザー_真剣なミケ.jpg');
  });

  it('sanitizes unsafe characters and line breaks', () => {
    const output = createCaptionFilename({
      ...base,
      username: ' ../bad\\user ',
      caption: 'a/b\\c:d*e?f"g<h>i|j\n\tk',
      identityFallback: 'synthetic-code',
    });
    expect(output.endsWith('.jpg')).toBe(true);
    for (const token of [
      ' ',
      '/',
      '\\',
      ':',
      '*',
      '?',
      '"',
      '<',
      '>',
      '|',
      '\n',
      '\t',
    ])
      expect(output).not.toContain(token);
  });

  it('bounds the caption snippet to 30 code points', () => {
    expect(
      createCaptionFilename({
        ...base,
        username: 'user',
        caption: 'a'.repeat(100),
        identityFallback: 'synthetic-code',
      }),
    ).toBe(`user_${'a'.repeat(30)}.jpg`);
  });

  it('adds two-digit carousel indices', () => {
    expect(
      createCaptionFilename({
        ...base,
        username: 'user',
        caption: 'caption',
        index: 1,
        identityFallback: 'synthetic-code',
      }),
    ).toBe('user_caption_01.jpg');
  });

  it('uses the GIF extension when requested', () => {
    expect(
      createCaptionFilename({
        ...base,
        username: 'user',
        caption: 'animated',
        mimeType: 'image/gif',
        identityFallback: 'synthetic-code',
      }),
    ).toBe('user_animated.gif');
  });

  it('uses the author fallback when the username is missing', () => {
    expect(
      createCaptionFilename({
        ...base,
        caption: 'caption',
        identityFallback: 'synthetic-code',
      }),
    ).toBe('instagram_caption.jpg');
  });
});

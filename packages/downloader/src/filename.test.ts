import { describe, expect, it } from 'vitest';
import { createDownloadFilename, finalizeDownloadFilename } from './filename';
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

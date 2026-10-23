import { describe, expect, it } from 'vitest';
import { createInstagramFilename } from './instagram-filename';

describe('shared Instagram filename policy', () => {
  it('single Post uses username + caption snippet', () => {
    expect(
      createInstagramFilename({
        username: 'mike_noritama',
        caption: '真剣なミケ',
        mediaType: 'image',
        contentKind: 'post',
      }),
    ).toBe('mike_noritama_真剣なミケ.jpg');
  });

  it('Carousel uses username + caption snippet + two-digit original index', () => {
    const base = {
      username: 'mike_noritama',
      caption: '真剣なミケ',
      contentKind: 'post' as const,
    };
    expect(
      createInstagramFilename({ ...base, mediaType: 'image', index: 1 }),
    ).toBe('mike_noritama_真剣なミケ_01.jpg');
    expect(
      createInstagramFilename({ ...base, mediaType: 'image', index: 12 }),
    ).toBe('mike_noritama_真剣なミケ_12.jpg');
    expect(
      createInstagramFilename({ ...base, mediaType: 'video', index: 3 }),
    ).toBe('mike_noritama_真剣なミケ_03.mp4');
  });

  it('Reel uses username + caption snippet and a video extension', () => {
    expect(
      createInstagramFilename({
        username: 'meimayzz',
        caption: 'Frieren accidentally sneezed',
        mediaType: 'video',
        contentKind: 'reel',
      }),
    ).toBe('meimayzz_Frieren-accidentally-sneezed.mp4');
  });

  it('empty Post caption falls back to username_post', () => {
    expect(
      createInstagramFilename({
        username: 'mike',
        caption: '',
        mediaType: 'image',
        contentKind: 'post',
      }),
    ).toBe('mike_post.jpg');
    expect(
      createInstagramFilename({
        username: 'mike',
        mediaType: 'image',
        contentKind: 'post',
      }),
    ).toBe('mike_post.jpg');
  });

  it('empty Reel caption falls back to username_reel', () => {
    expect(
      createInstagramFilename({
        username: 'mike',
        caption: '   ',
        mediaType: 'video',
        contentKind: 'reel',
      }),
    ).toBe('mike_reel.mp4');
  });

  it('missing author falls back to instagram', () => {
    expect(
      createInstagramFilename({
        caption: 'hello',
        mediaType: 'image',
        contentKind: 'post',
      }),
    ).toBe('instagram_hello.jpg');
    expect(
      createInstagramFilename({ mediaType: 'video', contentKind: 'reel' }),
    ).toBe('instagram_reel.mp4');
  });

  it('preserves Unicode in the username and caption', () => {
    expect(
      createInstagramFilename({
        username: '架空のユーザー',
        caption: '真剣なミケ',
        mediaType: 'image',
        contentKind: 'post',
      }),
    ).toBe('架空のユーザー_真剣なミケ.jpg');
  });

  it('sanitizes unsafe filename characters', () => {
    const output = createInstagramFilename({
      username: ' ../bad\\user ',
      caption: 'a/b\\c:d*e?f"g<h>i|j\n\tk',
      mediaType: 'image',
      contentKind: 'post',
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

  it('bounds the caption snippet length', () => {
    const output = createInstagramFilename({
      username: 'user',
      caption: 'a'.repeat(100),
      mediaType: 'image',
      contentKind: 'post',
    });
    expect(output).toBe(`user_${'a'.repeat(30)}.jpg`);
  });

  it('never includes an Instagram shortcode', () => {
    const output = createInstagramFilename({
      username: 'unifetch_schema_demo',
      caption: 'Fictional geometric postcard for offline parser tests.',
      mediaType: 'image',
      contentKind: 'post',
    });
    expect(output).toBe(
      'unifetch_schema_demo_Fictional-geometric-postcard-f.jpg',
    );
    expect(output).not.toContain('Abc_12');
    expect(output).not.toMatch(/instagram_Abc/);
  });

  it('uses the correct image/video MIME extension', () => {
    expect(
      createInstagramFilename({
        username: 'u',
        mediaType: 'image',
        contentKind: 'post',
      }),
    ).toMatch(/\.jpg$/);
    expect(
      createInstagramFilename({
        username: 'u',
        mediaType: 'video',
        contentKind: 'reel',
      }),
    ).toMatch(/\.mp4$/);
  });
});

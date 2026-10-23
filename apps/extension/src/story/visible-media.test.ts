import { describe, expect, it } from 'vitest';
import {
  chooseStorySource,
  classifyMseSource,
  classifyVisibleMedia,
  collectStoryViewerContextFunction,
  isActiveStoryMedia,
  isViableStoryMedia,
  selectVisibleStoryMedia,
  visibleStoryMediaToAsset,
  visibleStoryResult,
  type StoryMediaDescriptor,
} from './visible-media';

const viewport = { width: 400, height: 800 };

function descriptor(
  overrides: Partial<StoryMediaDescriptor> = {},
): StoryMediaDescriptor {
  return {
    kind: 'image',
    url: 'https://media.invalid/story/visible.jpg',
    width: 1080,
    height: 1920,
    rect: { top: 0, left: 0, right: 400, bottom: 800 },
    styleVisible: true,
    inViewer: true,
    ...overrides,
  };
}

describe('visible Story media selection', () => {
  it('selects only the currently visible video', () => {
    const selection = selectVisibleStoryMedia(
      [descriptor({ kind: 'video', url: 'https://media.invalid/v.mp4' })],
      viewport,
      true,
    );
    expect(selection).toEqual({
      ok: true,
      kind: 'video',
      url: 'https://media.invalid/v.mp4',
      width: 1080,
      height: 1920,
    });
  });

  it('selects only the currently visible image', () => {
    const selection = selectVisibleStoryMedia([descriptor()], viewport, true);
    expect(selection).toEqual({
      ok: true,
      kind: 'image',
      url: 'https://media.invalid/story/visible.jpg',
      width: 1080,
      height: 1920,
    });
  });

  it('prefers the visible video over its still cover image', () => {
    const selection = selectVisibleStoryMedia(
      [
        descriptor({ kind: 'video', url: 'https://media.invalid/v.mp4' }),
        descriptor({ kind: 'image', url: 'https://media.invalid/cover.jpg' }),
      ],
      viewport,
      true,
    );
    expect(selection.ok && selection.kind).toBe('video');
  });

  it('ignores hidden and sibling Story media', () => {
    expect(
      selectVisibleStoryMedia(
        [
          descriptor({ styleVisible: false }),
          descriptor({
            url: 'https://media.invalid/next.jpg',
            rect: { top: 0, left: 400, right: 800, bottom: 800 },
          }),
          descriptor({ inViewer: false }),
        ],
        viewport,
        true,
      ),
    ).toEqual({ ok: false, reason: 'no-visible-media' });
  });

  it('ignores unrelated Instagram images such as avatars and feed art', () => {
    expect(
      selectVisibleStoryMedia(
        [
          descriptor({
            url: 'https://media.invalid/avatar.jpg',
            width: 48,
            height: 48,
          }),
          descriptor({
            url: 'https://media.invalid/feed.jpg',
            rect: { top: 0, left: -600, right: -100, bottom: 800 },
          }),
        ],
        viewport,
        true,
      ),
    ).toEqual({ ok: false, reason: 'no-visible-media' });
  });

  it('refuses ambiguous visible candidates instead of choosing arbitrarily', () => {
    expect(
      selectVisibleStoryMedia(
        [
          descriptor({ url: 'https://media.invalid/a.jpg' }),
          descriptor({ url: 'https://media.invalid/b.jpg' }),
        ],
        viewport,
        true,
      ),
    ).toEqual({ ok: false, reason: 'ambiguous-media' });
    expect(
      selectVisibleStoryMedia(
        [
          descriptor({ kind: 'video', url: 'https://media.invalid/a.mp4' }),
          descriptor({ kind: 'video', url: 'https://media.invalid/b.mp4' }),
        ],
        viewport,
        true,
      ),
    ).toEqual({ ok: false, reason: 'ambiguous-media' });
  });

  it('reports when no active Story viewer exists', () => {
    expect(selectVisibleStoryMedia([descriptor()], viewport, false)).toEqual({
      ok: false,
      reason: 'no-viewer',
    });
  });

  it('accepts a descriptor only when viewer-scoped and visible', () => {
    expect(isViableStoryMedia(descriptor(), viewport)).toBe(true);
    expect(isViableStoryMedia(descriptor({ inViewer: false }), viewport)).toBe(
      false,
    );
    expect(
      isViableStoryMedia(descriptor({ styleVisible: false }), viewport),
    ).toBe(false);
    expect(
      isViableStoryMedia(
        descriptor({ url: 'blob:https://www.instagram.com/abc' }),
        viewport,
      ),
    ).toBe(false);
  });
});

describe('visible Story asset adapter', () => {
  it('returns at most one MediaAsset with the requested metadata', () => {
    const asset = visibleStoryMediaToAsset(
      { ok: true, kind: 'image', url: 'https://media.invalid/visible.jpg' },
      { username: 'bryan_u6', index: 3 },
    );
    expect(Object.keys(asset)).toContain('suggestedFilename');
    expect(asset.type).toBe('image');
    expect(asset.url).toBe('https://media.invalid/visible.jpg');
    expect(asset.suggestedFilename).toBe('bryan_u6_story_03.jpg');
  });

  it('defaults to a neutral filename without metadata', () => {
    expect(
      visibleStoryMediaToAsset({
        ok: true,
        kind: 'video',
        url: 'https://media.invalid/visible.mp4',
      }).suggestedFilename,
    ).toBe('instagram_story.mp4');
  });

  it('never exposes the media URL in the sanitized result', () => {
    const result = visibleStoryResult('image', {
      visibleMedia: 'image-http',
      viewerShape: 'dialog',
    });
    expect(result).toMatchObject({
      status: 'SUCCESS',
      itemCount: 1,
      assetTypes: ['image'],
      acquisitionContext: 'background',
      storySource: 'visible-current-media',
      visibleMedia: 'image-http',
      viewerShape: 'dialog',
    });
    const text = JSON.stringify(result);
    expect(text).not.toContain('https://');
    expect(text).not.toContain('media.invalid');
    expect(text).not.toContain('visible.jpg');
  });
});

describe('sanitized visible-media diagnosis', () => {
  it('reports a usable http image', () => {
    expect(
      classifyVisibleMedia(
        {
          ok: true,
          kind: 'image',
          url: 'https://media.invalid/a.jpg',
        },
        0,
      ),
    ).toBe('image-http');
  });

  it('reports a usable http video', () => {
    expect(
      classifyVisibleMedia(
        { ok: true, kind: 'video', url: 'https://media.invalid/v.mp4' },
        0,
      ),
    ).toBe('video-http');
  });

  it('reports a blob-only video as a typed limitation, never a URL', () => {
    const diagnostic = classifyVisibleMedia(
      { ok: false, reason: 'no-visible-media' },
      1,
    );
    expect(diagnostic).toBe('video-blob');
    expect(diagnostic).not.toContain('blob:');
  });

  it('reports ambiguity and absence', () => {
    expect(
      classifyVisibleMedia({ ok: false, reason: 'ambiguous-media' }, 0),
    ).toBe('ambiguous');
    expect(classifyVisibleMedia({ ok: false, reason: 'no-viewer' }, 0)).toBe(
      'none',
    );
    expect(
      classifyVisibleMedia({ ok: false, reason: 'no-visible-media' }, 0),
    ).toBe('none');
  });

  it('maps an explicit video-blob refusal to video-blob', () => {
    expect(classifyVisibleMedia({ ok: false, reason: 'video-blob' }, 1)).toBe(
      'video-blob',
    );
  });
});

describe('MSE source classification', () => {
  it('blob currentSrc with a direct HTTP source metadata is direct-http-video', () => {
    expect(
      classifyMseSource({
        videoSources: [
          'blob:https://www.instagram.com/xyz',
          'https://media.invalid/story.mp4',
        ],
        resourceNames: [],
      }),
    ).toBe('direct-http-video');
  });

  it('blob currentSrc with only segmented resources is segmented-media', () => {
    expect(
      classifyMseSource({
        videoSources: ['blob:https://www.instagram.com/xyz'],
        resourceNames: [
          'https://media.invalid/seg-1.m4s',
          'https://media.invalid/seg-2.m4s',
        ],
      }),
    ).toBe('segmented-media');
  });

  it('blob-only is blob-only', () => {
    expect(
      classifyMseSource({
        videoSources: ['blob:https://www.instagram.com/xyz'],
        resourceNames: [],
      }),
    ).toBe('blob-only');
  });

  it('unknown when no usable signal exists', () => {
    expect(classifyMseSource({ videoSources: [], resourceNames: [] })).toBe(
      'unknown',
    );
  });
});

describe('image + music composite is never downgraded to an image', () => {
  it('refuses the still cover image when an active blob/MSE video is present', () => {
    expect(
      selectVisibleStoryMedia(
        [
          descriptor({
            kind: 'video',
            url: 'blob:https://www.instagram.com/xyz',
          }),
          descriptor({ kind: 'image', url: 'https://media.invalid/cover.jpg' }),
        ],
        viewport,
        true,
      ),
    ).toEqual({ ok: false, reason: 'video-blob' });
  });

  it('refuses a blob-only composite even without a separate cover image', () => {
    expect(
      selectVisibleStoryMedia(
        [
          descriptor({
            kind: 'video',
            url: 'blob:https://www.instagram.com/xyz',
          }),
        ],
        viewport,
        true,
      ),
    ).toEqual({ ok: false, reason: 'video-blob' });
  });

  it('prefers a direct HTTP video over the cover image when available', () => {
    const selection = selectVisibleStoryMedia(
      [
        descriptor({ kind: 'video', url: 'https://media.invalid/v.mp4' }),
        descriptor({ kind: 'image', url: 'https://media.invalid/cover.jpg' }),
      ],
      viewport,
      true,
    );
    expect(selection.ok && selection.kind).toBe('video');
  });

  it('a visible Story video stays a video asset for the reused downloader', () => {
    const asset = visibleStoryMediaToAsset({
      ok: true,
      kind: 'video',
      url: 'https://media.invalid/v.mp4',
    });
    expect(asset.type).toBe('video');
    expect(asset.suggestedFilename.endsWith('.mp4')).toBe(true);
  });
});

describe('normal username-only Story media still resolves (regression)', () => {
  const imageUrl = 'https://media.invalid/story/visible.jpg';
  const videoUrl = 'https://media.invalid/story/visible.mp4';
  const blobUrl = 'blob:https://www.instagram.com/mse';

  it('selects the single active image for a normal image Story', () => {
    expect(
      selectVisibleStoryMedia([descriptor({ url: imageUrl })], viewport, true),
    ).toEqual({
      ok: true,
      kind: 'image',
      url: imageUrl,
      width: 1080,
      height: 1920,
    });
  });

  it('selects the single active direct-http video for a normal video Story', () => {
    expect(
      selectVisibleStoryMedia(
        [descriptor({ kind: 'video', url: videoUrl })],
        viewport,
        true,
      ),
    ).toEqual({
      ok: true,
      kind: 'video',
      url: videoUrl,
      width: 1080,
      height: 1920,
    });
  });

  it('prefers the active direct-http video over its still poster image', () => {
    const selection = selectVisibleStoryMedia(
      [
        descriptor({ kind: 'video', url: videoUrl }),
        descriptor({ kind: 'image', url: 'https://media.invalid/poster.jpg' }),
      ],
      viewport,
      true,
    );
    expect(selection.ok && selection.kind).toBe('video');
    expect(selection.ok && selection.url).toBe(videoUrl);
  });

  it('selects an image when a hidden blob video is present', () => {
    const selection = selectVisibleStoryMedia(
      [
        descriptor({ url: imageUrl }),
        descriptor({ kind: 'video', url: blobUrl, styleVisible: false }),
      ],
      viewport,
      true,
    );
    expect(selection.ok && selection.kind).toBe('image');
    expect(selection.ok && selection.url).toBe(imageUrl);
  });

  it('selects an image when an offscreen blob video is present', () => {
    const selection = selectVisibleStoryMedia(
      [
        descriptor({ url: imageUrl }),
        descriptor({
          kind: 'video',
          url: blobUrl,
          rect: { top: 0, left: 400, right: 800, bottom: 800 },
        }),
      ],
      viewport,
      true,
    );
    expect(selection.ok && selection.kind).toBe('image');
    expect(selection.ok && selection.url).toBe(imageUrl);
  });

  it('ignores hidden and offscreen sibling/preview Story media', () => {
    const selection = selectVisibleStoryMedia(
      [
        descriptor({ url: imageUrl }),
        descriptor({ kind: 'video', url: videoUrl, styleVisible: false }),
        descriptor({
          kind: 'video',
          url: blobUrl,
          rect: { top: 0, left: -800, right: -400, bottom: 800 },
        }),
        descriptor({
          kind: 'image',
          url: 'https://media.invalid/next.jpg',
          rect: { top: 0, left: 400, right: 800, bottom: 800 },
        }),
      ],
      viewport,
      true,
    );
    expect(selection.ok && selection.url).toBe(imageUrl);
  });

  it('selects the central image, never a neighboring preview image', () => {
    const selection = selectVisibleStoryMedia(
      [
        descriptor({
          url: 'https://media.invalid/neighbor.jpg',
          rect: { top: 0, left: 400, right: 800, bottom: 800 },
        }),
        descriptor({ url: imageUrl }),
      ],
      viewport,
      true,
    );
    expect(selection.ok && selection.url).toBe(imageUrl);
  });

  it('selects the recovered direct-http video behind a blob currentSrc', () => {
    // The injector resolves the http source behind a `blob:` currentSrc, so the
    // descriptor carries the direct URL and the composite still downloads a
    // real video instead of being refused.
    const selection = selectVisibleStoryMedia(
      [
        descriptor({ kind: 'video', url: videoUrl }),
        descriptor({ kind: 'image', url: 'https://media.invalid/cover.jpg' }),
      ],
      viewport,
      true,
    );
    expect(selection.ok && selection.url).toBe(videoUrl);
  });

  it('still refuses when multiple active direct-http videos are ambiguous', () => {
    expect(
      selectVisibleStoryMedia(
        [
          descriptor({ kind: 'video', url: videoUrl }),
          descriptor({ kind: 'video', url: 'https://media.invalid/other.mp4' }),
        ],
        viewport,
        true,
      ),
    ).toEqual({ ok: false, reason: 'ambiguous-media' });
  });
});

describe('active Story media gate', () => {
  it('accepts blob video geometry but never treats it as downloadable', () => {
    const blobVideo = descriptor({
      kind: 'video',
      url: 'blob:https://www.instagram.com/mse',
    });
    expect(isActiveStoryMedia(blobVideo, viewport)).toBe(true);
    expect(isViableStoryMedia(blobVideo, viewport)).toBe(false);
  });
});

describe('Story resolution source decision', () => {
  it('keeps the explicit Story id on the existing API path', () => {
    expect(
      chooseStorySource({
        hasExplicitId: true,
        hasProfileRef: false,
        hasCurrentId: false,
        hasVisibleMedia: true,
      }),
    ).toBe('explicit-id-url');
  });

  it('uses the API path when a username-only viewer yields a current id', () => {
    expect(
      chooseStorySource({
        hasExplicitId: false,
        hasProfileRef: true,
        hasCurrentId: true,
        hasVisibleMedia: true,
      }),
    ).toBe('explicit-id-url');
  });

  it('falls back to visible-current-media for a username-only Story URL', () => {
    expect(
      chooseStorySource({
        hasExplicitId: false,
        hasProfileRef: true,
        hasCurrentId: false,
        hasVisibleMedia: true,
      }),
    ).toBe('visible-current-media');
  });

  it('reports unsupported when nothing reliable is available', () => {
    expect(
      chooseStorySource({
        hasExplicitId: false,
        hasProfileRef: true,
        hasCurrentId: false,
        hasVisibleMedia: false,
      }),
    ).toBe('unsupported');
  });
});

describe('username-only visible fallback decision (mirrors the resolver)', () => {
  function fallback(descriptors: readonly StoryMediaDescriptor[]) {
    const selection = selectVisibleStoryMedia(descriptors, viewport, true);
    const diagnostic = classifyVisibleMedia(selection, 0);
    const chosen = chooseStorySource({
      hasExplicitId: false,
      hasProfileRef: true,
      hasCurrentId: false,
      hasVisibleMedia: Boolean(selection.ok),
    });
    if (selection.ok && chosen === 'visible-current-media')
      return {
        status: 'SUCCESS' as const,
        kind: selection.kind,
        asset: visibleStoryMediaToAsset(selection),
      };
    return { status: 'UNSUPPORTED_CONTENT' as const, diagnostic };
  }

  it('resolves a normal username-only image Story to an image asset', () => {
    const outcome = fallback([descriptor()]);
    expect(outcome.status).toBe('SUCCESS');
    expect(outcome).toMatchObject({ kind: 'image' });
    expect('asset' in outcome && outcome.asset?.type).toBe('image');
  });

  it('resolves a normal username-only video Story to a video asset', () => {
    const outcome = fallback([
      descriptor({ kind: 'video', url: 'https://media.invalid/v.mp4' }),
    ]);
    expect(outcome.status).toBe('SUCCESS');
    expect(outcome).toMatchObject({ kind: 'video' });
    expect('asset' in outcome && outcome.asset?.type).toBe('video');
  });

  it('keeps a normal image Story resolvable despite a hidden preload video', () => {
    const outcome = fallback([
      descriptor(),
      descriptor({
        kind: 'video',
        url: 'blob:https://www.instagram.com/mse',
        styleVisible: false,
      }),
    ]);
    expect(outcome).toMatchObject({ status: 'SUCCESS', kind: 'image' });
  });

  it('returns a typed MSE limitation for an image+music composite, never a JPEG', () => {
    const outcome = fallback([
      descriptor({ kind: 'video', url: 'blob:https://www.instagram.com/mse' }),
      descriptor({ kind: 'image', url: 'https://media.invalid/cover.jpg' }),
    ]);
    expect(outcome).toEqual({
      status: 'UNSUPPORTED_CONTENT',
      diagnostic: 'video-blob',
    });
  });
});

describe('visible media extractor boundary', () => {
  const source = collectStoryViewerContextFunction.toString();

  it.each([
    'reel_ids',
    'reels_media',
    'feed/user',
    'highlights',
    'chrome.cookies',
    'document.cookie',
    'sessionid',
    'localStorage',
    'indexedDB',
    'fetch(',
  ])('never introduces the forbidden token %s', (token) => {
    expect(source).not.toContain(token);
  });

  it('scopes to the active viewer and checks visibility', () => {
    expect(source).toContain('role="dialog"');
    expect(source).toContain('getComputedStyle');
    expect(source).toContain('getBoundingClientRect');
  });

  it('excludes media hidden by any ancestor, not just the element itself', () => {
    expect(source).toContain('checkVisibility');
    expect(source).toContain('parentElement');
  });

  it('never counts a hidden or offscreen video as the active Story', () => {
    // Blob/MSE videos are exposed as descriptors (geometry-gated) rather than a
    // global boolean, so a hidden preload can never suppress an active image.
    expect(source).toMatch(/startsWith\(["']blob:["']\)/);
    expect(source).not.toContain('videoPresent');
  });

  it('reads progress segments without enumeration', () => {
    expect(source).toContain('role="progressbar"');
    expect(source).toContain('aria-valuenow');
    expect(source).toContain('aria-current');
  });

  it('falls back to http source attributes without downloading blob:', () => {
    expect(source).toContain('currentSrc');
    expect(source).toMatch(/querySelectorAll\(["']source["']\)/);
    expect(source).toContain('srcset');
    expect(source).toMatch(/startsWith\(["']blob:["']\)/);
  });

  it('never branches on follower/following status', () => {
    expect(source).not.toMatch(/follow/i);
  });
});

import { describe, expect, it } from 'vitest';
import {
  classifyLinkPathname,
  describeFiberStructure,
  describeLinks,
  describeMediaMeta,
  describeNavigationState,
  describePageStore,
  fiberKind,
  structuralKeyName,
  type FiberLike,
} from './identity-sources';

describe('structural key-name sanitization', () => {
  it('keeps recognized structural names and masks everything else', () => {
    expect(structuralKeyName('current')).toBe('current');
    expect(structuralKeyName('mediaId')).toBe('mediaId');
    expect(structuralKeyName('story_media_id')).toBe('story_media_id');
    expect(structuralKeyName('onClick')).toBe('onClick');
    // Arbitrary map keys (record ids, shortcodes, usernames) are masked.
    expect(structuralKeyName('1234567890')).toBe('?');
    expect(structuralKeyName('CxYzAbC123')).toBe('?');
    expect(structuralKeyName('some_random_user')).toBe('?');
  });
});

describe('fiber kind classification', () => {
  it('labels host/function/class/other without invoking anything', () => {
    expect(fiberKind({ type: 'video' })).toBe('host');
    expect(fiberKind({ type: () => null })).toBe('function');
    function Component() {}
    (
      Component as unknown as { prototype: { isReactComponent: unknown } }
    ).prototype.isReactComponent = {};
    expect(fiberKind({ type: Component })).toBe('class');
    expect(fiberKind({ type: null })).toBe('other');
  });
});

describe('bounded fiber structure', () => {
  function chain(length: number): FiberLike {
    let node: FiberLike = { type: 'video', memoizedProps: {} };
    for (let index = 0; index < length; index += 1) {
      node = { type: 'div', return: node };
    }
    return node;
  }

  it('describes the parent radius, prop/state key names and handler names', () => {
    const root: FiberLike = {
      type: () => null,
      memoizedProps: {
        current: { media: { mediaId: '1234567890' } },
        user: { pk: '9876543210' },
        onClick: () => undefined,
      },
      memoizedState: { value: 1 },
      return: null,
    };
    const start: FiberLike = {
      type: 'video',
      memoizedProps: { src: 'x', poster: 'y' },
      child: { type: 'source' },
      sibling: { type: () => null },
      return: root,
    };
    const structure = describeFiberStructure(start);
    expect(structure.root).toBe(true);
    expect(structure.parentDepths).toEqual([0, 1]);
    expect(structure.propKeys).toEqual(
      expect.arrayContaining(['current', 'media', 'mediaId', 'user', 'pk']),
    );
    expect(structure.stateKeys).toEqual(['value']);
    expect(structure.handlerKeys).toEqual(['onClick']);
    expect(structure.childKinds).toEqual(['function', 'host']);
    expect(structure.childCount).toBe(2);
    expect(structure.candidatePathShapes).toEqual([
      'current.media.mediaId',
      'user.pk',
    ]);
    // Structure only: no numeric value ever appears.
    const serialized = JSON.stringify(structure);
    for (const value of ['1234567890', '9876543210'])
      expect(serialized).not.toContain(value);
  });

  it('bounds the parent radius and the child/sibling radius', () => {
    const deep = chain(40);
    expect(
      describeFiberStructure(deep).parentDepths.length,
    ).toBeLessThanOrEqual(7);
    // A wide sibling graph must stop at the fixed child bound.
    let wide: FiberLike = { type: 'span' };
    for (let index = 0; index < 200; index += 1) {
      wide = { type: 'span', sibling: wide };
    }
    const wideStructure = describeFiberStructure({
      type: 'video',
      child: wide,
    });
    expect(wideStructure.childCount).toBeLessThanOrEqual(12);
  });
});

describe('in-card link path shapes', () => {
  it('classifies story-item / reel / post / other without returning the path', () => {
    expect(classifyLinkPathname('/stories/some_user/1234567890/')).toBe(
      'story-item',
    );
    expect(classifyLinkPathname('/reel/CxYzAbC123/')).toBe('reel');
    expect(classifyLinkPathname('/reels/CxYzAbC123/')).toBe('reel');
    expect(classifyLinkPathname('/p/CxYzAbC123/')).toBe('post');
    expect(classifyLinkPathname('/tv/CxYzAbC123/')).toBe('post');
    expect(classifyLinkPathname('/some_user/')).toBe('other');
    expect(
      describeLinks([
        '/stories/some_user/1234567890/',
        '/p/CxYzAbC123/',
        '/some_user/',
      ]),
    ).toEqual({
      storyItemShape: true,
      reelShape: false,
      postShape: true,
      otherShape: true,
    });
    // The shape diagnostic never contains an id, username or path.
    const serialized = JSON.stringify(
      describeLinks(['/stories/some_user/1234567890/']),
    );
    expect(serialized).not.toContain('1234567890');
    expect(serialized).not.toContain('some_user');
    expect(serialized).not.toContain('/stories');
  });
});

describe('navigation, media metadata and page store shape', () => {
  it('reports navigation state key names only', () => {
    expect(
      describeNavigationState({
        navigationApi: true,
        entryState: { mediaId: '1', someUser: 'x', nested: {} },
      }),
    ).toEqual({
      navigationApi: true,
      entryStateKeys: ['?', 'mediaId'],
    });
    expect(
      describeNavigationState({ navigationApi: false, entryState: undefined }),
    ).toEqual({ navigationApi: false, entryStateKeys: [] });
  });

  it('reports media metadata names and bounded counts only', () => {
    const meta = describeMediaMeta({
      datasetKeys: ['mediaId', 'someUser'],
      attributeKeys: ['src', 'poster', 'data-x'],
      sourceAttributeKeys: ['src', 'type'],
      trackAttributeKeys: ['kind', 'src'],
      sourceCount: 1,
      trackCount: 0,
    });
    expect(meta.datasetKeys).toEqual(['?', 'mediaId']);
    expect(meta.attributeKeys).toEqual(['?', 'poster', 'src']);
    expect(meta.sourceAttributeKeys).toEqual(['src', 'type']);
    expect(meta.trackAttributeKeys).toEqual(['kind', 'src']);
    expect(meta.sourceCount).toBe(1);
    expect(meta.trackCount).toBe(0);
    expect(JSON.stringify(meta)).not.toContain('someUser');
  });

  it('reports page store shape names and masked candidate paths only', () => {
    const store = describePageStore({
      found: true,
      shapeNames: ['current', 'media', '1234567890', 'CxYzAbC123'],
      candidatePathShapes: ['current.media.mediaId', 'user.pk'],
    });
    expect(store.found).toBe(true);
    expect(store.shapeKeys).toEqual(['?', 'current', 'media']);
    expect(store.candidatePathShapes).toEqual([
      'current.media.mediaId',
      'user.pk',
    ]);
    expect(JSON.stringify(store)).not.toContain('1234567890');
    expect(JSON.stringify(store)).not.toContain('CxYzAbC123');
  });
});

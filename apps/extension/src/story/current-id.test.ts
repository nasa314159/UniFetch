import { describe, expect, it } from 'vitest';
import {
  classifyStoryIdPath,
  collectReactStoryIdEvidence,
  collectStoryIdCandidates,
  currentStoryIdScanFunction,
  describeReactStoryIdStructure,
  findStoryIdCandidates,
  matchOwner,
  resolveCurrentStoryId,
  selectActiveStoryRoot,
  selectCurrentStoryId,
  selectStructuredCurrentStoryId,
  storyIdPathShape,
  summarizeStoryIdEvidence,
  type CurrentStoryIdScan,
  type ReactNodeLike,
  type StoryCardGeometry,
  type StoryIdPathRole,
  type StoryIdSourceEvidence,
  type StoryViewerGeometry,
} from './current-id';

function evidence(
  source: StoryIdSourceEvidence['source'],
  value: unknown,
): StoryIdSourceEvidence {
  return { source, ...findStoryIdCandidates(value) };
}

function scan(list: StoryIdSourceEvidence[]): CurrentStoryIdScan {
  return { evidence: list };
}

describe('current Story id extraction from page state', () => {
  it('inline JSON with one current active Story id', () => {
    expect(
      resolveCurrentStoryId(
        scan([evidence('html-inline-json', { activeStoryId: '1111111111' })]),
      ),
    ).toEqual({
      id: '1111111111',
      idExtractionSource: 'html-inline-json',
      candidateCount: 1,
      activeMarkerFound: true,
    });
  });

  it('hydration state with multiple ids and one active marker', () => {
    const resolution = resolveCurrentStoryId(
      scan([
        evidence('hydration-state', {
          current_story_id: '2222222222',
          items: [
            { story_media_id: '1111111111' },
            { story_media_id: '2222222222' },
          ],
        }),
      ]),
    );
    expect(resolution).toEqual({
      id: '2222222222',
      idExtractionSource: 'hydration-state',
      candidateCount: 'many',
      activeMarkerFound: true,
    });
  });

  it('multiple ids without an active marker are refused', () => {
    expect(
      resolveCurrentStoryId(
        scan([
          evidence('html-inline-json', {
            items: [
              { story_media_id: '1111111111' },
              { story_media_id: '2222222222' },
            ],
          }),
        ]),
      ),
    ).toEqual({
      idExtractionSource: 'none',
      candidateCount: 'many',
      activeMarkerFound: false,
    });
  });

  it('history.state with a single current id', () => {
    expect(
      resolveCurrentStoryId(
        scan([evidence('history-state', { media_id: '3333333333' })]),
      ),
    ).toEqual({
      id: '3333333333',
      idExtractionSource: 'history-state',
      candidateCount: 1,
      activeMarkerFound: false,
    });
  });

  it('viewer attribute with a current id', () => {
    expect(
      resolveCurrentStoryId(
        scan([evidence('viewer-attribute', { activeId: '4444444444' })]),
      ),
    ).toEqual({
      id: '4444444444',
      idExtractionSource: 'viewer-attribute',
      candidateCount: 1,
      activeMarkerFound: true,
    });
  });

  it('skips an ambiguous earlier source and uses a later proven one', () => {
    expect(
      resolveCurrentStoryId(
        scan([
          evidence('html-inline-json', {
            items: [
              { story_media_id: '1111111111' },
              { story_media_id: '2222222222' },
            ],
          }),
          evidence('history-state', { story_media_id: '3333333333' }),
        ]),
      ),
    ).toEqual({
      id: '3333333333',
      idExtractionSource: 'history-state',
      candidateCount: 1,
      activeMarkerFound: false,
    });
  });

  it('treats a nested current/active object as an active marker', () => {
    const collected = findStoryIdCandidates({
      active: { media: { media_id: '5555555555' } },
    });
    expect(collected).toEqual({
      ids: ['5555555555'],
      activeIds: ['5555555555'],
      strongIds: ['5555555555'],
      truncated: false,
      candidates: [
        {
          value: '5555555555',
          key: 'media_id',
          keyPath: ['active', 'media', 'media_id'],
          active: true,
          strong: true,
        },
      ],
    });
  });

  it('never exposes the id in the sanitized diagnostic', () => {
    const resolution = resolveCurrentStoryId(
      scan([evidence('history-state', { story_media_id: '6666666666' })]),
    );
    const { id, ...diagnostic } = resolution;
    expect(id).toBe('6666666666');
    expect(JSON.stringify(diagnostic)).not.toContain('6666666666');
  });
});

describe('single-source selection', () => {
  it('accepts one candidate or one active marker', () => {
    expect(
      selectCurrentStoryId({
        ids: ['1234567890'],
        activeIds: [],
        strongIds: [],
        truncated: false,
      }),
    ).toEqual({ ok: true, id: '1234567890' });
    expect(
      selectCurrentStoryId({
        ids: ['1111111111', '2222222222'],
        activeIds: ['2222222222'],
        strongIds: [],
        truncated: false,
      }),
    ).toEqual({ ok: true, id: '2222222222' });
  });

  it('prefers a single media-specific strong id over generic ids', () => {
    expect(
      selectCurrentStoryId({
        ids: ['1111111111', '9999999999'],
        activeIds: [],
        strongIds: ['1111111111'],
        truncated: false,
      }),
    ).toEqual({ ok: true, id: '1111111111' });
  });

  it('refuses ambiguity and truncation', () => {
    expect(
      selectCurrentStoryId({
        ids: ['1111111111', '2222222222'],
        activeIds: [],
        strongIds: [],
        truncated: false,
      }),
    ).toEqual({ ok: false, reason: 'ambiguous' });
    expect(
      selectCurrentStoryId({
        ids: ['1111111111', '2222222222'],
        activeIds: [],
        strongIds: ['1111111111', '2222222222'],
        truncated: false,
      }),
    ).toEqual({ ok: false, reason: 'ambiguous' });
    expect(
      selectCurrentStoryId({
        ids: ['1111111111'],
        activeIds: [],
        strongIds: [],
        truncated: true,
      }),
    ).toEqual({ ok: false, reason: 'ambiguous' });
    expect(
      selectCurrentStoryId({
        ids: [],
        activeIds: [],
        strongIds: [],
        truncated: false,
      }),
    ).toEqual({ ok: false, reason: 'none' });
  });
});

describe('page-state candidate collection', () => {
  it('collects ids and active ids from nested page state', () => {
    const result = findStoryIdCandidates({
      a: {
        current_story_id: 2222222222,
        items: [
          { story_media_id: '1111111111' },
          { story_media_id: '2222222222' },
        ],
      },
    });
    expect([...result.ids].sort()).toEqual(['1111111111', '2222222222']);
    expect(result.activeIds).toEqual(['2222222222']);
    expect(result.truncated).toBe(false);
  });

  it('never collects arbitrary numeric values', () => {
    expect(
      findStoryIdCandidates({
        like_count: 123456,
        caption: '1234567890',
        user: { pk: 'x' },
      }),
    ).toMatchObject({ ids: [], activeIds: [] });
  });

  it('marks a scan truncated when it exceeds its bound', () => {
    const nested = {
      items: Array.from({ length: 80 }, (_, i) => ({
        media_id: String(2000000000 + i),
      })),
    };
    expect(findStoryIdCandidates(nested).truncated).toBe(true);
  });
});

describe('current Story id from active viewer React state', () => {
  function reactNode(
    props: Record<string, unknown>,
    parent?: ReactNodeLike,
  ): ReactNodeLike {
    const node: ReactNodeLike = { __reactProps$test: props };
    if (parent) node.parentElement = parent;
    return node;
  }

  function reactResolution(
    element: ReactNodeLike | null,
  ): ReturnType<typeof resolveCurrentStoryId> {
    return resolveCurrentStoryId(
      scan([
        {
          source: 'react-current-props',
          ...collectReactStoryIdEvidence(element),
        },
      ]),
    );
  }

  it('accepts one current id from the active Story media node props', () => {
    expect(reactResolution(reactNode({ media_id: '1234567890' }))).toEqual({
      id: '1234567890',
      idExtractionSource: 'react-current-props',
      candidateCount: 1,
      activeMarkerFound: false,
    });
  });

  it('accepts one current id from a bounded viewer ancestor props', () => {
    const ancestor = reactNode({ current_story_id: '2222222222' });
    const media = reactNode({ playback: 'video' }, ancestor);
    expect(reactResolution(media)).toEqual({
      id: '2222222222',
      idExtractionSource: 'react-current-props',
      candidateCount: 1,
      activeMarkerFound: true,
    });
  });

  it('reads the fiber memoizedProps without walking the React tree', () => {
    const media: ReactNodeLike = {
      __reactFiber$test: { memoizedProps: { story_media_id: '3333333333' } },
    };
    expect(collectReactStoryIdEvidence(media).ids).toEqual(['3333333333']);
  });

  it('selects the single active marker among multiple React ids', () => {
    const media = reactNode({
      items: [{ media_id: '1111111111' }, { media_id: '2222222222' }],
      current_story_id: '2222222222',
    });
    expect(reactResolution(media)).toEqual({
      id: '2222222222',
      idExtractionSource: 'react-current-props',
      candidateCount: 'many',
      activeMarkerFound: true,
    });
  });

  it('refuses multiple React ids without a provable active relation', () => {
    const media = reactNode({
      items: [{ media_id: '1111111111' }, { media_id: '2222222222' }],
    });
    expect(reactResolution(media)).toEqual({
      idExtractionSource: 'none',
      candidateCount: 'many',
      activeMarkerFound: false,
    });
  });

  it('prefers a single media-specific id over a nested owner id', () => {
    const media = reactNode({
      media_id: '1234567890',
      owner: { pk: '9876543210' },
    });
    expect(reactResolution(media)).toEqual({
      id: '1234567890',
      idExtractionSource: 'react-current-props',
      candidateCount: 'many',
      activeMarkerFound: false,
    });
  });

  it('ignores hidden/preloaded or adjacent media not in the ancestor chain', () => {
    const media: ReactNodeLike = {
      __reactProps$test: { media_id: '1234567890' },
      hiddenPreload: { __reactProps$test: { media_id: '9999999999' } },
      adjacentPreview: { __reactProps$test: { story_media_id: '7777777777' } },
    };
    expect(collectReactStoryIdEvidence(media).ids).toEqual(['1234567890']);
  });
});

describe('active Story root proof (viewer-relative identity integrity)', () => {
  // A 1200x800 desktop viewport with the Story viewer filling it.
  const viewer: StoryViewerGeometry = {
    left: 0,
    top: 0,
    right: 1200,
    bottom: 800,
  };
  const viewportArea = 1200 * 800;
  function card(
    left: number,
    top: number,
    width: number,
    height: number,
    extra: Partial<StoryCardGeometry> = {},
  ): StoryCardGeometry {
    const area = width * height;
    return {
      rendered: true,
      area,
      visibleArea: area,
      left,
      top,
      right: left + width,
      bottom: top + height,
      ...extra,
    };
  }
  // A narrow portrait card at ~31% of the full viewport; the old >=50% viewport
  // visible-area rule wrongly rejected exactly this shape.
  const central = card(395, 40, 410, 720);
  const leftPreview = card(-40, 50, 300, 700, { owner: 'bob' });
  const rightPreview = card(940, 50, 300, 700, { owner: 'carol' });

  it('proves a portrait central card occupying only ~30-40% of the viewport', () => {
    const ratio = central.area / viewportArea;
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.4);
    expect(selectActiveStoryRoot([central], viewer, 'alice')).toEqual({
      status: 'proven',
      index: 0,
    });
  });

  it('proves the central card with previews on both sides', () => {
    expect(
      selectActiveStoryRoot(
        [leftPreview, central, rightPreview],
        viewer,
        'alice',
      ),
    ).toEqual({ status: 'proven', index: 1 });
  });

  it('ignores visible previews whose own publisher differs from the route', () => {
    // The central card exposes no owner, but both previews are visible and
    // belong to other accounts, so neither can ever become the root.
    expect(
      selectActiveStoryRoot(
        [leftPreview, central, rightPreview],
        viewer,
        'alice',
      ),
    ).toEqual({ status: 'proven', index: 1 });
  });

  it('proves the card whose header publisher matches the route', () => {
    const ownCard = card(395, 40, 410, 720, { owner: 'ALICE' });
    expect(
      selectActiveStoryRoot(
        [leftPreview, ownCard, rightPreview],
        viewer,
        'alice',
      ),
    ).toEqual({ status: 'proven', index: 1, ownerMatch: true });
  });

  it('refuses a central card whose header publisher mismatches the route', () => {
    const impostor = card(395, 40, 410, 720, { owner: 'bob' });
    expect(selectActiveStoryRoot([impostor], viewer, 'alice')).toEqual({
      status: 'ambiguous',
      ownerMatch: false,
    });
  });

  it('proves an unknown-owner card only when the runner-up margin is safe', () => {
    // Unique central card with a far-off preview -> proven.
    expect(
      selectActiveStoryRoot([leftPreview, central], viewer, 'alice'),
    ).toEqual({ status: 'proven', index: 1 });
    // A near-central runner-up outside the active zone but inside the margin
    // -> ambiguous, fail closed.
    const best = card(580, 40, 400, 720); // dx 0.15
    const runnerUp = card(730, 40, 400, 720); // dx 0.275
    expect(selectActiveStoryRoot([best, runnerUp], viewer, 'alice')).toEqual({
      status: 'ambiguous',
    });
  });

  it('refuses two similarly-central cards', () => {
    const left = card(465, 40, 270, 720);
    const right = card(735, 40, 270, 720);
    expect(selectActiveStoryRoot([left, right], viewer, 'alice')).toEqual({
      status: 'ambiguous',
    });
  });

  it('ignores a hidden or preloaded card', () => {
    const hidden = card(395, 40, 410, 720, { rendered: false });
    const preloaded = card(395, 40, 410, 720, { visibleArea: 0 });
    expect(selectActiveStoryRoot([hidden, central], viewer, 'alice')).toEqual({
      status: 'proven',
      index: 1,
    });
    expect(
      selectActiveStoryRoot([preloaded, central], viewer, 'alice'),
    ).toEqual({
      status: 'proven',
      index: 1,
    });
  });

  it('collapses an image + video cover in one card to a single root', () => {
    const video = card(395, 40, 410, 720);
    const cover = card(395, 40, 410, 720);
    expect(selectActiveStoryRoot([video, cover], viewer, 'alice')).toEqual({
      status: 'proven',
      index: 0,
    });
  });

  it('does not depend on candidate DOM order', () => {
    const forward = selectActiveStoryRoot(
      [leftPreview, central, rightPreview],
      viewer,
      'alice',
    );
    const reversed = selectActiveStoryRoot(
      [rightPreview, central, leftPreview],
      viewer,
      'alice',
    );
    expect(forward).toEqual({ status: 'proven', index: 1 });
    expect(reversed).toEqual({ status: 'proven', index: 1 });
  });

  it('never lets a large off-center neighbour win', () => {
    const bigNeighbour = card(-100, 0, 600, 800); // 50% of viewport, far left
    expect(
      selectActiveStoryRoot([bigNeighbour, central], viewer, 'alice'),
    ).toEqual({ status: 'proven', index: 1 });
    const ownedNeighbour = card(-100, 0, 600, 800, { owner: 'bob' });
    expect(
      selectActiveStoryRoot([ownedNeighbour, central], viewer, 'alice'),
    ).toEqual({ status: 'proven', index: 1 });
  });

  it('gates extracted evidence on the proven root', () => {
    // Only the proven card's own evidence is ever collected; the `chain` is
    // bounded so an adjacent preview id can never be selected.
    const scan: CurrentStoryIdScan = {
      evidence: [
        {
          source: 'react-current-props',
          ...findStoryIdCandidates({
            items: [
              { media_id: '1111111111' },
              { media_id: '2222222222' },
              { media_id: '3333333333' },
            ],
          }),
        },
      ],
      activeRoot: 'proven',
      candidateInsideActiveRoot: true,
    };
    expect(resolveCurrentStoryId(scan)).toEqual({
      idExtractionSource: 'none',
      candidateCount: 'many',
      activeMarkerFound: false,
    });
  });
});

describe('owner consistency matching', () => {
  it('matches case-insensitively and reports unknown when unavailable', () => {
    expect(matchOwner('alice', 'ALICE')).toBe(true);
    expect(matchOwner('alice', 'bob')).toBe(false);
    expect(matchOwner('alice', undefined)).toBe('unknown');
    expect(matchOwner(undefined, 'bob')).toBe('unknown');
  });
});

describe('sanitized id-evidence diagnostics', () => {
  it('keeps internal provenance per candidate without flattening it early', () => {
    const collected = collectStoryIdCandidates([
      {
        items: [{ media_id: '1111111111' }, { story_media_id: '2222222222' }],
        current_story_id: '2222222222',
      },
    ]);
    expect(collected.candidates).toEqual([
      {
        value: '1111111111',
        key: 'media_id',
        keyPath: ['items', '#0', 'media_id'],
        active: false,
        strong: true,
      },
      {
        value: '2222222222',
        key: 'story_media_id',
        keyPath: ['items', '#1', 'story_media_id'],
        active: false,
        strong: true,
      },
      {
        value: '2222222222',
        key: 'current_story_id',
        keyPath: ['current_story_id'],
        active: true,
        strong: false,
      },
    ]);
  });

  it('summarizes one source into none/one/many counts and root scoping', () => {
    const many = collectStoryIdCandidates([
      {
        items: [{ media_id: '1111111111' }, { media_id: '2222222222' }],
        current_story_id: '2222222222',
      },
    ]);
    expect(summarizeStoryIdEvidence('hydration-state', many, 'n/a')).toEqual({
      source: 'hydration-state',
      candidateCount: 'many',
      strongCandidateCount: 'many',
      activeCandidateCount: 1,
      insideActiveRoot: 'n/a',
    });
    const none = collectStoryIdCandidates([{ caption: '1' }]);
    expect(summarizeStoryIdEvidence('history-state', none, 'n/a')).toEqual({
      source: 'history-state',
      candidateCount: 0,
      strongCandidateCount: 0,
      activeCandidateCount: 0,
      insideActiveRoot: 'n/a',
    });
  });

  it('describes React attachments structurally with key names and kinds only', () => {
    const media: ReactNodeLike = { __reactProps$test: { playback: 'video' } };
    const descendant: ReactNodeLike = {
      __reactProps$test: { story_media_id: '3333333333', media: { story: {} } },
    };
    expect(
      describeReactStoryIdStructure([
        { node: media, kind: 'media', depth: 0 },
        { node: descendant, kind: 'descendant', depth: -1 },
      ]),
    ).toEqual({
      reactKeyFound: true,
      descendantReactKeyFound: true,
      inspectedNodeKinds: ['media', 'descendant'],
      candidateKeyNames: ['story_media_id'],
      candidatePathShapes: ['story_media_id'],
      candidateDepths: [-1],
      objectShapeHints: ['media', 'playback', 'story', 'story_media_id'],
    });
  });

  it('never returns a numeric value from the structural descriptor', () => {
    const node: ReactNodeLike = {
      __reactProps$test: { story_media_id: '4444444444' },
    };
    const structure = describeReactStoryIdStructure([
      { node, kind: 'descendant', depth: -1 },
    ]);
    expect(structure.candidateKeyNames).toEqual(['story_media_id']);
    expect(JSON.stringify(structure)).not.toContain('4444444444');
  });

  it('inspects only the exact nodes it is handed, never their neighbours', () => {
    const media: ReactNodeLike = { __reactProps$test: {} };
    (media as Record<string, unknown>).adjacentPreview = {
      __reactProps$test: { story_media_id: '7777777777' },
    };
    const structure = describeReactStoryIdStructure([
      { node: media, kind: 'media', depth: 0 },
    ]);
    expect(structure.candidateKeyNames).toEqual([]);
    expect(structure.objectShapeHints).toEqual([]);
  });

  it('diagnoses a descendant React attachment without selecting it (cand=0 path)', () => {
    // A video/MSE Story may hang its React data off a wrapper/child inside the
    // proven root. That is DIAGNOSED here but never fed into selection, so the
    // selector still fails closed with `cand=0` until a later, proven change.
    const panel: ReactNodeLike = {};
    const descendant: ReactNodeLike = {
      __reactProps$test: { story_media_id: '3333333333' },
    };
    const structure = describeReactStoryIdStructure([
      { node: panel, kind: 'media', depth: 0 },
      { node: descendant, kind: 'descendant', depth: -1 },
    ]);
    expect(structure.descendantReactKeyFound).toBe(true);
    const selectionEvidence = collectReactStoryIdEvidence(panel);
    expect(selectionEvidence.ids).toEqual([]);
    expect(
      resolveCurrentStoryId({
        evidence: [{ source: 'react-current-props', ...selectionEvidence }],
      }),
    ).toEqual({
      idExtractionSource: 'none',
      candidateCount: 0,
      activeMarkerFound: false,
    });
  });

  it('never lets structural diagnostics alone select a current id', () => {
    const scan: CurrentStoryIdScan = {
      evidence: [],
      activeRoot: 'proven',
      candidateInsideActiveRoot: true,
      sourceDiagnostics: [
        {
          source: 'react-current-props',
          candidateCount: 1,
          strongCandidateCount: 1,
          activeCandidateCount: 1,
          insideActiveRoot: true,
        },
      ],
    };
    expect(resolveCurrentStoryId(scan)).toEqual({
      idExtractionSource: 'none',
      candidateCount: 0,
      activeMarkerFound: false,
    });
  });

  it('refuses two strong media candidates rather than picking the first', () => {
    // Two media/Story-specific ids (e.g. the active media plus a neighbour card)
    // stay unsupported; no arbitrary first/last candidate is ever selected.
    const scan: CurrentStoryIdScan = {
      evidence: [
        {
          source: 'react-current-props',
          ...findStoryIdCandidates({
            media_id: '1111111111',
            story_media_id: '2222222222',
          }),
        },
      ],
      activeRoot: 'proven',
      candidateInsideActiveRoot: true,
    };
    expect(resolveCurrentStoryId(scan)).toEqual({
      idExtractionSource: 'none',
      candidateCount: 'many',
      activeMarkerFound: false,
    });
  });
});

describe('structural current-item path classification', () => {
  type RootStatus = 'proven' | 'ambiguous' | 'none';
  function structuredScan(
    value: unknown,
    activeRoot: RootStatus = 'proven',
  ): CurrentStoryIdScan {
    return {
      evidence: [],
      activeRoot,
      reactCandidates: collectStoryIdCandidates([value]).candidates,
    };
  }

  it('classifies current-rooted media paths as current-item and rejects owners/collections', () => {
    const cases: [string[], string, StoryIdPathRole][] = [
      [['current', 'mediaId'], 'mediaId', 'current-item'],
      [['current', 'media', 'mediaId'], 'mediaId', 'current-item'],
      [['viewer', 'current', 'mediaId'], 'mediaId', 'current-item'],
      [['current', 'item', 'pk'], 'pk', 'current-item'],
      [['user', 'pk'], 'pk', 'rejected'],
      [['owner', 'id'], 'id', 'rejected'],
      [['reel', 'id'], 'id', 'rejected'],
      [['reelId'], 'reelId', 'rejected'],
      [['items', '#0', 'mediaId'], 'mediaId', 'unrelated'],
      [['current', 'items', '#0', 'mediaId'], 'mediaId', 'rejected'],
      [['current', 'user', 'pk'], 'pk', 'rejected'],
    ];
    for (const [path, key, role] of cases)
      expect(classifyStoryIdPath(path, key)).toBe(role);
  });

  it('sanitizes path shapes with structural names and [] only', () => {
    expect(storyIdPathShape(['current', 'media', 'mediaId'])).toBe(
      'current.media.mediaId',
    );
    expect(storyIdPathShape(['viewer', 'current', 'mediaId'])).toBe(
      'viewer.current.mediaId',
    );
    expect(storyIdPathShape(['items', '#0', 'mediaId'])).toBe(
      'items[].mediaId',
    );
    expect(storyIdPathShape(['user', 'pk'])).toBe('user.pk');
    expect(storyIdPathShape(['reelId'])).toBe('reelId');
    // Unknown segments are masked, never emitted raw.
    expect(storyIdPathShape(['current', 'weirdInternalThing', 'mediaId'])).toBe(
      'current.?.mediaId',
    );
  });

  it('chooses the current mediaId over an unrelated user.pk', () => {
    const scan = structuredScan({
      current: { mediaId: '1111111111' },
      user: { pk: '9999999999' },
    });
    expect(resolveCurrentStoryId(scan)).toEqual({
      id: '1111111111',
      idExtractionSource: 'react-current-props',
      candidateCount: 1,
      activeMarkerFound: true,
    });
  });

  it('chooses viewer.current.media.mediaId over many items[].pk', () => {
    const scan = structuredScan({
      viewer: { current: { media: { mediaId: '2222222222' } } },
      items: [{ pk: '4000000001' }, { pk: '4000000002' }, { pk: '4000000003' }],
    });
    expect(resolveCurrentStoryId(scan)).toEqual({
      id: '2222222222',
      idExtractionSource: 'react-current-props',
      candidateCount: 1,
      activeMarkerFound: true,
    });
  });

  it('refuses ids only inside plural items[] with no current marker', () => {
    const scan = structuredScan({
      items: [{ mediaId: '3333333333' }, { mediaId: '4444444444' }],
    });
    expect(resolveCurrentStoryId(scan)).toEqual({
      idExtractionSource: 'none',
      candidateCount: 0,
      activeMarkerFound: false,
    });
  });

  it('refuses user.pk and reel container ids', () => {
    const scan = structuredScan({
      user: { pk: '5555555555' },
      reel: { id: '6666666666' },
    });
    expect(resolveCurrentStoryId(scan)).toEqual({
      idExtractionSource: 'none',
      candidateCount: 0,
      activeMarkerFound: false,
    });
  });

  it('refuses two different current-like paths with different ids', () => {
    const scan = structuredScan({
      current: { mediaId: '1111111111' },
      viewer: { current: { media: { mediaId: '2222222222' } } },
    });
    expect(resolveCurrentStoryId(scan)).toEqual({
      idExtractionSource: 'none',
      candidateCount: 'many',
      activeMarkerFound: false,
    });
  });

  it('accepts the same id reached through two current-like aliases once', () => {
    const scan = structuredScan({
      current: { mediaId: '1111111111' },
      viewer: { current: { media: { mediaId: '1111111111' } } },
    });
    expect(resolveCurrentStoryId(scan)).toEqual({
      id: '1111111111',
      idExtractionSource: 'react-current-props',
      candidateCount: 1,
      activeMarkerFound: true,
    });
  });

  it('never selects a structured id unless the active root is proven', () => {
    const candidates = collectStoryIdCandidates([
      { current: { mediaId: '1111111111' } },
    ]).candidates;
    expect(
      resolveCurrentStoryId({
        evidence: [],
        activeRoot: 'ambiguous',
        reactCandidates: candidates,
      }),
    ).toEqual({
      idExtractionSource: 'none',
      candidateCount: 0,
      activeMarkerFound: false,
    });
    expect(
      resolveCurrentStoryId({
        evidence: [],
        activeRoot: 'none',
        reactCandidates: candidates,
      }),
    ).toEqual({
      idExtractionSource: 'none',
      candidateCount: 0,
      activeMarkerFound: false,
    });
  });

  it('ignores a candidate explicitly stamped outside the proven root', () => {
    const candidates = (
      collectStoryIdCandidates([{ current: { mediaId: '1111111111' } }])
        .candidates ?? []
    ).map((candidate) => ({ ...candidate, insideActiveRoot: false as const }));
    expect(selectStructuredCurrentStoryId(candidates)).toEqual({
      ok: false,
      reason: 'none',
    });
  });

  it('prints path shapes only, never candidate values', () => {
    const props = {
      current: { media: { mediaId: '7777777777' } },
      user: { pk: '8888888888' },
      items: [{ mediaId: '9999999999' }],
    };
    const structure = describeReactStoryIdStructure([
      { node: { __reactProps$test: props }, kind: 'descendant', depth: -1 },
    ]);
    expect(structure.candidatePathShapes).toEqual([
      'current.media.mediaId',
      'items[].mediaId',
      'user.pk',
    ]);
    const serialized = JSON.stringify(structure);
    for (const value of ['7777777777', '8888888888', '9999999999'])
      expect(serialized).not.toContain(value);
  });

  it('leaves the explicit-id / image-fallback path untouched when no current-item exists', () => {
    // A proven root with no current-rooted media path stays fail-closed, so the
    // explicit-id route and the visible-media image fallback behave as before.
    expect(
      resolveCurrentStoryId({
        evidence: [],
        activeRoot: 'proven',
        reactCandidates: [],
      }),
    ).toEqual({
      idExtractionSource: 'none',
      candidateCount: 0,
      activeMarkerFound: false,
    });
  });
});

describe('identity-source observation is diagnostic-only', () => {
  it('never lets identity-source diagnostics influence selection', () => {
    const scan: CurrentStoryIdScan = {
      evidence: [],
      activeRoot: 'proven',
      identitySources: {
        fiber: {
          root: true,
          parentDepths: [0],
          propKeys: ['current', 'mediaId'],
          stateKeys: [],
          handlerKeys: ['onClick'],
          childKinds: ['host'],
          candidatePathShapes: ['current.mediaId'],
        },
        links: {
          storyItemShape: true,
          reelShape: false,
          postShape: false,
          otherShape: false,
        },
        store: {
          found: true,
          shapeKeys: ['current'],
          candidatePathShapes: ['current.mediaId'],
        },
      },
    };
    expect(resolveCurrentStoryId(scan)).toEqual({
      idExtractionSource: 'none',
      candidateCount: 0,
      activeMarkerFound: false,
    });
  });
});

describe('current Story id extractor boundary', () => {
  const source = currentStoryIdScanFunction.toString();

  it.each([
    'reels_media',
    'reel_ids',
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

  it('reads only already-loaded page state in the required order', () => {
    const inline = source.indexOf('application/json');
    const hydration = source.indexOf('__additionalDataLoaded');
    const history = source.indexOf('history.state');
    const viewer = source.indexOf('getBoundingClientRect');
    expect(inline).toBeGreaterThanOrEqual(0);
    expect(hydration).toBeGreaterThan(inline);
    expect(history).toBeGreaterThan(hydration);
    expect(viewer).toBeGreaterThan(history);
  });

  it('reads bounded React props/state and a small bounded fiber radius', () => {
    expect(source).toContain('react-current-props');
    expect(source).toMatch(/__reactProps|__reactFiber|__reactInternalInstance/);
    expect(source).toContain('memoizedProps');
    // The fiber radius is explicitly bounded, never a whole-tree walk.
    expect(source).toContain('fiberDepth <= 6');
    expect(source).toContain('fiberVisited < 12');
    expect(source).toContain('parentDepths');
  });

  it('proves the active Story root and gates DOM evidence on it', () => {
    expect(source).toContain('activeRoot');
    // Viewer-relative proof, never >=50% of the whole viewport.
    expect(source).toContain('MIN_CARD_VISIBLE_RATIO');
    expect(source).toContain('MIN_CARD_VIEWER_AREA_RATIO');
    expect(source).toContain('ACTIVE_ZONE_RADIUS');
    expect(source).toContain('CENTER_MARGIN');
    expect(source).toContain('isRendered');
    // DOM-derived evidence is collected only from the bounded `chain`.
    expect(source).toContain('chain');
    expect(source).toMatch(/activeRoot === ["']proven["']/);
    // Neighbour cards stop the ancestor climb.
    expect(source).toContain('neighbour');
  });

  it('never fakes an active marker from a generic media id', () => {
    // Ordinary attributes/hrefs become strong media ids, not active ids.
    expect(source).toContain('media_id: value');
    expect(source).toMatch(/current\|active/i);
    // The old blanket `{ activeId: ... }` wrapping for every attribute is gone.
    expect(source).not.toMatch(
      /\/\(media\|story\|reel\|pk\|\^id\$\)\/i\.test\(attribute\.name\)\s*&&\s*numeric\.test\(attribute\.value\)\)\s*attributeValues\.push\(\{ activeId/,
    );
  });

  it('instruments sanitized per-source diagnostics with root scoping', () => {
    expect(source).toContain('sourceDiagnostics');
    expect(source).toContain('summarize');
    expect(source).toContain('strongCandidateCount');
    expect(source).toContain('activeCandidateCount');
    expect(source).toMatch(/['"]n\/a['"]/);
    // DOM-derived candidates are stamped as bounded to the proven root.
    expect(source).toContain('insideActiveRoot = true');
    expect(source).toContain('tiedToActiveMedia = true');
  });

  it('probes React attachment points on a bounded descendant set inside the root', () => {
    expect(source).toContain('describeReact');
    expect(source).toContain('reactKeyFound');
    expect(source).toContain('descendantReactKeyFound');
    expect(source).toContain('inspectedNodeKinds');
    expect(source).toContain('objectShapeHints');
    expect(source).toMatch(/kind:\s*['"]descendant['"]/);
    // The probe is neighbour-guarded and bounded, never a whole-viewer sweep.
    expect(source).toContain('neighbourElements');
    expect(source).toContain('count >= 400');
    // Descendants are diagnostic only: their React objects never enter the
    // generic selection evidence array.
    expect(source).toMatch(
      /for \(const object of reactKeysOf\(element\)\) reactValues\.push\(object\)/,
    );
  });

  it('emits sanitized React path shapes and proven-root structured candidates', () => {
    expect(source).toContain('candidatePathShapes');
    expect(source).toContain('pathShapeOf');
    expect(source).toContain('provenRootCandidates');
    expect(source).toContain('reactCandidates');
    // Structural candidates are stamped as bounded to the proven root.
    expect(source).toContain('insideActiveRoot: true');
    expect(source).toContain('tiedToActiveMedia: true');
  });

  it('adds observation-only identity-source probes scoped to the proven root', () => {
    expect(source).toContain('identitySources');
    expect(source).toContain('fiber');
    expect(source).toContain('links');
    expect(source).toContain('navigationApi');
    expect(source).toContain('mediaMeta');
    expect(source).toContain('store');
    // Bounded and never enumerating the profile/tray.
    expect(source).toContain('fiberDepth <= 6');
    expect(source).toContain('fiberVisited < 12');
    expect(source).toContain('storeNodes > 150');
    // The whole probe block is gated on the proven root.
    expect(source).toMatch(/activeRoot === ["']proven["'] && chain\.length/);
    expect(source).not.toContain('reel_ids');
    expect(source).not.toContain('reels_media');
    expect(source).not.toContain('feed/user');
  });
});

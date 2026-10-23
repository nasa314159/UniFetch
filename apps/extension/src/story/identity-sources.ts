import type {
  StoryFiberStructureDiagnostic,
  StoryLinkShapeDiagnostic,
  StoryMediaMetaDiagnostic,
  StoryNavigationStateDiagnostic,
  StoryPageStoreDiagnostic,
} from './contracts';
import { collectStoryIdCandidates, storyIdPathShape } from './current-id';

/**
 * M8D identity-source observation model. These probes describe WHERE a current
 * Story identity might be represented in already-loaded page state (React fiber
 * radius, in-card links, Navigation API state, media metadata, page store shape).
 *
 * Everything here is diagnostic-only: it never feeds `resolveCurrentStoryId`.
 * Output is structural (booleans, counts, relative depths, generic kind labels,
 * sanitized key NAMES and path shapes) and never a numeric id, value, URL,
 * username, caption, media URL, cookie or payload.
 */

/** Minimal fiber-like surface; property access only, never invocation. */
export interface FiberLike {
  return?: FiberLike | null;
  child?: FiberLike | null;
  sibling?: FiberLike | null;
  memoizedProps?: unknown;
  memoizedState?: unknown;
  type?: unknown;
}

/**
 * Recognized structural property names. Anything else is masked as `?` so an
 * arbitrary map key (record id, shortcode, username) can never leak.
 */
const structuralKeyNames = new Set<string>([
  // React/fiber plumbing
  'children',
  'props',
  'key',
  'ref',
  'type',
  'state',
  'memoizedprops',
  'memoizedstate',
  'pendingprops',
  'basestate',
  'queue',
  'next',
  'return',
  'child',
  'sibling',
  'memoized',
  'value',
  'elementtype',
  'index',
  'dependencies',
  'updatequeue',
  'alternate',
  'pending',
  'current',
  'active',
  // Instagram/story/media structure names
  'media',
  'mediaid',
  'media_id',
  'mediatype',
  'media_type',
  'mediadata',
  'mediainfo',
  'mediaitems',
  'story',
  'storyid',
  'story_id',
  'story_media_id',
  'storyitem',
  'story_item',
  'storyitems',
  'item',
  'items',
  'user',
  'username',
  'owner',
  'ownerid',
  'owner_id',
  'pk',
  'id',
  'reel',
  'reelid',
  'reel_id',
  'tray',
  'viewer',
  'storyviewer',
  'page',
  'data',
  'node',
  'edge',
  'edges',
  'playback',
  'video',
  'image',
  'url',
  'href',
  'caption',
  'timestamp',
  'takenat',
  'taken_at',
  'expiringat',
  'expiring_at',
  'duration',
  'width',
  'height',
  // media element / source / track metadata names
  'src',
  'srcset',
  'poster',
  'preload',
  'playsinline',
  'muted',
  'autoplay',
  'loop',
  'controls',
  'class',
  'classname',
  'style',
  'role',
  'target',
  'rel',
  'arialabel',
  'aria-label',
  'ariahidd',
  'aria-hidden',
  'tabindex',
  'decoding',
  'loading',
  'crossorigin',
  'referrerpolicy',
  'kind',
  'srclang',
  'label',
  'default',
  'type',
  'sizes',
  'media',
  'fetchpriority',
]);

/** Recognized structural name is kept as-is; everything else becomes `?`. */
export function structuralKeyName(name: string): string {
  if (/^on[A-Z]/.test(name)) return name;
  return structuralKeyNames.has(name) ||
    structuralKeyNames.has(name.toLowerCase())
    ? name
    : '?';
}

const MAX_FIBER_PARENTS = 6;
const MAX_FIBER_CHILDREN = 12;
const MAX_KEY_DEPTH = 3;
const MAX_KEY_NODES = 80;
const MAX_KEY_NAMES = 32;
const MAX_PATH_SHAPES = 24;

function collectFiberKeys(
  value: unknown,
  keys: Set<string>,
  handlers: Set<string>,
  shapes: Set<string>,
): void {
  for (const candidate of collectStoryIdCandidates([value]).candidates ?? []) {
    if (shapes.size < MAX_PATH_SHAPES)
      shapes.add(storyIdPathShape(candidate.keyPath));
  }
  const seen = new Set<unknown>();
  let nodes = 0;
  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_KEY_DEPTH || !node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    nodes += 1;
    if (nodes > MAX_KEY_NODES) return;
    const entries = Array.isArray(node)
      ? (node as unknown[]).map((entry) => ['', entry] as const)
      : Object.entries(node as Record<string, unknown>);
    for (const [key, entry] of entries) {
      if (key) {
        if (keys.size < MAX_KEY_NAMES) keys.add(structuralKeyName(key));
        if (/^on[A-Z]/.test(key)) handlers.add(key);
      }
      if (entry && typeof entry === 'object') walk(entry, depth + 1);
    }
  };
  walk(value, 0);
}

/** Generic label for one fiber's component type; never the component itself. */
export function fiberKind(fiber: FiberLike): string {
  const type = fiber.type;
  if (typeof type === 'string') return 'host';
  if (typeof type === 'function') {
    try {
      const prototype = (type as { prototype?: { isReactComponent?: unknown } })
        .prototype;
      if (prototype && prototype.isReactComponent) return 'class';
    } catch {
      // ignore exotic function shapes
    }
    return 'function';
  }
  return 'other';
}

/**
 * Bounded structural description of the fiber radius above/beside one fiber:
 * parent `return` chain, prop/state key NAMES, `on*` handler NAMES and a small
 * child/sibling kind radius. It never walks the whole tree, never invokes a
 * function and never returns a prop/state value.
 */
export function describeFiberStructure(
  fiber: FiberLike | null | undefined,
  options: { maxParents?: number; maxChildren?: number } = {},
): StoryFiberStructureDiagnostic {
  const propKeys = new Set<string>();
  const stateKeys = new Set<string>();
  const handlerKeys = new Set<string>();
  const pathShapes = new Set<string>();
  const parentDepths: number[] = [];
  let root = false;
  let cursor: FiberLike | null = fiber ?? null;
  let depth = 0;
  const maxParents = options.maxParents ?? MAX_FIBER_PARENTS;
  while (cursor && depth <= maxParents) {
    parentDepths.push(depth);
    if (cursor.memoizedProps !== undefined)
      collectFiberKeys(cursor.memoizedProps, propKeys, handlerKeys, pathShapes);
    if (cursor.memoizedState !== undefined)
      collectFiberKeys(
        cursor.memoizedState,
        stateKeys,
        handlerKeys,
        pathShapes,
      );
    const parent = cursor.return ?? null;
    if (!parent) {
      root = true;
      break;
    }
    cursor = parent;
    depth += 1;
  }
  const childKinds = new Set<string>();
  const queue: FiberLike[] = [];
  if (fiber?.child) queue.push(fiber.child);
  if (fiber?.sibling) queue.push(fiber.sibling);
  const maxChildren = options.maxChildren ?? MAX_FIBER_CHILDREN;
  let visited = 0;
  while (queue.length && visited < maxChildren) {
    const node = queue.shift() as FiberLike;
    visited += 1;
    childKinds.add(fiberKind(node));
    if (node.child) queue.push(node.child);
    if (node.sibling) queue.push(node.sibling);
  }
  return {
    root,
    parentDepths,
    propKeys: [...propKeys].sort(),
    stateKeys: [...stateKeys].sort(),
    handlerKeys: [...handlerKeys].sort(),
    childKinds: [...childKinds].sort(),
    childCount: visited,
    candidatePathShapes: [...pathShapes].sort(),
  };
}

export type StoryLinkShape = 'story-item' | 'reel' | 'post' | 'other';

const storyItemHref = /^\/stories\/[^/]+\/[0-9]{5,25}\/?(?:[?#]|$)/;
const reelHref = /^\/(?:reel|reels)\/[A-Za-z0-9_-]+\/?(?:[?#]|$)/;
const postHref = /^\/(?:p|tv)\/[A-Za-z0-9_-]+\/?(?:[?#]|$)/;

/** Classifies one href PATHNAME into a coarse shape; never returns the path. */
export function classifyLinkPathname(pathname: string): StoryLinkShape {
  if (storyItemHref.test(pathname)) return 'story-item';
  if (reelHref.test(pathname)) return 'reel';
  if (postHref.test(pathname)) return 'post';
  return 'other';
}

/** Sanitized shape flags for the link pathnames found inside the proven card. */
export function describeLinks(
  pathnames: readonly string[],
): StoryLinkShapeDiagnostic {
  const shapes = new Set(pathnames.map(classifyLinkPathname));
  return {
    storyItemShape: shapes.has('story-item'),
    reelShape: shapes.has('reel'),
    postShape: shapes.has('post'),
    otherShape: shapes.has('other'),
  };
}

/** Navigation API presence plus current-entry state key NAMES; never a URL. */
export function describeNavigationState(input: {
  navigationApi: boolean;
  entryState?: unknown;
}): StoryNavigationStateDiagnostic {
  const keys = new Set<string>();
  if (input.entryState && typeof input.entryState === 'object') {
    let count = 0;
    for (const key of Object.keys(
      input.entryState as Record<string, unknown>,
    )) {
      if (count >= 20) break;
      keys.add(structuralKeyName(key));
      count += 1;
    }
  }
  return {
    navigationApi: input.navigationApi,
    entryStateKeys: [...keys].sort(),
  };
}

/** Media element metadata NAMES only (dataset/attributes/source/track). */
export function describeMediaMeta(input: {
  datasetKeys?: readonly string[];
  attributeKeys?: readonly string[];
  sourceAttributeKeys?: readonly string[];
  trackAttributeKeys?: readonly string[];
  sourceCount?: number;
  trackCount?: number;
}): StoryMediaMetaDiagnostic {
  const names = (values: readonly string[] | undefined): string[] =>
    [...new Set((values ?? []).map(structuralKeyName))].sort().slice(0, 24);
  const bounded = (value: number | undefined): number =>
    Math.max(0, Math.min(20, value ?? 0));
  return {
    datasetKeys: names(input.datasetKeys),
    attributeKeys: names(input.attributeKeys),
    sourceAttributeKeys: names(input.sourceAttributeKeys),
    trackAttributeKeys: names(input.trackAttributeKeys),
    sourceCount: bounded(input.sourceCount),
    trackCount: bounded(input.trackCount),
  };
}

/** Already-loaded page store shape: key NAMES and masked candidate paths only. */
export function describePageStore(input: {
  found: boolean;
  shapeNames?: readonly string[];
  candidatePathShapes?: readonly string[];
}): StoryPageStoreDiagnostic {
  return {
    found: input.found,
    shapeKeys: [...new Set((input.shapeNames ?? []).map(structuralKeyName))]
      .sort()
      .slice(0, 32),
    candidatePathShapes: [...new Set(input.candidatePathShapes ?? [])]
      .sort()
      .slice(0, 24),
  };
}

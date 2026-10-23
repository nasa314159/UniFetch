import type {
  ActiveRootStatus,
  StoryIdExtractionDiagnostic,
  StoryIdExtractionSource,
  StoryIdSourceDiagnostic,
  StoryIdentitySourceDiagnostic,
  StoryReactNodeKind,
  StoryReactStructuralDiagnostic,
} from './contracts';

export type { StoryIdExtractionSource, StoryReactNodeKind };

/** Geometry of one candidate Story card, measured in viewport pixels. */
export interface StoryCardGeometry {
  /** False when display/visibility/opacity hides the card. */
  rendered: boolean;
  /** Full element area in px^2. */
  area: number;
  /** Viewport-clipped visible area in px^2. */
  visibleArea: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Story publisher exposed by this card's own header, if any. */
  owner?: string;
}

/** Rectangle of the actual Story viewer (dialog), in viewport pixels. */
export interface StoryViewerGeometry {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ActiveStoryRootSelection {
  status: ActiveRootStatus;
  /** Index into the provided candidates for the proven root. */
  index?: number;
  /** Publisher comparison for the proven card's own header, if exposed. */
  ownerMatch?: boolean;
}

// A card must be substantially visible relative to ITS OWN area (never >=50% of
// the whole browser viewport) and fill a share of the VIEWER, not the viewport.
const MIN_CARD_VISIBLE_RATIO = 0.5;
const MIN_CARD_VIEWER_AREA_RATIO = 0.2;
// The winner must sit within this normalized distance of the viewer center...
const ACTIVE_ZONE_RADIUS = 0.25;
// ...and its nearest runner-up must be at least this much farther to be clear.
const CENTER_MARGIN = 0.15;
// Panels overlapping above this IoU are the same card (e.g. a video + cover).
const SAME_CARD_IOU = 0.6;

function overlapRatio(a: StoryCardGeometry, b: StoryCardGeometry): number {
  const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const inter = ix * iy;
  const union = a.area + b.area - inter;
  return union > 0 ? inter / union : 0;
}

function centerDistance(
  card: StoryCardGeometry,
  viewerCenterX: number,
  viewerCenterY: number,
  viewerWidth: number,
  viewerHeight: number,
): number {
  const dx = ((card.left + card.right) / 2 - viewerCenterX) / viewerWidth;
  const dy = ((card.top + card.bottom) / 2 - viewerCenterY) / viewerHeight;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Proves the single central ActiveStoryRoot relative to the ACTUAL Story viewer
 * geometry, never DOM order and never "first visible media":
 * - a card must be rendered, substantially visible relative to its OWN area and
 *   occupy a share of the VIEWER (never >=50% of the whole browser viewport);
 * - same-card panels (e.g. a video and its own cover) collapse to one card;
 * - the winner must be centered in the viewer's active zone with a clearly
 *   farther runner-up, or carry a Story-header publisher matching the route;
 * - a card whose own header publisher differs from the route is rejected, and
 *   a repost/original creator is never mistaken for the Story publisher;
 * - anything ambiguous stays `ambiguous` so the identity boundary fails closed.
 */
export function selectActiveStoryRoot(
  candidates: readonly StoryCardGeometry[],
  viewer: StoryViewerGeometry,
  routeUsername?: string,
): ActiveStoryRootSelection {
  const viewerWidth = Math.max(1, viewer.right - viewer.left);
  const viewerHeight = Math.max(1, viewer.bottom - viewer.top);
  const viewerArea = viewerWidth * viewerHeight;
  const viewerCenterX = (viewer.left + viewer.right) / 2;
  const viewerCenterY = (viewer.top + viewer.bottom) / 2;
  const viable = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => {
      const ratio =
        candidate.area > 0 ? candidate.visibleArea / candidate.area : 0;
      return (
        candidate.rendered &&
        ratio >= MIN_CARD_VISIBLE_RATIO &&
        candidate.area >= viewerArea * MIN_CARD_VIEWER_AREA_RATIO
      );
    });
  if (viable.length === 0) return { status: 'none' };
  const kept: typeof viable = [];
  for (const entry of viable) {
    if (
      kept.some(
        (other) =>
          overlapRatio(other.candidate, entry.candidate) > SAME_CARD_IOU,
      )
    )
      continue;
    kept.push(entry);
  }
  const scored = kept.map((entry) => {
    const ownerMatchRaw = matchOwner(entry.candidate.owner, routeUsername);
    return {
      ...entry,
      distance: centerDistance(
        entry.candidate,
        viewerCenterX,
        viewerCenterY,
        viewerWidth,
        viewerHeight,
      ),
      ownerMatch: ownerMatchRaw === 'unknown' ? undefined : ownerMatchRaw,
    };
  });
  // A card whose own header publisher differs from the route is never the root.
  const eligible = scored.filter((entry) => entry.ownerMatch !== false);
  if (eligible.length === 0) return { status: 'ambiguous', ownerMatch: false };
  const byDistance = [...eligible].sort((a, b) => a.distance - b.distance);
  const best = byDistance[0];
  if (best.distance > ACTIVE_ZONE_RADIUS) return { status: 'none' };
  // A route-owner match on the card header strongly proves the root.
  if (best.ownerMatch === true)
    return { status: 'proven', index: best.index, ownerMatch: true };
  const inZone = byDistance.filter(
    (entry) => entry.distance <= ACTIVE_ZONE_RADIUS,
  );
  if (inZone.length !== 1) return { status: 'ambiguous' };
  const runnerUp = byDistance[1];
  if (runnerUp && runnerUp.distance - best.distance < CENTER_MARGIN)
    return { status: 'ambiguous' };
  return { status: 'proven', index: best.index };
}

/**
 * Case-insensitive owner comparison used for both the route publisher (extracted
 * candidate vs route) and the API response owner (response vs route). `unknown`
 * when either side is unavailable, so it never by itself proves or refutes.
 */
export function matchOwner(
  expected: string | undefined,
  actual: string | undefined,
): boolean | 'unknown' {
  if (!expected || !actual) return 'unknown';
  return expected.toLowerCase() === actual.toLowerCase();
}

/**
 * M8D current-Story id extraction. It inspects ONLY already-loaded page state,
 * in this order: inline `<script type="application/json">`, hydration/state
 * script tags, `history.state`, then the current active viewer's attributes.
 *
 * It never enumerates the Story tray/reel, never builds a Story list and never
 * touches cookies, session values or storage. An id is accepted only when the
 * source proves it: a single candidate, or one candidate with an explicit
 * active/current marker. Ambiguity is refused. The id is in-memory only.
 */
/**
 * Internal provenance for one numeric id candidate. The numeric `value` is used
 * only for selection and is NEVER serialized into a diagnostic.
 */
export interface StoryIdCandidate {
  /** Internal numeric id; never printed or persisted. */
  value: string;
  /** Key or attribute name that carried the id (name only, never a value). */
  key: string;
  /** Key-name trail only, e.g. `['items', '#0', 'media_id']`; no values. */
  keyPath: string[];
  /** Explicit current/active key or inside a current/active object. */
  active: boolean;
  /** Media/Story-specific key (`media_id`, `story_media_id`, ...). */
  strong: boolean;
  /** Relative inspector depth; present only for React-owned candidates. */
  depth?: number;
  /**
   * True when the candidate is attached to the active media element or a node
   * bounded inside the proven active root. Stamped only for DOM-derived sources.
   */
  tiedToActiveMedia?: boolean;
  /** Whether the candidate sits inside the proven active Story root. */
  insideActiveRoot?: boolean | 'unknown' | 'n/a';
}

export interface StoryIdEvidence {
  ids: string[];
  activeIds: string[];
  /**
   * Ids found under a media/Story-specific key (`media_id`, `story_media_id`,
   * ...). Unlike the generic `id`/`pk` keys these cannot be a user/comment id,
   * so a single strong id is provable evidence for the current media.
   */
  strongIds: string[];
  truncated: boolean;
  /**
   * Internal provenance, one entry per distinct candidate. Carries key names
   * and trails only; the numeric `value` never leaves the resolver.
   */
  candidates?: StoryIdCandidate[];
}

export interface StoryIdSourceEvidence extends StoryIdEvidence {
  source: Exclude<StoryIdExtractionSource, 'none'>;
}

export interface CurrentStoryIdScan {
  evidence: StoryIdSourceEvidence[];
  /** Proven state of the central active Story panel. */
  activeRoot?: ActiveRootStatus;
  /** Whether any accepted candidate originated inside the proven active root. */
  candidateInsideActiveRoot?: boolean | 'unknown';
  /** Whether the extracted candidate owner matched the route publisher. */
  routeOwnerMatch?: boolean | 'unknown';
  /** Sanitized per-source id-evidence structural diagnostics. */
  sourceDiagnostics?: StoryIdSourceDiagnostic[];
  /**
   * Internal candidates collected from the proven-root React subtree (chain +
   * bounded descendants). Values stay internal; only path/role are ever shown.
   */
  reactCandidates?: StoryIdCandidate[];
  /** Sanitized structural identity sources; observation-only, never selection. */
  identitySources?: StoryIdentitySourceDiagnostic;
}

export interface StoryIdResolution extends StoryIdExtractionDiagnostic {
  id?: string;
}

const idKeys = [
  'story_media_id',
  'story_id',
  'storyId',
  'media_id',
  'mediaId',
  'pk',
  'id',
] as const;

/** Media/Story-specific keys only; never the generic `pk`/`id`. */
const strongIdKeys = [
  'story_media_id',
  'story_id',
  'storyId',
  'media_id',
  'mediaId',
] as const;

const activeKeys = [
  'current_story_id',
  'active_story_id',
  'current_story_media_id',
  'active_story_media_id',
  'current_media_id',
  'active_media_id',
  'currentStoryId',
  'activeStoryId',
  'currentId',
  'activeId',
] as const;

/** A nested object under one of these keys is treated as the current item. */
const activeObjectKeys = [
  'current',
  'active',
  'currentstory',
  'activestory',
  'currentitem',
  'activeitem',
  'currentmedia',
  'activemedia',
  'current_story',
  'active_story',
  'current_media',
  'active_media',
] as const;

const numericId = /^[0-9]{5,25}$/;

const MAX_DEPTH = 10;
const MAX_NODES = 5000;
const MAX_IDS = 60;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Bounded collection of distinct numeric ids and any explicitly-marked active
 * id from one or more page-state values. Ids inside a `current`/`active` object
 * are also treated as active. Never collects arbitrary long numeric strings.
 * Each distinct candidate keeps internal provenance (key name and trail only).
 */
export function collectStoryIdCandidates(
  values: readonly unknown[],
): StoryIdEvidence {
  const ids = new Set<string>();
  const activeIds = new Set<string>();
  const strongIds = new Set<string>();
  const candidates: StoryIdCandidate[] = [];
  const seenCandidate = new Set<string>();
  const seen = new Set<unknown>();
  let nodes = 0;
  let truncated = false;
  const idKeySet = new Set<string>(idKeys);
  const strongKeySet = new Set<string>(strongIdKeys);
  const activeKeySet = new Set<string>(activeKeys);
  const activeObjectKeySet = new Set<string>(activeObjectKeys);
  const walk = (
    node: unknown,
    depth: number,
    active: boolean,
    path: string[],
  ): void => {
    if (truncated) return;
    if (depth > MAX_DEPTH || !node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    nodes += 1;
    if (nodes > MAX_NODES) {
      truncated = true;
      return;
    }
    const entries = Array.isArray(node)
      ? node.map((entry, index) => [`#${index}`, entry] as const)
      : Object.entries(node as Record<string, unknown>);
    for (const [key, entry] of entries) {
      const numericValue =
        typeof entry === 'number' && Number.isSafeInteger(entry)
          ? String(entry)
          : typeof entry === 'string'
            ? entry
            : undefined;
      const isActiveKey = activeKeySet.has(key);
      const isStrongKey = strongKeySet.has(key);
      if (
        (idKeySet.has(key) || isActiveKey) &&
        numericValue !== undefined &&
        numericId.test(numericValue)
      ) {
        ids.add(numericValue);
        if (isStrongKey) strongIds.add(numericValue);
        if (isActiveKey || active) activeIds.add(numericValue);
        if (!seenCandidate.has(`${key}\u0000${numericValue}`)) {
          seenCandidate.add(`${key}\u0000${numericValue}`);
          candidates.push({
            value: numericValue,
            key,
            keyPath: [...path, key].slice(-8),
            active: isActiveKey || active,
            strong: isStrongKey,
          });
        }
        if (ids.size > MAX_IDS) {
          truncated = true;
          return;
        }
      }
      if (entry && typeof entry === 'object') {
        const childActive = active || activeObjectKeySet.has(key.toLowerCase());
        walk(entry, depth + 1, childActive, [...path, key].slice(-8));
      }
      if (truncated) return;
    }
  };
  for (const value of values) walk(value, 0, false, []);
  return {
    ids: unique([...ids]),
    activeIds: unique([...activeIds]),
    strongIds: unique([...strongIds]),
    truncated,
    candidates,
  };
}

export function findStoryIdCandidates(value: unknown): StoryIdEvidence {
  return collectStoryIdCandidates([value]);
}

/**
 * Selects exactly one id from a single source's evidence. One explicitly-active
 * id wins; otherwise exactly one media/Story-specific strong id is accepted;
 * otherwise exactly one candidate is accepted. Multiple candidates or a
 * truncated scan are refused rather than picked arbitrarily.
 */
export function selectCurrentStoryId(
  evidence: StoryIdEvidence,
): { ok: true; id: string } | { ok: false; reason: 'none' | 'ambiguous' } {
  const ids = unique(evidence.ids);
  const active = unique(evidence.activeIds).filter((id) => ids.includes(id));
  const strong = unique(evidence.strongIds ?? []).filter((id) =>
    ids.includes(id),
  );
  if (evidence.truncated || active.length > 1)
    return { ok: false, reason: 'ambiguous' };
  if (active.length === 1) return { ok: true, id: active[0] };
  if (strong.length === 1) return { ok: true, id: strong[0] };
  if (ids.length === 1) return { ok: true, id: ids[0] };
  if (ids.length === 0) return { ok: false, reason: 'none' };
  return { ok: false, reason: 'ambiguous' };
}

function countOf(count: number): 0 | 1 | 'many' {
  if (count === 0) return 0;
  return count === 1 ? 1 : 'many';
}

export function candidateCountOf(evidence: StoryIdEvidence): 0 | 1 | 'many' {
  return countOf(unique(evidence.ids).length);
}

/**
 * Sanitized structural summary of one source's evidence. Counts are bucketed
 * none/one/many; no numeric id, username or URL is ever included.
 */
export function summarizeStoryIdEvidence(
  source: Exclude<StoryIdExtractionSource, 'none'>,
  evidence: StoryIdEvidence,
  insideActiveRoot: StoryIdSourceDiagnostic['insideActiveRoot'],
): StoryIdSourceDiagnostic {
  return {
    source,
    candidateCount: countOf(unique(evidence.ids).length),
    strongCandidateCount: countOf(unique(evidence.strongIds ?? []).length),
    activeCandidateCount: countOf(unique(evidence.activeIds ?? []).length),
    insideActiveRoot,
  };
}

/** One DOM/React node offered to the bounded structural inspector. */
export interface ReactInspectionNode {
  node: ReactNodeLike;
  kind: StoryReactNodeKind;
  /** Relative inspector depth; 0 is the active media element. */
  depth: number;
}

/**
 * Structural role of a numeric candidate, derived from its property PATH rather
 * than its key name alone. Only `current-item` may ever prove a current Story id.
 */
export type StoryIdPathRole = 'current-item' | 'rejected' | 'unrelated';

/** Segments that mark a current/active Story item in a React path. */
const currentMarkerSegments = new Set<string>([
  'current',
  'active',
  'currentstory',
  'activestory',
  'currentitem',
  'activeitem',
  'currentmedia',
  'activemedia',
  'current_story',
  'active_story',
  'current_media',
  'active_media',
]);

/** Singular containers that may sit between a current marker and its media id. */
const singularMediaSegments = new Set<string>([
  'media',
  'item',
  'story',
  'storyitem',
  'story_item',
  'mediaitem',
  'media_item',
  'node',
  'currentmedia',
  'activemedia',
  'currentitem',
  'activeitem',
  'currentstory',
  'activestory',
  'data',
  'props',
  'state',
  'viewer',
  'storyviewer',
  'story_viewer',
]);

/** Keys that may carry a media/Story id at the end of a current-rooted path. */
const mediaIdSegments = new Set<string>([
  'mediaid',
  'media_id',
  'story_media_id',
  'storyid',
  'story_id',
  'pk',
  'id',
]);

/** Containers that may NEVER prove a current Story id (owner/reel/collection). */
const rejectedContainerSegments = new Set<string>([
  'user',
  'owner',
  'profile',
  'tray',
  'reel',
  'reels',
  'reelid',
  'reel_id',
]);

/** Structural segment vocabulary used to sanitize path shapes. */
const structuralPathSegments = new Set<string>([
  ...currentMarkerSegments,
  ...singularMediaSegments,
  ...mediaIdSegments,
  ...rejectedContainerSegments,
  'items',
  'edges',
  'page',
  'playback',
]);

function isArrayIndexSegment(segment: string): boolean {
  return /^#\d+$/.test(segment);
}

/**
 * Sanitized property-path shape: recognizable structural segments are kept,
 * array indices collapse to `[]`, and any unrecognized segment is masked as
 * `?`. It never emits a numeric id, value, username or URL.
 */
export function storyIdPathShape(keyPath: readonly string[]): string {
  let shape = '';
  for (const segment of keyPath) {
    if (isArrayIndexSegment(segment)) {
      shape += '[]';
      continue;
    }
    const name =
      structuralPathSegments.has(segment) ||
      structuralPathSegments.has(segment.toLowerCase())
        ? segment
        : '?';
    shape = shape === '' ? name : `${shape}.${name}`;
  }
  return shape;
}

/**
 * Classifies a numeric candidate by the STRUCTURAL ROLE of its path:
 * - `current-item`: a media/Story id reachable through a path rooted at a
 *   `current`/`active` marker and composed only of singular media containers,
 *   e.g. `current.mediaId`, `current.media.mediaId`, `viewer.current.mediaId`.
 * - `rejected`: a recognized but non-proof path (`user.pk`, `owner.id`,
 *   `reel.id`, anything inside a plural `items[]`/array collection).
 * - `unrelated`: neither a current-rooted nor a recognized rejected path.
 */
export function classifyStoryIdPath(
  keyPath: readonly string[],
  key: string,
): StoryIdPathRole {
  const segments = (keyPath.length ? keyPath : [key]).map((segment) =>
    segment.toLowerCase(),
  );
  const finalKey = segments[segments.length - 1];
  let markerIndex = -1;
  for (let index = 0; index < segments.length; index += 1) {
    if (currentMarkerSegments.has(segments[index])) markerIndex = index;
  }
  if (markerIndex < 0) {
    return segments.some((segment) => rejectedContainerSegments.has(segment)) ||
      rejectedContainerSegments.has(finalKey)
      ? 'rejected'
      : 'unrelated';
  }
  const tail = segments.slice(markerIndex);
  if (
    tail.some(
      (segment) =>
        isArrayIndexSegment(segment) || rejectedContainerSegments.has(segment),
    )
  )
    return 'rejected';
  if (!mediaIdSegments.has(finalKey)) return 'unrelated';
  const between = segments.slice(markerIndex + 1, segments.length - 1);
  if (
    between.some(
      (segment) =>
        !singularMediaSegments.has(segment) &&
        !currentMarkerSegments.has(segment),
    )
  )
    return 'rejected';
  return 'current-item';
}

/**
 * Deterministic selection of exactly one structurally proven current Story
 * media id. Zero current-item candidates, or two distinct ids reached through
 * equally plausible current paths, is refused. It never picks first/last.
 */
export function selectStructuredCurrentStoryId(
  candidates: readonly StoryIdCandidate[] | undefined,
): { ok: true; id: string } | { ok: false; reason: 'none' | 'ambiguous' } {
  const ids = unique(
    (candidates ?? [])
      .filter(
        (candidate) =>
          candidate.insideActiveRoot !== false &&
          classifyStoryIdPath(candidate.keyPath, candidate.key) ===
            'current-item',
      )
      .map((candidate) => candidate.value),
  );
  if (ids.length === 0) return { ok: false, reason: 'none' };
  if (ids.length > 1) return { ok: false, reason: 'ambiguous' };
  return { ok: true, id: ids[0] };
}

/** Property NAMES that reveal object shape without revealing any value. */
const reactShapeHintKeys = new Set<string>([
  'media',
  'media_id',
  'mediaId',
  'story',
  'story_id',
  'storyId',
  'story_media_id',
  'reel',
  'reelId',
  'item',
  'items',
  'user',
  'owner',
  'ownerId',
  'current',
  'active',
  'data',
  'node',
  'edge',
  'edges',
  'props',
  'state',
  'playback',
  'page',
  'viewer',
  'storyViewer',
  'tray',
  'pk',
  'id',
]);

const MAX_SHAPE_HINTS = 24;
const MAX_SHAPE_DEPTH = 3;
const MAX_PATH_SHAPES = 32;

/** Bounded property-NAME-only shape hints; never reads or returns values. */
function collectShapeHints(value: unknown): string[] {
  const names = new Set<string>();
  const seen = new Set<unknown>();
  let nodes = 0;
  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_SHAPE_DEPTH || !node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    nodes += 1;
    if (nodes > 60 || names.size >= MAX_SHAPE_HINTS) return;
    const entries = Array.isArray(node)
      ? (node as unknown[]).map((entry) => ['', entry] as const)
      : Object.entries(node as Record<string, unknown>);
    for (const [key, entry] of entries) {
      if (key && reactShapeHintKeys.has(key)) names.add(key);
      if (entry && typeof entry === 'object') walk(entry, depth + 1);
    }
  };
  walk(value, 0);
  return [...names].sort();
}

function reactObjectsOf(node: ReactNodeLike): unknown[] {
  const objects: unknown[] = [];
  let keys: string[];
  try {
    keys = Object.keys(node);
  } catch {
    return objects;
  }
  for (const key of keys) {
    if (!/^__(reactProps|reactFiber|reactInternalInstance)\$/.test(key))
      continue;
    const value = node[key];
    if (!value || typeof value !== 'object') continue;
    if (key.startsWith('__reactProps$') || key.startsWith('__reactInternal')) {
      objects.push(value);
      continue;
    }
    const fiber = value as Record<string, unknown>;
    if (fiber.memoizedProps) objects.push(fiber.memoizedProps);
    if (fiber.pendingProps) objects.push(fiber.pendingProps);
    if (fiber.memoizedState) objects.push(fiber.memoizedState);
  }
  return objects;
}

/**
 * Bounded structural description of the React attachments found on the supplied
 * nodes. It exposes node KIND labels, candidate KEY NAMES, relative depths and
 * property-name-only shape hints. It never returns a prop/state value, a numeric
 * id, a URL or a username, and it never traverses a React tree: only the React
 * keys attached to the exact nodes handed to it.
 */
export function describeReactStoryIdStructure(
  nodes: readonly ReactInspectionNode[],
): StoryReactStructuralDiagnostic {
  let reactKeyFound = false;
  let descendantReactKeyFound = false;
  const kinds = new Set<StoryReactNodeKind>();
  const keyNames = new Set<string>();
  const pathShapes = new Set<string>();
  const depths = new Set<number>();
  const shapes = new Set<string>();
  let shapeBudgetReached = false;
  for (const entry of nodes) {
    kinds.add(entry.kind);
    let hasReact = false;
    for (const object of reactObjectsOf(entry.node)) {
      hasReact = true;
      const found = collectStoryIdCandidates([object]).candidates ?? [];
      for (const candidate of found) {
        keyNames.add(candidate.key);
        depths.add(entry.depth);
        if (pathShapes.size < MAX_PATH_SHAPES)
          pathShapes.add(storyIdPathShape(candidate.keyPath));
      }
      if (!shapeBudgetReached) {
        for (const hint of collectShapeHints(object)) shapes.add(hint);
        if (shapes.size >= MAX_SHAPE_HINTS) shapeBudgetReached = true;
      }
    }
    if (hasReact) {
      reactKeyFound = true;
      if (entry.kind === 'descendant') descendantReactKeyFound = true;
    }
  }
  return {
    reactKeyFound,
    descendantReactKeyFound,
    inspectedNodeKinds: [...kinds],
    candidateKeyNames: [...keyNames].sort(),
    candidatePathShapes: [...pathShapes].sort(),
    candidateDepths: [...depths].sort((a, b) => a - b),
    objectShapeHints: [...shapes].sort(),
  };
}

/**
 * Resolves one current Story id from the ordered per-source evidence, with a
 * sanitized diagnostic. When the active root is PROVEN, a structurally proven
 * current-item id from the bounded React subtree wins first: exactly one id
 * reachable through a `current`/`active`-rooted media path is accepted, while
 * two distinct current-item ids stay refused. Otherwise the sources are tried
 * in injection order; the first source that proves a single current id wins.
 */
export function resolveCurrentStoryId(
  scan: CurrentStoryIdScan,
): StoryIdResolution {
  if (scan.activeRoot === 'proven') {
    const structured = selectStructuredCurrentStoryId(scan.reactCandidates);
    if (structured.ok)
      return {
        id: structured.id,
        idExtractionSource: 'react-current-props',
        candidateCount: 1,
        activeMarkerFound: true,
      };
    if (structured.reason === 'ambiguous')
      return {
        idExtractionSource: 'none',
        candidateCount: 'many',
        activeMarkerFound: false,
      };
  }
  let fallbackCount: 0 | 1 | 'many' = 0;
  let activeMarkerFound = false;
  for (const evidence of scan.evidence) {
    const active = unique(evidence.activeIds).filter((id) =>
      unique(evidence.ids).includes(id),
    );
    if (active.length > 0) activeMarkerFound = true;
    const selected = selectCurrentStoryId(evidence);
    if (selected.ok)
      return {
        id: selected.id,
        idExtractionSource: evidence.source,
        candidateCount: candidateCountOf(evidence),
        activeMarkerFound,
      };
    const count = candidateCountOf(evidence);
    if (count === 'many' || evidence.truncated) fallbackCount = 'many';
    else if (count === 1 && fallbackCount === 0) fallbackCount = 1;
  }
  return {
    idExtractionSource: 'none',
    candidateCount: fallbackCount,
    activeMarkerFound,
  };
}

/** Legacy single-id search over a bounded state object (kept for recovery). */
export function findStoryIdInState(value: unknown): string | undefined {
  const selected = selectCurrentStoryId(findStoryIdCandidates(value));
  return selected.ok ? selected.id : undefined;
}

/** Minimal element-like shape for the pure React-props traversal (testable). */
export interface ReactNodeLike {
  [key: string]: unknown;
  parentElement?: ReactNodeLike | null;
}

/**
 * Bounded, active-scoped collection of Story ids from the React-owned props and
 * state attached to the currently active viewer/media node and its bounded
 * ancestors. It never walks the React tree (no child/return/sibling traversal)
 * and never reads the whole page: only the node's own React keys plus
 * `memoizedProps`/`pendingProps`/`memoizedState` of its fiber chain.
 *
 * Proof still comes from `findStoryIdCandidates`: exactly one id, one strong
 * (media/Story-specific) id, or one explicitly active/current marker. Multiple
 * unrelated ids are refused.
 */
export function collectReactStoryIdEvidence(
  element: ReactNodeLike | null,
  maxAncestors = 8,
): StoryIdEvidence {
  const values: unknown[] = [];
  const seen = new Set<unknown>();
  let node: ReactNodeLike | null = element;
  let depth = 0;
  while (node && depth <= maxAncestors && !seen.has(node)) {
    seen.add(node);
    for (const object of reactObjectsOf(node)) values.push(object);
    node = (node.parentElement ?? null) as ReactNodeLike | null;
    depth += 1;
  }
  return collectStoryIdCandidates(values);
}

/**
 * Injected in the page (MAIN world) as `func`. Self-contained: it must not
 * close over module scope and never touches cookies, storage or other origins.
 */
export function currentStoryIdScanFunction(
  routeUsername?: string,
): CurrentStoryIdScan {
  const idKeySet = new Set([
    'story_media_id',
    'story_id',
    'storyId',
    'media_id',
    'mediaId',
    'pk',
    'id',
  ]);
  const activeKeySet = new Set([
    'current_story_id',
    'active_story_id',
    'current_story_media_id',
    'active_story_media_id',
    'current_media_id',
    'active_media_id',
    'currentStoryId',
    'activeStoryId',
    'currentId',
    'activeId',
  ]);
  const activeObjectKeySet = new Set([
    'current',
    'active',
    'currentstory',
    'activestory',
    'currentitem',
    'activeitem',
    'currentmedia',
    'activemedia',
    'current_story',
    'active_story',
    'current_media',
    'active_media',
  ]);
  const numeric = /^[0-9]{5,25}$/;
  const maxDepth = 10;
  const maxNodes = 5000;
  const maxIds = 60;
  const strongKeySet = new Set([
    'story_media_id',
    'story_id',
    'storyId',
    'media_id',
    'mediaId',
  ]);
  const countOf = (count: number): 0 | 1 | 'many' => {
    if (count === 0) return 0;
    return count === 1 ? 1 : 'many';
  };
  const collect = (values: readonly unknown[]): StoryIdEvidence => {
    const ids = new Set<string>();
    const activeIds = new Set<string>();
    const strongIds = new Set<string>();
    const candidates: StoryIdCandidate[] = [];
    const seenCandidate = new Set<string>();
    const seen = new Set<unknown>();
    let nodes = 0;
    let truncated = false;
    const visit = (
      node: unknown,
      depth: number,
      active: boolean,
      path: string[],
    ): void => {
      if (truncated || depth > maxDepth || !node || typeof node !== 'object')
        return;
      if (seen.has(node)) return;
      seen.add(node);
      nodes += 1;
      if (nodes > maxNodes) {
        truncated = true;
        return;
      }
      const entries = Array.isArray(node)
        ? node.map((entry, index) => [`#${index}`, entry] as const)
        : Object.entries(node as Record<string, unknown>);
      for (const [key, entry] of entries) {
        const numericValue =
          typeof entry === 'number' && Number.isSafeInteger(entry)
            ? String(entry)
            : typeof entry === 'string'
              ? entry
              : undefined;
        const isActiveKey = activeKeySet.has(key);
        const isStrongKey = strongKeySet.has(key);
        if (
          (idKeySet.has(key) || isActiveKey) &&
          numericValue !== undefined &&
          numeric.test(numericValue)
        ) {
          ids.add(numericValue);
          if (isStrongKey) strongIds.add(numericValue);
          if (isActiveKey || active) activeIds.add(numericValue);
          if (!seenCandidate.has(`${key}\u0000${numericValue}`)) {
            seenCandidate.add(`${key}\u0000${numericValue}`);
            candidates.push({
              value: numericValue,
              key,
              keyPath: [...path, key].slice(-8),
              active: isActiveKey || active,
              strong: isStrongKey,
            });
          }
          if (ids.size > maxIds) {
            truncated = true;
            return;
          }
        }
        if (entry && typeof entry === 'object') {
          const childActive =
            active || activeObjectKeySet.has(key.toLowerCase());
          visit(entry, depth + 1, childActive, [...path, key].slice(-8));
        }
        if (truncated) return;
      }
    };
    for (const value of values) visit(value, 0, false, []);
    return {
      ids: [...ids],
      activeIds: [...activeIds],
      strongIds: [...strongIds],
      truncated,
      candidates,
    };
  };
  const reactKeysOf = (element: Element): unknown[] => {
    const objects: unknown[] = [];
    let keys: string[];
    try {
      keys = Object.keys(element);
    } catch {
      return objects;
    }
    for (const key of keys) {
      if (!/^__(reactProps|reactFiber|reactInternalInstance)\$/.test(key))
        continue;
      const value = (element as unknown as Record<string, unknown>)[key];
      if (!value || typeof value !== 'object') continue;
      if (
        key.indexOf('__reactProps$') === 0 ||
        key.indexOf('__reactInternal') === 0
      ) {
        objects.push(value);
        continue;
      }
      const fiber = value as Record<string, unknown>;
      if (fiber.memoizedProps) objects.push(fiber.memoizedProps);
      if (fiber.pendingProps) objects.push(fiber.pendingProps);
      if (fiber.memoizedState) objects.push(fiber.memoizedState);
    }
    return objects;
  };
  const shapeHintKeys = new Set([
    'media',
    'media_id',
    'mediaId',
    'story',
    'story_id',
    'storyId',
    'story_media_id',
    'reel',
    'reelId',
    'item',
    'items',
    'user',
    'owner',
    'ownerId',
    'current',
    'active',
    'data',
    'node',
    'edge',
    'edges',
    'props',
    'state',
    'playback',
    'page',
    'viewer',
    'storyViewer',
    'tray',
    'pk',
    'id',
  ]);
  const shapeHintsOf = (value: unknown): string[] => {
    const names = new Set<string>();
    const shapeSeen = new Set<unknown>();
    let shapeNodes = 0;
    const shapeWalk = (shapeNode: unknown, shapeDepth: number): void => {
      if (shapeDepth > 3 || !shapeNode || typeof shapeNode !== 'object') return;
      if (shapeSeen.has(shapeNode)) return;
      shapeSeen.add(shapeNode);
      shapeNodes += 1;
      if (shapeNodes > 60 || names.size >= 24) return;
      const entries = Array.isArray(shapeNode)
        ? (shapeNode as unknown[]).map((entry) => ['', entry] as const)
        : Object.entries(shapeNode as Record<string, unknown>);
      for (const [key, entry] of entries) {
        if (key && shapeHintKeys.has(key)) names.add(key);
        if (entry && typeof entry === 'object')
          shapeWalk(entry, shapeDepth + 1);
      }
    };
    shapeWalk(value, 0);
    return [...names].sort();
  };
  const pathShapeSegments = new Set([
    'current',
    'active',
    'currentstory',
    'activestory',
    'currentitem',
    'activeitem',
    'currentmedia',
    'activemedia',
    'current_story',
    'active_story',
    'current_media',
    'active_media',
    'media',
    'item',
    'story',
    'storyitem',
    'story_item',
    'mediaitem',
    'media_item',
    'node',
    'data',
    'props',
    'state',
    'viewer',
    'storyviewer',
    'story_viewer',
    'mediaid',
    'media_id',
    'story_media_id',
    'storyid',
    'story_id',
    'pk',
    'id',
    'user',
    'owner',
    'profile',
    'tray',
    'reel',
    'reels',
    'reelid',
    'reel_id',
    'items',
    'edges',
    'page',
    'playback',
  ]);
  const pathShapeOf = (keyPath: string[]): string => {
    let shape = '';
    for (const segment of keyPath) {
      if (/^#\d+$/.test(segment)) {
        shape += '[]';
        continue;
      }
      const name =
        pathShapeSegments.has(segment) ||
        pathShapeSegments.has(segment.toLowerCase())
          ? segment
          : '?';
      shape = shape === '' ? name : `${shape}.${name}`;
    }
    return shape;
  };
  // Internal candidates from the proven-root React subtree; used by the pure
  // structured current-item selection and never serialized into diagnostics.
  const provenRootCandidates: StoryIdCandidate[] = [];
  // Bounded structural React description. It only reads the React keys attached
  // to the exact nodes handed to it; it never walks a React tree and never
  // returns a prop/state value, numeric id, URL or username.
  const describeReact = (
    nodes: { element: Element; kind: StoryReactNodeKind; depth: number }[],
  ): StoryReactStructuralDiagnostic | undefined => {
    const kinds = new Set<StoryReactNodeKind>();
    const keyNames = new Set<string>();
    const pathShapes = new Set<string>();
    const depths = new Set<number>();
    const shapes = new Set<string>();
    let reactKeyFound = false;
    let descendantReactKeyFound = false;
    for (const entry of nodes) {
      kinds.add(entry.kind);
      const objects = reactKeysOf(entry.element);
      if (objects.length) {
        reactKeyFound = true;
        if (entry.kind === 'descendant') descendantReactKeyFound = true;
      }
      for (const object of objects) {
        for (const candidate of collect([object]).candidates ?? []) {
          keyNames.add(candidate.key);
          depths.add(entry.depth);
          if (pathShapes.size < 32)
            pathShapes.add(pathShapeOf(candidate.keyPath));
          if (provenRootCandidates.length < 200)
            provenRootCandidates.push({
              ...candidate,
              depth: entry.depth,
              insideActiveRoot: true,
              tiedToActiveMedia: true,
            });
        }
        for (const hint of shapeHintsOf(object)) shapes.add(hint);
      }
    }
    return {
      reactKeyFound,
      descendantReactKeyFound,
      inspectedNodeKinds: [...kinds],
      candidateKeyNames: [...keyNames].sort(),
      candidatePathShapes: [...pathShapes].sort(),
      candidateDepths: [...depths].sort((a, b) => a - b),
      objectShapeHints: [...shapes].sort(),
    };
  };
  const summarize = (
    source: StoryIdSourceEvidence['source'],
    result: StoryIdEvidence,
    inside: true | false | 'unknown' | 'n/a',
  ) => ({
    source,
    candidateCount: countOf([...new Set(result.ids)].length),
    strongCandidateCount: countOf([...new Set(result.strongIds)].length),
    activeCandidateCount: countOf([...new Set(result.activeIds)].length),
    insideActiveRoot: inside,
  });
  const extractEmbeddedJson = (text: string): unknown => {
    const start = text.search(/[[{]/);
    if (start < 0) return undefined;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escape) escape = false;
        else if (char === '\\') escape = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{' || char === '[') depth += 1;
      else if (char === '}' || char === ']') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, index + 1));
          } catch {
            return undefined;
          }
        }
      }
    }
    return undefined;
  };
  const evidence: StoryIdSourceEvidence[] = [];
  const sourceDiagnostics: StoryIdSourceDiagnostic[] = [];
  const addEvidence = (
    source: StoryIdSourceEvidence['source'],
    values: readonly unknown[],
    inside: true | false | 'unknown' | 'n/a',
  ): StoryIdEvidence => {
    const result = values.length
      ? collect(values)
      : {
          ids: [],
          activeIds: [],
          strongIds: [],
          truncated: false,
          candidates: [],
        };
    // DOM-derived candidates are, by construction, bounded to the proven root
    // and tied to the active media element; page-state candidates are not.
    if (inside === true)
      for (const candidate of result.candidates ?? []) {
        candidate.insideActiveRoot = true;
        candidate.tiedToActiveMedia = true;
      }
    if (result.ids.length || result.activeIds.length || result.truncated)
      evidence.push({ source, ...result });
    sourceDiagnostics.push(summarize(source, result, inside));
    return result;
  };
  // 1. Inline JSON page state already present in the document.
  const inlineValues: unknown[] = [];
  for (const script of Array.from(
    document.querySelectorAll('script[type="application/json"]'),
  ).slice(0, 8)) {
    const text = script.textContent;
    if (!text) continue;
    try {
      inlineValues.push(JSON.parse(text));
    } catch {
      // not JSON; ignore
    }
  }
  addEvidence('html-inline-json', inlineValues, 'n/a');
  // 2. Hydration/state script tags.
  const hydrationValues: unknown[] = [];
  const hydrationPattern =
    /__additionalDataLoaded|_sharedData|__initialData|__PRELOADED|__NEXT_DATA__|PolarisStoriesV3/;
  for (const script of Array.from(document.scripts).slice(0, 60)) {
    const type = script.getAttribute('type');
    if (type && /json/i.test(type)) continue;
    const text = script.textContent;
    if (!text || text.length > 2_000_000) continue;
    if (!hydrationPattern.test(text)) continue;
    const parsed = extractEmbeddedJson(text);
    if (parsed !== undefined) hydrationValues.push(parsed);
    if (hydrationValues.length >= 4) break;
  }
  addEvidence('hydration-state', hydrationValues, 'n/a');
  // 3. Current router/history state.
  try {
    addEvidence('history-state', [history.state], 'n/a');
  } catch {
    // ignore and continue
  }
  // 4. Prove the central ActiveStoryRoot from the ACTUAL Story viewer geometry.
  //    No DOM order is used: a card must be rendered, substantially visible
  //    relative to ITS OWN area (never >=50% of the whole viewport), and sit in
  //    the viewer's active zone with a clearly farther runner-up, or carry a
  //    Story-header publisher matching the route. When the root cannot be
  //    proven, NO DOM-derived id (React props or attributes) is trusted at all,
  //    so username-only resolution fails closed.
  const viewportWidth = window.innerWidth || 0;
  const viewportHeight = window.innerHeight || 0;
  const isRendered = (element: Element): boolean => {
    try {
      const check = (
        element as Element & {
          checkVisibility?: (options?: {
            checkOpacity?: boolean;
            checkVisibilityCSS?: boolean;
          }) => boolean;
        }
      ).checkVisibility;
      if (typeof check === 'function')
        return element.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
        });
    } catch {
      // fall through to the manual ancestor walk
    }
    for (let node: Element | null = element; node; node = node.parentElement) {
      try {
        const style = getComputedStyle(node);
        if (style.display === 'none') return false;
        if (style.visibility === 'hidden' || style.visibility === 'collapse')
          return false;
        if (Number(style.opacity) === 0) return false;
        if (style.contentVisibility === 'hidden') return false;
      } catch {
        return false;
      }
    }
    return true;
  };
  const dialog = document.querySelector('[role="dialog"]');
  const scope: Element | null = dialog ?? document.body;
  const visibleAreaOf = (rect: DOMRect): number => {
    const ix = Math.max(
      0,
      Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0),
    );
    const iy = Math.max(
      0,
      Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0),
    );
    return ix * iy;
  };
  const overlapOf = (a: DOMRect, b: DOMRect): number => {
    const ix = Math.max(
      0,
      Math.min(a.right, b.right) - Math.max(a.left, b.left),
    );
    const iy = Math.max(
      0,
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
    );
    const inter = ix * iy;
    const union = a.width * a.height + b.width * b.height - inter;
    return union > 0 ? inter / union : 0;
  };
  // The active Story viewer rectangle is the dialog itself, else the viewport.
  let viewerRect: DOMRect | undefined;
  try {
    if (dialog) viewerRect = dialog.getBoundingClientRect();
  } catch {
    viewerRect = undefined;
  }
  const viewerLeft = viewerRect && viewerRect.width > 0 ? viewerRect.left : 0;
  const viewerTop = viewerRect && viewerRect.height > 0 ? viewerRect.top : 0;
  const viewerRight =
    viewerRect && viewerRect.width > 0 ? viewerRect.right : viewportWidth;
  const viewerBottom =
    viewerRect && viewerRect.height > 0 ? viewerRect.bottom : viewportHeight;
  type Panel = {
    element: Element;
    rect: DOMRect;
    area: number;
    visibleArea: number;
    isVideo: boolean;
  };
  const panels: Panel[] = [];
  try {
    if (scope) {
      for (const element of Array.from(scope.querySelectorAll('video, img'))) {
        if (!isRendered(element)) continue;
        const rect = element.getBoundingClientRect();
        const area = rect.width * rect.height;
        if (area <= 0) continue;
        const visibleArea = visibleAreaOf(rect);
        if (visibleArea <= 0) continue;
        panels.push({
          element,
          rect,
          area,
          visibleArea,
          isVideo: element.tagName.toLowerCase() === 'video',
        });
      }
    }
  } catch {
    // ignore and continue
  }
  // Prefer the actual video over its own still cover so an image + video card
  // collapses to one root when it is deduped below.
  panels.sort((a, b) =>
    a.isVideo === b.isVideo ? b.area - a.area : a.isVideo ? -1 : 1,
  );
  // ActiveStoryRoot proof relative to the Story VIEWER, not the whole viewport.
  const MIN_CARD_VISIBLE_RATIO = 0.5;
  const MIN_CARD_VIEWER_AREA_RATIO = 0.2;
  const ACTIVE_ZONE_RADIUS = 0.25;
  const CENTER_MARGIN = 0.15;
  const SAME_CARD_IOU = 0.6;
  const viewerWidth = Math.max(1, viewerRight - viewerLeft);
  const viewerHeight = Math.max(1, viewerBottom - viewerTop);
  const viewerArea = viewerWidth * viewerHeight;
  const viewerCenterX = (viewerLeft + viewerRight) / 2;
  const viewerCenterY = (viewerTop + viewerBottom) / 2;
  const cardOverlap = (
    a: {
      left: number;
      top: number;
      right: number;
      bottom: number;
      area: number;
    },
    b: {
      left: number;
      top: number;
      right: number;
      bottom: number;
      area: number;
    },
  ): number => {
    const ix = Math.max(
      0,
      Math.min(a.right, b.right) - Math.max(a.left, b.left),
    );
    const iy = Math.max(
      0,
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
    );
    const inter = ix * iy;
    const union = a.area + b.area - inter;
    return union > 0 ? inter / union : 0;
  };
  const cardDistance = (card: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }): number => {
    const dx = ((card.left + card.right) / 2 - viewerCenterX) / viewerWidth;
    const dy = ((card.top + card.bottom) / 2 - viewerCenterY) / viewerHeight;
    return Math.sqrt(dx * dx + dy * dy);
  };
  const ownerMatches = (owner: string | undefined): boolean | 'unknown' => {
    if (!owner || !routeUsername) return 'unknown';
    return owner.toLowerCase() === routeUsername.toLowerCase();
  };
  // Bound each card to its own container: climb while the ancestor subtree holds
  // no other non-overlapping card-sized media, so neighbour cards never enter.
  const chainFor = (panel: Panel): Element[] => {
    let root: Element = panel.element;
    let node: Element | null = panel.element.parentElement;
    for (
      let depth = 0;
      node && depth < 6;
      depth += 1, node = node.parentElement
    ) {
      if (node === document.body || node === document.documentElement) break;
      if (dialog && !dialog.contains(node)) break;
      let neighbour = false;
      try {
        for (const other of Array.from(node.querySelectorAll('video, img'))) {
          if (other === panel.element || panel.element.contains(other))
            continue;
          if (!isRendered(other)) continue;
          const otherRect = other.getBoundingClientRect();
          if (otherRect.width * otherRect.height < panel.area * 0.25) continue;
          if (overlapOf(otherRect, panel.rect) > 0.6) continue;
          neighbour = true;
          break;
        }
      } catch {
        neighbour = true;
      }
      if (neighbour) break;
      root = node;
    }
    const chain: Element[] = [];
    for (
      let current: Element | null = panel.element;
      current;
      current = current.parentElement
    ) {
      chain.push(current);
      if (current === root) break;
    }
    return chain;
  };
  // The Story publisher is exposed by a `/stories/<name>/` header link scoped to
  // the card's own bounded chain. Never a repost/original creator, never a URL,
  // and the name never leaves this function.
  const storyHeaderHref = /\/stories\/([A-Za-z0-9._]+)\/?(?:[?#]|$)/;
  const headerOwner = (chain: Element[]): string | undefined => {
    const names = new Set<string>();
    for (const element of chain) {
      let anchors: Element[];
      try {
        anchors = Array.from(element.querySelectorAll('a[href]'));
      } catch {
        continue;
      }
      for (const anchor of anchors) {
        const match = storyHeaderHref.exec(anchor.getAttribute('href') || '');
        if (!match) continue;
        names.add(match[1]);
      }
    }
    return names.size === 1 ? [...names][0] : undefined;
  };
  const cards = panels.map((panel) => {
    const cardChain = chainFor(panel);
    return {
      rendered: true,
      area: panel.area,
      visibleArea: panel.visibleArea,
      left: panel.rect.left,
      top: panel.rect.top,
      right: panel.rect.right,
      bottom: panel.rect.bottom,
      chain: cardChain,
      owner: headerOwner(cardChain),
    };
  });
  type Card = (typeof cards)[number];
  const eligibleCards = cards.filter((card) => {
    const ratio = card.area > 0 ? card.visibleArea / card.area : 0;
    return (
      card.rendered &&
      ratio >= MIN_CARD_VISIBLE_RATIO &&
      card.area >= viewerArea * MIN_CARD_VIEWER_AREA_RATIO
    );
  });
  const dedupedCards: Card[] = [];
  for (const card of eligibleCards) {
    if (dedupedCards.some((kept) => cardOverlap(kept, card) > SAME_CARD_IOU))
      continue;
    dedupedCards.push(card);
  }
  const scoredCards = dedupedCards.map((card) => ({
    card,
    distance: cardDistance(card),
    ownerMatch: ownerMatches(card.owner),
  }));
  const eligibleScored = scoredCards.filter(
    (entry) => entry.ownerMatch !== false,
  );
  let activeRoot: 'proven' | 'ambiguous' | 'none' = 'none';
  let routeOwnerMatch: boolean | 'unknown' = 'unknown';
  let chain: Element[] = [];
  if (eligibleScored.length === 0) {
    if (scoredCards.length > 0) {
      activeRoot = 'ambiguous';
      routeOwnerMatch = false;
    }
  } else {
    const byDistance = [...eligibleScored].sort(
      (a, b) => a.distance - b.distance,
    );
    const best = byDistance[0];
    if (best.distance > ACTIVE_ZONE_RADIUS) {
      activeRoot = 'none';
    } else if (best.ownerMatch === true) {
      activeRoot = 'proven';
      routeOwnerMatch = true;
      chain = best.card.chain;
    } else {
      const inZone = byDistance.filter(
        (entry) => entry.distance <= ACTIVE_ZONE_RADIUS,
      );
      const runnerUp = byDistance[1];
      if (
        inZone.length === 1 &&
        (!runnerUp || runnerUp.distance - best.distance >= CENTER_MARGIN)
      ) {
        activeRoot = 'proven';
        chain = best.card.chain;
      } else {
        activeRoot = 'ambiguous';
      }
    }
  }
  // 5. React-owned props/state, but ONLY inside the proven active root. No React
  //    tree traversal: only the node's own React keys plus memoizedProps/
  //    pendingProps/memoizedState of its fiber. A hidden/adjacent sibling is
  //    never reached.
  //
  //    DIAGNOSTIC + STRUCTURED: a bounded set of DESCENDANTS of the proven card
  //    root is additionally inspected. Their React objects never enter the
  //    generic `reactValues` union (that stays chain-only), but they DO feed the
  //    structured current-item classifier via `provenRootCandidates`, which only
  //    accepts a single id reached through a `current`/`active`-rooted media
  //    path. Everything else stays fail-closed.
  type InspectNode = {
    element: Element;
    kind: StoryReactNodeKind;
    depth: number;
  };
  const inspectionNodes: InspectNode[] = [];
  const reactValues: unknown[] = [];
  if (activeRoot === 'proven') {
    chain.forEach((element, index) => {
      const kind =
        index === 0
          ? 'media'
          : index === chain.length - 1
            ? 'card-root'
            : index === 1
              ? 'wrapper'
              : 'ancestor';
      inspectionNodes.push({ element, kind, depth: index });
      for (const object of reactKeysOf(element)) reactValues.push(object);
    });
    // Neighbour guard: never descend into another card-sized, non-overlapping
    // media subtree inside the proven root.
    const rootElement = chain[chain.length - 1];
    const mediaElement = chain[0];
    let mediaArea = 0;
    let mediaRect: DOMRect | undefined;
    try {
      mediaRect = mediaElement.getBoundingClientRect();
      mediaArea = mediaRect.width * mediaRect.height;
    } catch {
      mediaArea = 0;
    }
    const neighbourElements: Element[] = [];
    if (rootElement && mediaRect && mediaArea > 0) {
      try {
        for (const other of Array.from(
          rootElement.querySelectorAll('video, img'),
        )) {
          if (
            other === mediaElement ||
            mediaElement.contains(other) ||
            other.contains(mediaElement)
          )
            continue;
          if (!isRendered(other)) continue;
          const otherRect = other.getBoundingClientRect();
          if (otherRect.width * otherRect.height < mediaArea * 0.25) continue;
          if (overlapOf(otherRect, mediaRect) > 0.6) continue;
          neighbourElements.push(other);
        }
      } catch {
        // bounded; ignore
      }
    }
    if (rootElement) {
      try {
        let count = 0;
        for (const element of Array.from(rootElement.querySelectorAll('*'))) {
          if (count >= 400) break;
          if (chain.includes(element)) continue;
          let neighbour = false;
          for (const other of neighbourElements) {
            if (element === other || element.contains(other)) {
              neighbour = true;
              break;
            }
          }
          if (neighbour) continue;
          let domDepth = 0;
          for (
            let node: Element | null = element;
            node && node !== rootElement;
            node = node.parentElement
          )
            domDepth += 1;
          if (domDepth > 8) continue;
          inspectionNodes.push({
            element,
            kind: 'descendant',
            depth: -domDepth,
          });
          count += 1;
        }
      } catch {
        // bounded; ignore
      }
    }
  }
  addEvidence(
    'react-current-props',
    reactValues,
    activeRoot === 'proven' ? true : false,
  );
  const reactDiagnostic = sourceDiagnostics.find(
    (entry) => entry.source === 'react-current-props',
  );
  if (reactDiagnostic) reactDiagnostic.react = describeReact(inspectionNodes);
  // 6. Attributes/hrefs, but ONLY inside the proven active root. An attribute is
  //    an active marker only when its own name says current/active; ordinary
  //    media ids are strong but never active, so a stray neighbour id can never
  //    fake an active marker.
  const storyHref = /\/stories\/[A-Za-z0-9._]+\/([0-9]{5,25})\/?(?:[?#]|$)/;
  const attributeValues: unknown[] = [];
  if (activeRoot === 'proven') {
    for (const element of chain) {
      let attributes: Attr[];
      try {
        attributes = Array.from(element.attributes);
      } catch {
        continue;
      }
      for (const attribute of attributes) {
        const name = attribute.name;
        const value = attribute.value;
        if (numeric.test(value)) {
          if (/(current|active)/i.test(name))
            attributeValues.push({ activeId: value });
          else if (/(media|story|reel|pk|^id$)/i.test(name))
            attributeValues.push({ media_id: value });
        }
        if (name === 'href') {
          const match = storyHref.exec(value);
          if (match) attributeValues.push({ media_id: match[1] });
        }
      }
    }
  }
  addEvidence(
    'viewer-attribute',
    attributeValues,
    activeRoot === 'proven' ? true : false,
  );
  // 7. OBSERVATION-ONLY structural probes. None of these feed current-id
  //    selection; they only expose WHERE an identity might be represented.
  //    Every probe is scoped to the proven active root and tightly bounded.
  const identitySources: StoryIdentitySourceDiagnostic = {};
  if (activeRoot === 'proven' && chain.length) {
    const structuralKeys = new Set([
      'children',
      'props',
      'key',
      'ref',
      'type',
      'state',
      'memoizedProps',
      'memoizedState',
      'pendingProps',
      'baseState',
      'queue',
      'next',
      'return',
      'child',
      'sibling',
      'memoized',
      'value',
      'elementType',
      'index',
      'dependencies',
      'updateQueue',
      'alternate',
      'pending',
      'current',
      'active',
      'media',
      'mediaId',
      'media_id',
      'mediaType',
      'media_type',
      'mediaData',
      'mediaInfo',
      'mediaItems',
      'story',
      'storyId',
      'story_id',
      'story_media_id',
      'storyItem',
      'story_item',
      'storyItems',
      'item',
      'items',
      'user',
      'username',
      'owner',
      'ownerId',
      'owner_id',
      'pk',
      'id',
      'reel',
      'reelId',
      'reel_id',
      'tray',
      'viewer',
      'storyViewer',
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
      'takenAt',
      'taken_at',
      'expiringAt',
      'expiring_at',
      'duration',
      'width',
      'height',
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
      'className',
      'style',
      'role',
      'target',
      'rel',
      'aria-label',
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
      'sizes',
      'fetchpriority',
    ]);
    const keyNameOf = (name: string): string =>
      /^on[A-Z]/.test(name) ||
      structuralKeys.has(name) ||
      structuralKeys.has(name.toLowerCase())
        ? name
        : '?';
    const collectKeyNames = (
      value: unknown,
      keys: Set<string>,
      handlers: Set<string>,
      shapes: Set<string>,
    ): void => {
      for (const candidate of collect([value]).candidates ?? []) {
        if (shapes.size < 24) shapes.add(pathShapeOf(candidate.keyPath));
      }
      const seenKeys = new Set<unknown>();
      let nodes = 0;
      const walkKeys = (node: unknown, depth: number): void => {
        if (
          depth > 3 ||
          !node ||
          typeof node !== 'object' ||
          seenKeys.has(node)
        )
          return;
        seenKeys.add(node);
        nodes += 1;
        if (nodes > 80) return;
        const entries = Array.isArray(node)
          ? (node as unknown[]).map((entry) => ['', entry] as const)
          : Object.entries(node as Record<string, unknown>);
        for (const [key, entry] of entries) {
          if (key) {
            if (keys.size < 32) keys.add(keyNameOf(key));
            if (/^on[A-Z]/.test(key)) handlers.add(key);
          }
          if (entry && typeof entry === 'object') walkKeys(entry, depth + 1);
        }
      };
      walkKeys(value, 0);
    };
    const mediaElement = chain[0];
    // 7a. Bounded fiber radius above/beside the media/card fiber.
    const fiberOf = (element: Element): unknown => {
      try {
        for (const key of Object.keys(element)) {
          if (/^__(reactFiber|reactInternalInstance)\$/.test(key))
            return (element as unknown as Record<string, unknown>)[key];
        }
      } catch {
        // ignore
      }
      return undefined;
    };
    const fiber = fiberOf(mediaElement);
    if (fiber && typeof fiber === 'object') {
      const fiberNode = fiber as Record<string, unknown>;
      const propKeys = new Set<string>();
      const stateKeys = new Set<string>();
      const handlerKeys = new Set<string>();
      const fiberShapes = new Set<string>();
      const parentDepths: number[] = [];
      let cursor: Record<string, unknown> | null = fiberNode;
      let fiberRoot = false;
      let fiberDepth = 0;
      const kindOf = (node: Record<string, unknown>): string => {
        const type = node.type;
        if (typeof type === 'string') return 'host';
        if (typeof type === 'function') return 'function';
        return 'other';
      };
      while (cursor && fiberDepth <= 6) {
        parentDepths.push(fiberDepth);
        if (cursor.memoizedProps)
          collectKeyNames(
            cursor.memoizedProps,
            propKeys,
            handlerKeys,
            fiberShapes,
          );
        if (cursor.memoizedState)
          collectKeyNames(
            cursor.memoizedState,
            stateKeys,
            handlerKeys,
            fiberShapes,
          );
        const parent = cursor.return as
          Record<string, unknown> | null | undefined;
        if (!parent) {
          fiberRoot = true;
          break;
        }
        cursor = parent;
        fiberDepth += 1;
      }
      const childKinds = new Set<string>();
      const fiberQueue: Record<string, unknown>[] = [];
      if (fiberNode.child && typeof fiberNode.child === 'object')
        fiberQueue.push(fiberNode.child as Record<string, unknown>);
      if (fiberNode.sibling && typeof fiberNode.sibling === 'object')
        fiberQueue.push(fiberNode.sibling as Record<string, unknown>);
      let fiberVisited = 0;
      while (fiberQueue.length && fiberVisited < 12) {
        const node = fiberQueue.shift() as Record<string, unknown>;
        fiberVisited += 1;
        childKinds.add(kindOf(node));
        if (node.child && typeof node.child === 'object')
          fiberQueue.push(node.child as Record<string, unknown>);
        if (node.sibling && typeof node.sibling === 'object')
          fiberQueue.push(node.sibling as Record<string, unknown>);
      }
      identitySources.fiber = {
        root: fiberRoot,
        parentDepths,
        propKeys: [...propKeys].sort(),
        stateKeys: [...stateKeys].sort(),
        handlerKeys: [...handlerKeys].sort(),
        childKinds: [...childKinds].sort(),
        childCount: fiberVisited,
        candidatePathShapes: [...fiberShapes].sort(),
      };
    }
    // 7b. Links inside the proven card: path SHAPES only.
    const storyItemLink = /^\/stories\/[^/]+\/[0-9]{5,25}\/?(?:[?#]|$)/;
    const reelLink = /^\/(?:reel|reels)\/[A-Za-z0-9_-]+\/?(?:[?#]|$)/;
    const postLink = /^\/(?:p|tv)\/[A-Za-z0-9_-]+\/?(?:[?#]|$)/;
    const linkShapes = new Set<string>();
    for (const entry of inspectionNodes) {
      let anchors: Element[];
      try {
        anchors = Array.from(entry.element.querySelectorAll('a[href]')).slice(
          0,
          40,
        );
      } catch {
        continue;
      }
      for (const anchor of anchors) {
        const href = anchor.getAttribute('href');
        if (!href) continue;
        let pathname = href;
        try {
          pathname = new URL(href, location.href).pathname;
        } catch {
          // keep the relative path
        }
        linkShapes.add(
          storyItemLink.test(pathname)
            ? 'story-item'
            : reelLink.test(pathname)
              ? 'reel'
              : postLink.test(pathname)
                ? 'post'
                : 'other',
        );
      }
    }
    identitySources.links = {
      storyItemShape: linkShapes.has('story-item'),
      reelShape: linkShapes.has('reel'),
      postShape: linkShapes.has('post'),
      otherShape: linkShapes.has('other'),
    };
    // 7c. Navigation API current-entry state key names; never a URL.
    const navStateKeys = new Set<string>();
    let navigationApi = false;
    try {
      const navigation = (
        window as unknown as {
          navigation?: { currentEntry?: { state?: unknown } };
        }
      ).navigation;
      if (navigation && typeof navigation === 'object') {
        navigationApi = true;
        const state = navigation.currentEntry?.state;
        if (state && typeof state === 'object') {
          let navCount = 0;
          for (const key of Object.keys(state as Record<string, unknown>)) {
            if (navCount >= 20) break;
            navStateKeys.add(keyNameOf(key));
            navCount += 1;
          }
        }
      }
    } catch {
      // ignore
    }
    identitySources.nav = {
      navigationApi,
      entryStateKeys: [...navStateKeys].sort(),
    };
    // 7d. Media element metadata: NAMES only.
    const metadataNames = (values: Iterable<string>): string[] => {
      const names = new Set<string>();
      for (const value of values) {
        if (names.size >= 24) break;
        names.add(keyNameOf(value));
      }
      return [...names].sort();
    };
    const mediaNode = mediaElement as HTMLVideoElement &
      HTMLImageElement & { dataset?: DOMStringMap };
    let mediaAttributeNames: string[] = [];
    try {
      mediaAttributeNames = metadataNames(
        Array.from(mediaNode.attributes).map((attribute) => attribute.name),
      );
    } catch {
      mediaAttributeNames = [];
    }
    let datasetNames: string[] = [];
    try {
      datasetNames = mediaNode.dataset
        ? metadataNames(Object.keys(mediaNode.dataset))
        : [];
    } catch {
      datasetNames = [];
    }
    const sourceElements: Element[] = [];
    const trackElements: Element[] = [];
    try {
      for (const source of Array.from(mediaNode.querySelectorAll('source'))) {
        if (sourceElements.length >= 20) break;
        sourceElements.push(source);
      }
      for (const track of Array.from(mediaNode.querySelectorAll('track'))) {
        if (trackElements.length >= 20) break;
        trackElements.push(track);
      }
    } catch {
      // ignore
    }
    const attributeNamesOf = (elements: Element[]): string[] => {
      const names = new Set<string>();
      for (const element of elements) {
        try {
          for (const attribute of Array.from(element.attributes)) {
            if (names.size >= 24) break;
            names.add(keyNameOf(attribute.name));
          }
        } catch {
          // ignore
        }
      }
      return [...names].sort();
    };
    identitySources.mediaMeta = {
      datasetKeys: datasetNames,
      attributeKeys: mediaAttributeNames,
      sourceAttributeKeys: attributeNamesOf(sourceElements),
      trackAttributeKeys: attributeNamesOf(trackElements),
      sourceCount: sourceElements.length,
      trackCount: trackElements.length,
    };
    // 7e. Already-loaded page store shape. No fetch/XHR, no monkey-patching,
    //     no request replay; only a fixed allowlist of page-owned globals.
    const storeShapeNames = new Set<string>();
    const storeShapes = new Set<string>();
    let storeFound = false;
    const storeHandles = [
      '__RELAY_STORE__',
      '__APOLLO_STATE__',
      '__INITIAL_STATE__',
      '__PRELOADED_STATE__',
      '_sharedData',
      '__additionalDataLoaded',
    ];
    for (const handle of storeHandles) {
      let value: unknown;
      try {
        value = (window as unknown as Record<string, unknown>)[handle];
      } catch {
        continue;
      }
      if (!value || typeof value !== 'object') continue;
      storeFound = true;
      for (const candidate of collect([value]).candidates ?? []) {
        if (storeShapes.size < 24)
          storeShapes.add(pathShapeOf(candidate.keyPath));
      }
      const seenStore = new Set<unknown>();
      let storeNodes = 0;
      const walkStore = (node: unknown, depth: number): void => {
        if (
          depth > 3 ||
          !node ||
          typeof node !== 'object' ||
          seenStore.has(node)
        )
          return;
        seenStore.add(node);
        storeNodes += 1;
        if (storeNodes > 150) return;
        const entries = Array.isArray(node)
          ? (node as unknown[]).map((entry) => ['', entry] as const)
          : Object.entries(node as Record<string, unknown>);
        for (const [key, entry] of entries) {
          if (key && storeShapeNames.size < 32)
            storeShapeNames.add(keyNameOf(key));
          if (entry && typeof entry === 'object') walkStore(entry, depth + 1);
        }
      };
      walkStore(value, 0);
    }
    identitySources.store = {
      found: storeFound,
      shapeKeys: [...storeShapeNames].sort(),
      candidatePathShapes: [...storeShapes].sort(),
    };
  }
  return {
    evidence,
    activeRoot,
    candidateInsideActiveRoot: activeRoot === 'proven' ? true : 'unknown',
    routeOwnerMatch,
    sourceDiagnostics,
    reactCandidates: provenRootCandidates,
    identitySources,
  };
}

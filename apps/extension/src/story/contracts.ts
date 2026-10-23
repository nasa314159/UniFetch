import type { TimestampCandidateTrace } from './timestamp';

/**
 * M8B sanitized Story feasibility model. Every field is non-identifying: no
 * username, story ID, full URL, CDN media URL, caption, cookie or session data.
 */
export type StoryAcquisitionContext = 'background' | 'isolated' | 'main';

export type StoryFeasibilityStatus =
  | 'SUCCESS'
  | 'HTTP_ERROR'
  | 'LOGIN_REQUIRED'
  | 'GRAPHQL_EXECUTION_ERROR'
  | 'PARSER_OUTDATED'
  | 'NETWORK_ERROR'
  | 'BROWSER_RESTRICTION'
  | 'UNSUPPORTED_CONTENT'
  | 'UNKNOWN';

/** Internal, non-identifying trace of which resolution path produced an asset. */
export type StorySource =
  'explicit-id-url' | 'current-id-page-state' | 'visible-current-media';

/** Sanitized shape of the active Story viewer DOM. */
export type ViewerShape = 'dialog' | 'document-story-viewer' | 'other';

/** Sanitized classification of the currently visible Story media source. */
export type VisibleMediaDiagnostic =
  'image-http' | 'video-http' | 'video-blob' | 'ambiguous' | 'none';

/** Sanitized MSE/source classification for a currently visible video. */
export type MseSource =
  'direct-http-video' | 'segmented-media' | 'blob-only' | 'unknown';

/** Sanitized source of a current Story id, if one was obtained. */
export type StoryIdExtractionSource =
  | 'html-inline-json'
  | 'hydration-state'
  | 'history-state'
  /** React-owned props/state attached to the active viewer/media node. */
  | 'react-current-props'
  | 'viewer-attribute'
  | 'none';

/** Sanitized id-extraction diagnostic; never an id, username or URL. */
export interface StoryIdExtractionDiagnostic {
  idExtractionSource: StoryIdExtractionSource;
  candidateCount: 0 | 1 | 'many';
  activeMarkerFound: boolean;
}

/** Generic structural label for one DOM node inspected for React evidence. */
export type StoryReactNodeKind =
  'media' | 'wrapper' | 'ancestor' | 'card-root' | 'descendant';

/**
 * Sanitized structural React evidence for the proven active root. Key NAMES,
 * node KIND labels, relative depths and property-name hints only: no numeric
 * id, prop value, state value, URL, username or raw JSON.
 */
export interface StoryReactStructuralDiagnostic {
  /** True when any inspected node carried a React attachment key. */
  reactKeyFound: boolean;
  /** True when a bounded DESCENDANT of the card root carried a React key. */
  descendantReactKeyFound: boolean;
  inspectedNodeKinds: StoryReactNodeKind[];
  /** Key names that carried a numeric candidate (names only, no values). */
  candidateKeyNames: string[];
  /**
   * Sanitized property-path shapes of each numeric candidate, e.g.
   * `current.media.mediaId`, `viewer.current.mediaId`, `items[].mediaId`,
   * `user.pk`, `reelId`. Structural segment names and `[]` only: no numeric id,
   * value, username or URL.
   */
  candidatePathShapes: string[];
  /** Relative inspector depth of each inspected node carrying a candidate. */
  candidateDepths: number[];
  /** Property-name-only shape hints (e.g. `media`, `story`, `reel`). */
  objectShapeHints: string[];
}

/**
 * Sanitized per-source id-evidence structural diagnostic. Counts are bucketed
 * none/one/many and never expose the underlying numeric ids.
 */
export interface StoryIdSourceDiagnostic {
  source: Exclude<StoryIdExtractionSource, 'none'>;
  candidateCount: 0 | 1 | 'many';
  strongCandidateCount: 0 | 1 | 'many';
  activeCandidateCount: 0 | 1 | 'many';
  /** Whether the source's evidence sits inside the proven active Story root. */
  insideActiveRoot: true | false | 'unknown' | 'n/a';
  /** Present only for the React-owned props/state source. */
  react?: StoryReactStructuralDiagnostic;
}

/**
 * Bounded fiber structure around the proven card/media fiber. Structure only:
 * booleans, relative depths, generic kind labels, sanitized key NAMES and
 * path shapes. No prop/state value, numeric id, URL, username or payload.
 */
export interface StoryFiberStructureDiagnostic {
  /** True when a fiber with no parent (`return`) was reached within bound. */
  root: boolean;
  /** Relative parent-fiber depths visited (0 = the start fiber). */
  parentDepths: number[];
  /** Sanitized `memoizedProps` key names across the visited radius. */
  propKeys: string[];
  /** Sanitized `memoizedState` key names across the visited radius. */
  stateKeys: string[];
  /** `on*` handler prop NAMES only (never the functions). */
  handlerKeys: string[];
  /** Generic kinds of a bounded child/sibling radius (`host`, `function`...). */
  childKinds: string[];
  /** Number of child/sibling fibers visited (bounded). */
  childCount: number;
  /** Sanitized path shapes of numeric media/story candidates in props/state. */
  candidatePathShapes: string[];
}

/** Sanitized classification of links found INSIDE the proven card. */
export interface StoryLinkShapeDiagnostic {
  storyItemShape: boolean;
  reelShape: boolean;
  postShape: boolean;
  otherShape: boolean;
}

/** Navigation API / router state key names; never a URL. */
export interface StoryNavigationStateDiagnostic {
  navigationApi: boolean;
  entryStateKeys: string[];
}

/** Media element metadata: dataset/attribute/source/track NAMES only. */
export interface StoryMediaMetaDiagnostic {
  datasetKeys: string[];
  attributeKeys: string[];
  sourceAttributeKeys: string[];
  trackAttributeKeys: string[];
  sourceCount: number;
  trackCount: number;
}

/** Already-loaded page store shape: key NAMES and candidate path shapes only. */
export interface StoryPageStoreDiagnostic {
  found: boolean;
  shapeKeys: string[];
  candidatePathShapes: string[];
}

/**
 * Sanitized structural diagnostic for identity-bearing state that is currently
 * INSPECTED but does NOT yet influence selection. Every field is structural.
 */
export interface StoryIdentitySourceDiagnostic {
  fiber?: StoryFiberStructureDiagnostic;
  links?: StoryLinkShapeDiagnostic;
  nav?: StoryNavigationStateDiagnostic;
  mediaMeta?: StoryMediaMetaDiagnostic;
  store?: StoryPageStoreDiagnostic;
}

/** Sanitized proof state of the central currently-displayed Story panel. */
export type ActiveRootStatus = 'proven' | 'ambiguous' | 'none';

/** Identity-integrity outcome for a proposed current Story id. */
export type StoryIdentityResult = 'proven' | 'unproven' | 'mismatch';

export interface StoryFeasibilityResult {
  status: StoryFeasibilityStatus;
  httpStatus?: number;
  responseKind?: 'JSON' | 'HTML' | 'EMPTY';
  itemCount?: number;
  assetTypes?: ('image' | 'video')[];
  acquisitionContext?: StoryAcquisitionContext;
  /** Internal trace only; never a URL, username or Story id. */
  storySource?: StorySource;
  /** Sanitized visible-media diagnostic; never a URL. */
  visibleMedia?: VisibleMediaDiagnostic;
  /** Sanitized viewer-shape diagnostic; never a URL. */
  viewerShape?: ViewerShape;
  /** Sanitized id-extraction source; never a Story id. */
  idExtractionSource?: StoryIdExtractionSource;
  /** Sanitized candidate count: none/one/many. */
  candidateCount?: 0 | 1 | 'many';
  /** Whether an explicit active/current marker was found. */
  activeMarkerFound?: boolean;
  /** Sanitized per-source id-evidence structural diagnostics. */
  idEvidence?: StoryIdSourceDiagnostic[];
  /** Sanitized structural identity sources; observation-only, never selection. */
  identitySources?: StoryIdentitySourceDiagnostic;
  /** Proven state of the central active Story panel. */
  activeRoot?: ActiveRootStatus;
  /** Whether the accepted id originated inside the proven active root. */
  candidateInsideActiveRoot?: boolean | 'unknown';
  /** Whether the extracted owner matched the route publisher account. */
  routeOwnerMatch?: boolean | 'unknown';
  /** Whether the API response owner matched the route publisher account. */
  responseOwnerMatch?: boolean | 'unknown';
  /** Overall identity-integrity outcome; never exposes an identity. */
  identityResult?: StoryIdentityResult;
  /** Sanitized MSE source classification; never a URL. */
  mseSource?: MseSource;
  /** Best-effort audio presence for the current video. */
  audioPresent?: boolean | 'unknown';
  /** Typed internal reason when only MSE/segmented playback is available. */
  mseReason?: 'MSE_MEDIA_UNAVAILABLE';
  /** Sanitized time-field provenance; field names and kinds only. */
  timestampSources?: TimestampCandidateTrace[];
}

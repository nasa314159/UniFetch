import type { TimestampCandidateTrace } from './timestamp';

/**
 * Stable Story model. Every field is non-identifying: no username, Story id,
 * full URL, CDN media URL, caption, cookie or session data.
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

/**
 * The only supported Story source is an explicit media id in the URL. A
 * username-only `/stories/<username>/` URL has no source trace because it is
 * refused before any request is made.
 */
export type StorySource = 'explicit-id-url';

/** Identity-integrity outcome for a proposed Story. */
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
  /** Whether the API response owner matched the route publisher account. */
  responseOwnerMatch?: boolean | 'unknown';
  /** Overall identity-integrity outcome; never exposes an identity. */
  identityResult?: StoryIdentityResult;
  /** Sanitized time-field provenance; field names and kinds only. */
  timestampSources?: TimestampCandidateTrace[];
}

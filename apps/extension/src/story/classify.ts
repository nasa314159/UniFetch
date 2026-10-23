import { UniFetchError, type MediaAsset } from '@unifetch/core';
import { inspectInstagramGraphql } from '@unifetch/meta-resolver/instagram';
import type { RawStrategyOutcome } from '../contracts';
import type {
  ActiveRootStatus,
  StoryAcquisitionContext,
  StoryFeasibilityResult,
  StoryFeasibilityStatus,
  StoryIdentityResult,
  StorySource,
} from './contracts';
import type { StoryFilenameMetadata } from './filename';
import { normalizeInstagramStory } from './normalize';
import { parseInstagramStoryResponse } from './parser';

/**
 * Identity-integrity decision for a Story that is about to be exposed or
 * downloaded. A username-only (`current-id-page-state`) id is only `proven`
 * when the central active Story panel was proven, or the API response owner
 * independently matched the route publisher. Any explicit owner mismatch is a
 * `mismatch`. Everything unprovable is `unproven` and must download nothing.
 */
export function resolveStoryIdentity(input: {
  storySource: StorySource;
  activeRoot?: ActiveRootStatus;
  routeOwnerMatch?: boolean | 'unknown';
  responseOwnerMatch?: boolean | 'unknown';
}): StoryIdentityResult {
  if (input.routeOwnerMatch === false || input.responseOwnerMatch === false)
    return 'mismatch';
  // An explicit id URL is authoritative; the visible-media path is bounded to
  // the central active media by its own geometry gate.
  if (
    input.storySource === 'explicit-id-url' ||
    input.storySource === 'visible-current-media'
  )
    return 'proven';
  if (input.responseOwnerMatch === true || input.activeRoot === 'proven')
    return 'proven';
  return 'unproven';
}

/**
 * M8C: the sanitized feasibility result plus, only on success with exactly one
 * current item, the single normalized media asset that feeds the existing
 * downloader. The asset is kept out of `result` so no CDN URL, username or
 * Story id can leak into the sanitized summary.
 */
export interface StoryResolveResult {
  result: StoryFeasibilityResult;
  asset?: MediaAsset;
  /**
   * Internal-only response owner (Story publisher). Never included in `result`.
   * Used solely to verify the resolved Story belongs to the route publisher.
   */
  ownerUsername?: string;
}

function mapAcquisitionCategory(
  category: string | undefined,
): StoryFeasibilityStatus {
  switch (category) {
    case 'LOGIN_REQUIRED':
      return 'LOGIN_REQUIRED';
    case 'GRAPHQL_EXECUTION_ERROR':
      return 'GRAPHQL_EXECUTION_ERROR';
    case 'CONTENT_UNAVAILABLE':
    case 'RATE_LIMITED':
      return 'HTTP_ERROR';
    default:
      return 'UNKNOWN';
  }
}

function mapParseError(code: string): StoryFeasibilityStatus {
  switch (code) {
    case 'PARSER_OUTDATED':
      return 'PARSER_OUTDATED';
    case 'CONTENT_UNAVAILABLE':
      return 'HTTP_ERROR';
    case 'LOGIN_REQUIRED':
      return 'LOGIN_REQUIRED';
    case 'GRAPHQL_EXECUTION_ERROR':
      return 'GRAPHQL_EXECUTION_ERROR';
    case 'BROWSER_RESTRICTION':
      return 'BROWSER_RESTRICTION';
    case 'NETWORK_ERROR':
      return 'NETWORK_ERROR';
    case 'UNSUPPORTED_CONTENT':
      return 'UNSUPPORTED_CONTENT';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Classifies one authenticated Story acquisition attempt. Explicit access
 * failures are detected before parsing so they never become PARSER_OUTDATED.
 * On success the single current item is also returned as a normalized asset for
 * download; multiple items are never enumerated or batched.
 */
export function resolveStoryOutcome(
  outcome: RawStrategyOutcome,
  context: StoryAcquisitionContext,
  canonicalUrl: string,
  metadata: StoryFilenameMetadata = {},
): StoryResolveResult {
  if (!outcome.reached)
    return {
      result: {
        status:
          outcome.error === 'BROWSER_RESTRICTION'
            ? 'BROWSER_RESTRICTION'
            : 'NETWORK_ERROR',
        responseKind: outcome.responseKind,
        acquisitionContext: context,
      },
    };
  const httpStatus = outcome.httpStatus;
  if (outcome.redirected)
    return {
      result: {
        status: 'LOGIN_REQUIRED',
        responseKind: outcome.responseKind,
        acquisitionContext: context,
      },
    };
  if (httpStatus === 0)
    return {
      result: { status: 'BROWSER_RESTRICTION', acquisitionContext: context },
    };
  if (httpStatus === 401 || httpStatus === 403)
    return {
      result: {
        status: 'LOGIN_REQUIRED',
        httpStatus,
        responseKind: outcome.responseKind,
        acquisitionContext: context,
      },
    };
  if (httpStatus !== 200)
    return {
      result: {
        status: 'HTTP_ERROR',
        httpStatus,
        responseKind: outcome.responseKind,
        acquisitionContext: context,
      },
    };
  if (outcome.responseKind === 'HTML')
    return {
      result: {
        status: 'LOGIN_REQUIRED',
        httpStatus,
        responseKind: 'HTML',
        acquisitionContext: context,
      },
    };
  if (outcome.responseKind === 'EMPTY')
    return {
      result: {
        status: 'UNKNOWN',
        httpStatus,
        responseKind: 'EMPTY',
        acquisitionContext: context,
      },
    };
  if (outcome.jsonText === undefined)
    return {
      result: {
        status: 'GRAPHQL_EXECUTION_ERROR',
        httpStatus,
        responseKind: 'JSON',
        acquisitionContext: context,
      },
    };
  let raw: unknown;
  try {
    raw = JSON.parse(outcome.jsonText);
  } catch {
    return {
      result: {
        status: 'GRAPHQL_EXECUTION_ERROR',
        httpStatus,
        responseKind: 'JSON',
        acquisitionContext: context,
      },
    };
  }
  // The media-info response is not a GraphQL envelope, so a generic UNKNOWN
  // summary is not treated as an access failure; explicit markers still are.
  const summary = inspectInstagramGraphql(raw);
  if (summary.category && summary.category !== 'UNKNOWN')
    return {
      result: {
        status: mapAcquisitionCategory(summary.category),
        httpStatus,
        responseKind: 'JSON',
        acquisitionContext: context,
      },
    };
  try {
    const media = parseInstagramStoryResponse(raw);
    const resolved = normalizeInstagramStory(media, canonicalUrl, metadata);
    const assetTypes = Array.from(
      new Set(
        resolved.post.assets
          .map((asset) => asset.type)
          .filter(
            (type): type is 'image' | 'video' =>
              type === 'image' || type === 'video',
          ),
      ),
    );
    // One current item only: never fall back to enumerating a whole Story reel.
    const asset =
      resolved.post.assets.length === 1 ? resolved.post.assets[0] : undefined;
    return {
      result: {
        status: 'SUCCESS',
        httpStatus,
        responseKind: 'JSON',
        itemCount: resolved.post.assets.length,
        assetTypes,
        acquisitionContext: context,
        ...(media.timestampSources
          ? { timestampSources: media.timestampSources }
          : {}),
      },
      ...(asset ? { asset } : {}),
      ...(media.ownerUsername ? { ownerUsername: media.ownerUsername } : {}),
    };
  } catch (error) {
    const code = error instanceof UniFetchError ? error.code : 'UNKNOWN';
    return {
      result: {
        status: mapParseError(code),
        httpStatus,
        responseKind: 'JSON',
        acquisitionContext: context,
      },
    };
  }
}

/** Sanitized feasibility result only; the normalized asset is dropped. */
export function classifyStoryOutcome(
  outcome: RawStrategyOutcome,
  context: StoryAcquisitionContext,
  canonicalUrl: string,
): StoryFeasibilityResult {
  return resolveStoryOutcome(outcome, context, canonicalUrl).result;
}

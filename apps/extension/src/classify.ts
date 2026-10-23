import { UniFetchError, type MediaAsset } from '@unifetch/core';
import {
  inspectInstagramGraphql,
  normalizeInstagramMedia,
  parseInstagramMediaResponse,
  type InstagramContentRef,
} from '@unifetch/meta-resolver/instagram';
import type {
  AuthenticatedStrategy,
  AuthenticatedStrategyResult,
  AuthenticatedStrategyStatus,
  RawStrategyOutcome,
} from './contracts';
import { createInstagramFilename } from './instagram-filename';

/**
 * M8D: the classified strategy result plus, on success, the normalized assets
 * that feed the reused downloader. Assets stay out of the sanitized result.
 */
export interface StrategyResolveResult {
  result: AuthenticatedStrategyResult;
  assets?: MediaAsset[];
}

function mapAcquisitionCategory(
  category: string | undefined,
): AuthenticatedStrategyStatus {
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

function mapParseError(code: string): AuthenticatedStrategyStatus {
  switch (code) {
    case 'PARSER_OUTDATED':
      return 'PARSER_OUTDATED';
    case 'LOGIN_REQUIRED':
      return 'LOGIN_REQUIRED';
    case 'GRAPHQL_EXECUTION_ERROR':
      return 'GRAPHQL_EXECUTION_ERROR';
    case 'BROWSER_RESTRICTION':
      return 'BROWSER_RESTRICTION';
    case 'NETWORK_ERROR':
      return 'NETWORK_ERROR';
    case 'CONTENT_UNAVAILABLE':
      return 'HTTP_ERROR';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Classifies one authenticated acquisition attempt. HTTP 200 JSON is fed through
 * the existing acquisition error inspector, parser and normalizer; no second
 * Instagram parser exists in the extension.
 */
export function resolveStrategyOutcome(
  strategy: AuthenticatedStrategy,
  outcome: RawStrategyOutcome,
  ref: InstagramContentRef,
): StrategyResolveResult {
  if (!outcome.reached)
    return {
      result: {
        strategy,
        status:
          outcome.error === 'BROWSER_RESTRICTION'
            ? 'BROWSER_RESTRICTION'
            : 'NETWORK_ERROR',
        responseKind: outcome.responseKind,
      },
    };
  const httpStatus = outcome.httpStatus;
  if (outcome.redirected)
    return {
      result: {
        strategy,
        status: 'LOGIN_REQUIRED',
        responseKind: outcome.responseKind,
      },
    };
  if (httpStatus === 0)
    return { result: { strategy, status: 'BROWSER_RESTRICTION' } };
  if (httpStatus === 401 || httpStatus === 403)
    return {
      result: {
        strategy,
        status: 'LOGIN_REQUIRED',
        httpStatus,
        responseKind: outcome.responseKind,
      },
    };
  if (httpStatus !== 200)
    return {
      result: {
        strategy,
        status: 'HTTP_ERROR',
        httpStatus,
        responseKind: outcome.responseKind,
      },
    };
  if (outcome.responseKind === 'HTML')
    return {
      result: {
        strategy,
        status: 'LOGIN_REQUIRED',
        httpStatus,
        responseKind: 'HTML',
      },
    };
  if (outcome.responseKind === 'EMPTY')
    return {
      result: {
        strategy,
        status: 'UNKNOWN',
        httpStatus,
        responseKind: 'EMPTY',
      },
    };
  if (outcome.jsonText === undefined)
    return {
      result: {
        strategy,
        status: 'GRAPHQL_EXECUTION_ERROR',
        httpStatus,
        responseKind: 'JSON',
      },
    };
  let raw: unknown;
  try {
    raw = JSON.parse(outcome.jsonText);
  } catch {
    return {
      result: {
        strategy,
        status: 'GRAPHQL_EXECUTION_ERROR',
        httpStatus,
        responseKind: 'JSON',
      },
    };
  }
  const summary = inspectInstagramGraphql(raw);
  if (summary.category)
    return {
      result: {
        strategy,
        status: mapAcquisitionCategory(summary.category),
        httpStatus,
        responseKind: 'JSON',
      },
    };
  try {
    const media = parseInstagramMediaResponse(raw, ref.shortcode);
    const resolved = normalizeInstagramMedia(media, ref.canonicalUrl);
    // Shared human-readable Instagram filename policy: author + caption snippet
    // (+ original two-digit index for a Carousel). The shortcode is not used.
    const isCarousel =
      media.kind === 'carousel' || resolved.post.assets.length > 1;
    const assets = resolved.post.assets.map((asset, index) => ({
      ...asset,
      suggestedFilename: createInstagramFilename({
        username: resolved.post.author?.username,
        caption: resolved.post.caption,
        mediaType: asset.type === 'video' ? 'video' : 'image',
        mimeType: asset.type === 'video' ? 'video/mp4' : 'image/jpeg',
        ...(isCarousel ? { index: index + 1 } : {}),
        contentKind: ref.kind === 'reel' ? 'reel' : 'post',
      }),
    }));
    const assetTypes = Array.from(
      new Set(
        assets
          .map((asset) => asset.type)
          .filter((type): type is 'image' | 'video' =>
            type === 'image' || type === 'video' ? true : false,
          ),
      ),
    );
    return {
      result: {
        strategy,
        status: 'SUCCESS',
        httpStatus,
        responseKind: 'JSON',
        assetCount: assets.length,
        assetTypes,
      },
      assets,
    };
  } catch (error) {
    const code = error instanceof UniFetchError ? error.code : 'UNKNOWN';
    return {
      result: {
        strategy,
        status: mapParseError(code),
        httpStatus,
        responseKind: 'JSON',
      },
    };
  }
}

/** Sanitized result only; normalized assets are dropped. */
export function classifyStrategyOutcome(
  strategy: AuthenticatedStrategy,
  outcome: RawStrategyOutcome,
  ref: InstagramContentRef,
): AuthenticatedStrategyResult {
  return resolveStrategyOutcome(strategy, outcome, ref).result;
}

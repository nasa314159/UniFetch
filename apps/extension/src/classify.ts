import { UniFetchError } from '@unifetch/core';
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
export function classifyStrategyOutcome(
  strategy: AuthenticatedStrategy,
  outcome: RawStrategyOutcome,
  ref: InstagramContentRef,
): AuthenticatedStrategyResult {
  if (!outcome.reached)
    return {
      strategy,
      status:
        outcome.error === 'BROWSER_RESTRICTION'
          ? 'BROWSER_RESTRICTION'
          : 'NETWORK_ERROR',
      responseKind: outcome.responseKind,
    };
  const httpStatus = outcome.httpStatus;
  if (outcome.redirected)
    return {
      strategy,
      status: 'LOGIN_REQUIRED',
      responseKind: outcome.responseKind,
    };
  if (httpStatus === 0) return { strategy, status: 'BROWSER_RESTRICTION' };
  if (httpStatus === 401 || httpStatus === 403)
    return {
      strategy,
      status: 'LOGIN_REQUIRED',
      httpStatus,
      responseKind: outcome.responseKind,
    };
  if (httpStatus !== 200)
    return {
      strategy,
      status: 'HTTP_ERROR',
      httpStatus,
      responseKind: outcome.responseKind,
    };
  if (outcome.responseKind === 'HTML')
    return {
      strategy,
      status: 'LOGIN_REQUIRED',
      httpStatus,
      responseKind: 'HTML',
    };
  if (outcome.responseKind === 'EMPTY')
    return {
      strategy,
      status: 'UNKNOWN',
      httpStatus,
      responseKind: 'EMPTY',
    };
  if (outcome.jsonText === undefined)
    return {
      strategy,
      status: 'GRAPHQL_EXECUTION_ERROR',
      httpStatus,
      responseKind: 'JSON',
    };
  let raw: unknown;
  try {
    raw = JSON.parse(outcome.jsonText);
  } catch {
    return {
      strategy,
      status: 'GRAPHQL_EXECUTION_ERROR',
      httpStatus,
      responseKind: 'JSON',
    };
  }
  const summary = inspectInstagramGraphql(raw);
  if (summary.category)
    return {
      strategy,
      status: mapAcquisitionCategory(summary.category),
      httpStatus,
      responseKind: 'JSON',
    };
  try {
    const media = parseInstagramMediaResponse(raw, ref.shortcode);
    const resolved = normalizeInstagramMedia(media, ref.canonicalUrl);
    const assetTypes = Array.from(
      new Set(
        resolved.post.assets
          .map((asset) => asset.type)
          .filter((type): type is 'image' | 'video' =>
            type === 'image' || type === 'video' ? true : false,
          ),
      ),
    );
    return {
      strategy,
      status: 'SUCCESS',
      httpStatus,
      responseKind: 'JSON',
      assetCount: resolved.post.assets.length,
      assetTypes,
    };
  } catch (error) {
    const code = error instanceof UniFetchError ? error.code : 'UNKNOWN';
    return {
      strategy,
      status: mapParseError(code),
      httpStatus,
      responseKind: 'JSON',
    };
  }
}

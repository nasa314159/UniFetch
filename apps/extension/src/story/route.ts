import type { StoryFeasibilityResult } from './contracts';
import {
  parseInstagramProfileStoryRef,
  parseInstagramStoryRef,
  type InstagramStoryRef,
} from './ref';

/**
 * Pure Story routing for the stable extension surface.
 *
 * Only an explicit `/stories/<username>/<id>/` URL (or a username-level URL
 * that already carries an item id in a query parameter) is accepted. A
 * username-only `/stories/<username>/` URL fails closed: no page-state scan, no
 * DOM/fiber inspection and no heuristic id discovery is attempted.
 */
export type StoryRoute =
  | { status: 'explicit'; ref: InstagramStoryRef }
  | {
      status: 'unsupported';
      reason: 'username-only' | 'none';
      result: StoryFeasibilityResult;
    };

/** Sanitized fail-closed result used for username-only Story URLs. */
export function unsupportedStoryResult(): StoryFeasibilityResult {
  return {
    status: 'UNSUPPORTED_CONTENT',
    acquisitionContext: 'background',
    identityResult: 'unproven',
  };
}

export function routeStoryUrls(
  urls: readonly (string | undefined)[],
): StoryRoute {
  for (const url of urls) {
    if (!url) continue;
    try {
      return { status: 'explicit', ref: parseInstagramStoryRef(url) };
    } catch {
      // not an explicit Story URL; keep checking
    }
  }
  for (const url of urls) {
    if (!url) continue;
    try {
      parseInstagramProfileStoryRef(url);
      return {
        status: 'unsupported',
        reason: 'username-only',
        result: unsupportedStoryResult(),
      };
    } catch {
      // not a username-only Story URL either
    }
  }
  return {
    status: 'unsupported',
    reason: 'none',
    result: unsupportedStoryResult(),
  };
}

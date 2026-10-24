import { UniFetchError } from '@unifetch/core';
import {
  resolveThreadsInput,
  type ThreadsAcquisitionAdapter,
} from '@unifetch/meta-resolver/threads';
import type { ExtensionResolveResponse, ResolveErrorCode } from '../resolve';
import type { ThreadsTarget } from '../target';

/**
 * Threads parser/transport failures use the shared core error codes. Map them
 * to the popup contract without collapsing temporary upstream failures into
 * unsupported content.
 */
export function mapThreadsErrorCode(code: string): ResolveErrorCode {
  switch (code) {
    case 'INVALID_URL':
      return 'INVALID_URL';
    case 'UNSUPPORTED_PLATFORM':
    case 'UNSUPPORTED_CONTENT':
      return 'UNSUPPORTED_CONTENT';
    case 'CONTENT_UNAVAILABLE':
      return 'CONTENT_UNAVAILABLE';
    case 'LOGIN_REQUIRED':
      return 'LOGIN_REQUIRED';
    case 'RATE_LIMITED':
      return 'RATE_LIMITED';
    case 'PARSER_OUTDATED':
      return 'PARSER_OUTDATED';
    case 'NETWORK_ERROR':
      return 'NETWORK_ERROR';
    case 'BROWSER_RESTRICTION':
      return 'BROWSER_RESTRICTION';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Resolves one canonical Threads post or official share link through the
 * existing exact-post parser, share-location validator, GIF embed fallback and
 * normalizer. No Instagram strategy is touched.
 */
export async function resolveThreadsTarget(
  target: ThreadsTarget,
  acquisition: ThreadsAcquisitionAdapter,
): Promise<ExtensionResolveResponse> {
  try {
    const result = await resolveThreadsInput(target.canonicalUrl, acquisition);
    const assets = result.post.assets;
    return {
      ok: true,
      platform: 'threads',
      contentType: assets.length > 1 ? 'carousel' : 'post',
      assets,
    };
  } catch (error) {
    const code = error instanceof UniFetchError ? error.code : 'UNKNOWN';
    return {
      ok: false,
      platform: 'threads',
      contentType: 'post',
      error: mapThreadsErrorCode(code),
    };
  }
}

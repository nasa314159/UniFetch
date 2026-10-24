import {
  UniFetchError,
  parseSupportedUrl,
  type ResolveResult,
} from '@unifetch/core';
import {
  isThreadsSharePath,
  parseThreadsContentRef,
  parseThreadsShareRef,
  type ThreadsContentRef,
  type ThreadsShareRef,
} from './content-ref';
import { parseThreadsEmbedGif } from './embed';
import { normalizeThreadsMedia, threadsResultKind } from './normalize';
import { parseThreadsSsrHtml } from './parser';
import { parseThreadsShareLocation } from './share';
import type { ThreadsResolvedKind } from './types';

export interface ThreadsAcquisitionResult {
  html: string;
  network: { origin: string; purpose: 'metadata' }[];
  /**
   * Final canonical reference when the official host redirected a stale
   * username to the same post shortcode. Acquisition adapters that do not
   * follow redirects omit this; the requested ref is then authoritative.
   */
  ref?: ThreadsContentRef;
}

export interface ThreadsShareExpansion {
  /** The single redirect destination returned by the share endpoint. */
  location: string;
  network: { origin: string; purpose: 'metadata' }[];
}

export interface ThreadsAcquisitionAdapter {
  acquirePost(ref: ThreadsContentRef): Promise<ThreadsAcquisitionResult>;
  acquireEmbed(ref: ThreadsContentRef): Promise<ThreadsAcquisitionResult>;
  acquireShare(ref: ThreadsShareRef): Promise<ThreadsShareExpansion>;
}

export interface ThreadsResolutionResult extends ResolveResult {
  source: 'fixture' | 'live' | 'worker';
  kind: ThreadsResolvedKind;
}

function networkRecords(
  ...groups: ThreadsAcquisitionResult['network'][]
): ThreadsAcquisitionResult['network'] {
  const unique = new Map<string, { origin: string; purpose: 'metadata' }>();
  for (const record of groups.flat())
    unique.set(`${record.origin}|${record.purpose}`, { ...record });
  return [...unique.values()];
}

/**
 * Composes transport, exact-post parsing, the optional GIF embed fallback and
 * normalization. Media bytes are never fetched by this layer.
 */
export async function resolveThreadsPost(
  ref: ThreadsContentRef,
  acquisition: ThreadsAcquisitionAdapter,
): Promise<ThreadsResolutionResult> {
  const post = await acquisition.acquirePost(ref);
  // An official same-shortcode redirect can move a post to its current
  // username. Parse and normalize against the final publisher so identity is
  // still checked exactly, against the URL Threads actually served.
  const effectiveRef = post.ref ?? ref;
  const media = parseThreadsSsrHtml(post.html, effectiveRef);
  let gifUrl: string | undefined;
  let embedNetwork: ThreadsAcquisitionResult['network'] = [];
  if (media.kind === 'gif') {
    gifUrl = media.gif?.directUrl;
    if (!gifUrl) {
      const embed = await acquisition.acquireEmbed(effectiveRef);
      gifUrl = parseThreadsEmbedGif(embed.html, effectiveRef).url;
      embedNetwork = embed.network;
    }
  }
  const normalized = normalizeThreadsMedia(
    media,
    effectiveRef.canonicalUrl,
    gifUrl,
  );
  return {
    ...normalized,
    source: 'live',
    kind: threadsResultKind(media),
    trace: {
      ...normalized.trace,
      network: networkRecords(post.network, embedNetwork),
    },
  };
}

/**
 * Resolves either one canonical post permalink or one official share URL.
 * Share expansion is a single bounded redirect observation followed by the same
 * exact-post parser and normalizer; no general-purpose redirect following or
 * arbitrary URL expansion is exposed.
 */
export async function resolveThreadsInput(
  input: string | URL,
  acquisition: ThreadsAcquisitionAdapter,
): Promise<ThreadsResolutionResult> {
  const { url, platform } = parseSupportedUrl(String(input));
  if (platform !== 'threads')
    throw new UniFetchError('UNSUPPORTED_PLATFORM', 'Use a Threads URL.');
  if (isThreadsSharePath(url.pathname)) {
    const share = parseThreadsShareRef(input);
    const expansion = await acquisition.acquireShare(share);
    const ref = parseThreadsShareLocation(share, expansion.location);
    const resolved = await resolveThreadsPost(ref, acquisition);
    return {
      ...resolved,
      trace: {
        ...resolved.trace,
        network: networkRecords(
          expansion.network,
          resolved.trace.network.filter(
            (record): record is { origin: string; purpose: 'metadata' } =>
              record.purpose === 'metadata',
          ),
        ),
      },
    };
  }
  return resolveThreadsPost(parseThreadsContentRef(input), acquisition);
}

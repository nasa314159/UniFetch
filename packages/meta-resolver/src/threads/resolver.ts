import type { ResolveResult } from '@unifetch/core';
import type { ThreadsContentRef } from './content-ref';
import { parseThreadsEmbedGif } from './embed';
import { normalizeThreadsMedia, threadsResultKind } from './normalize';
import { parseThreadsSsrHtml } from './parser';
import type { ThreadsResolvedKind } from './types';

export interface ThreadsAcquisitionResult {
  html: string;
  network: { origin: string; purpose: 'metadata' }[];
}

export interface ThreadsAcquisitionAdapter {
  acquirePost(ref: ThreadsContentRef): Promise<ThreadsAcquisitionResult>;
  acquireEmbed(ref: ThreadsContentRef): Promise<ThreadsAcquisitionResult>;
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
  const media = parseThreadsSsrHtml(post.html, ref);
  let gifUrl: string | undefined;
  let embedNetwork: ThreadsAcquisitionResult['network'] = [];
  if (media.kind === 'gif') {
    gifUrl = media.gif?.directUrl;
    if (!gifUrl) {
      const embed = await acquisition.acquireEmbed(ref);
      gifUrl = parseThreadsEmbedGif(embed.html, ref).url;
      embedNetwork = embed.network;
    }
  }
  const normalized = normalizeThreadsMedia(media, ref.canonicalUrl, gifUrl);
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

import { type Resolver, type ResolveResult } from '@unifetch/core';
import { parseInstagramContentRef } from './content-ref';
import {
  PolarisPostRootAcquisitionAdapter,
  type InstagramAcquisitionAdapter,
} from './acquisition';
import { parseInstagramMediaResponse } from './parser';
import { normalizeInstagramMedia } from './normalize';
import type { InstagramResolvedKind } from './types';

export type ResolutionSource = 'fixture' | 'live';
export interface InstagramResolutionResult extends ResolveResult {
  source: ResolutionSource;
  kind: InstagramResolvedKind;
}

/** Composes existing layers; transport, response parsing and normalization stay separate. */
export function createInstagramResolver(
  fixtureResolver: Resolver,
  isFixture: (url: URL) => boolean,
  acquisition: InstagramAcquisitionAdapter = new PolarisPostRootAcquisitionAdapter(),
): Resolver {
  return {
    platform: 'instagram',
    match: (url) => fixtureResolver.match(url),
    normalize: (url) => fixtureResolver.normalize(url),
    async resolve(url, context): Promise<InstagramResolutionResult> {
      if (isFixture(url)) {
        const result = await fixtureResolver.resolve(url, context);
        return {
          ...result,
          source: 'fixture',
          kind:
            result.post.assets.length > 1
              ? 'carousel'
              : result.post.assets[0].type === 'video'
                ? 'video'
                : 'image',
        };
      }
      const ref = parseInstagramContentRef(url);
      const acquired = await acquisition.acquirePublicMedia(ref, context);
      const media = parseInstagramMediaResponse(acquired.raw, ref.shortcode);
      const result = normalizeInstagramMedia(media, ref.canonicalUrl);
      return {
        ...result,
        source: 'live',
        kind: media.kind,
        trace: {
          processedLocally: true,
          remoteProxyUsed: false,
          credentialsExported: false,
          network: acquired.network.map((record) => ({ ...record })),
        },
      };
    },
  };
}

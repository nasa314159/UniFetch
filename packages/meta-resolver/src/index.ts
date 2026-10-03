import {
  parseSupportedUrl,
  ResolverRegistry,
  UniFetchError,
  type Resolver,
  type ResolveResult,
  type RuntimeAdapter,
} from '@unifetch/core';
import image from '../../../fixtures/instagram/image.json';
import carousel from '../../../fixtures/instagram/carousel.json';
import reel from '../../../fixtures/instagram/reel.json';
const fixtures = new Map<string, ResolveResult>([
  ['/p/unifetch-demo-image/', image as ResolveResult],
  ['/p/unifetch-demo-carousel/', carousel as ResolveResult],
  ['/reel/unifetch-demo-reel/', reel as ResolveResult],
]);
export const instagramFixtureResolver: Resolver = {
  platform: 'instagram',
  match: (url) => parseSupportedUrl(url.href).platform === 'instagram',
  normalize: (url) => parseSupportedUrl(url.href).url,
  async resolve(url) {
    const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
    const fixture = fixtures.get(path);
    if (!fixture)
      throw new UniFetchError(
        'UNSUPPORTED_CONTENT',
        'Live Instagram resolution is not implemented in this milestone. Choose a demo link to try UniFetch.',
      );
    return structuredClone(fixture);
  },
};
export function createResolver(runtime: RuntimeAdapter): ResolverRegistry {
  return new ResolverRegistry(runtime, [instagramFixtureResolver]);
}

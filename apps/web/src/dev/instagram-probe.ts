import { asUniFetchError, type MediaType } from '@unifetch/core';
import { createWebResolver } from '../resolver-client';

export interface InstagramProbeInputs {
  imagePost: string;
  carousel: string;
  reel: string;
}
type ProbeStatus =
  | 'SUCCESS'
  | 'RATE_LIMITED'
  | 'LOGIN_REQUIRED'
  | 'NETWORK_ERROR'
  | 'CONTENT_UNAVAILABLE'
  | 'PARSER_OUTDATED'
  | 'OTHER_TYPED_ERROR';
export interface InstagramProbeOutcome {
  status: ProbeStatus;
  kind?: 'image' | 'video' | 'carousel';
  assetCount?: number;
  assetTypes?: MediaType[];
}
/** Developer invokes this manually with three public URLs. Nothing is logged or saved. */
export async function runInstagramProbe(
  inputs: InstagramProbeInputs,
): Promise<Record<keyof InstagramProbeInputs, InstagramProbeOutcome>> {
  if (!import.meta.env.DEV)
    throw new Error('The manual probe is development-only.');
  const resolver = createWebResolver(
    import.meta.env.VITE_UNIFETCH_RESOLVER_URL,
  );
  const outcomes = {} as Record<
    keyof InstagramProbeInputs,
    InstagramProbeOutcome
  >;
  for (const key of ['imagePost', 'carousel', 'reel'] as const) {
    try {
      const result = await resolver.resolve(inputs[key]);
      outcomes[key] =
        result.source === 'worker'
          ? {
              status: 'SUCCESS',
              kind: result.kind,
              assetCount: result.post.assets.length,
              assetTypes: result.post.assets.map((asset) => asset.type),
            }
          : { status: 'OTHER_TYPED_ERROR' };
    } catch (cause) {
      const { code } = asUniFetchError(cause);
      const status: ProbeStatus = [
        'RATE_LIMITED',
        'LOGIN_REQUIRED',
        'NETWORK_ERROR',
        'CONTENT_UNAVAILABLE',
        'PARSER_OUTDATED',
      ].includes(code)
        ? (code as ProbeStatus)
        : 'OTHER_TYPED_ERROR';
      outcomes[key] = { status };
    }
  }
  return outcomes;
}

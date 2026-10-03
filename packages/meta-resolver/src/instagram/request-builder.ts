import { UniFetchError, type RuntimeSessionRequest } from '@unifetch/core';
import {
  parseInstagramContentRef,
  type InstagramContentRef,
} from './content-ref';
import { POLARIS_POST_ROOT_PROFILE_V1 as profile } from './endpoint-profile';

/** Specifies CSRF injection by the runtime; never accepts or returns a token. */
export function buildInstagramPostRootRequest(
  ref: InstagramContentRef,
): RuntimeSessionRequest {
  const parsed = parseInstagramContentRef(ref.canonicalUrl);
  if (parsed.shortcode !== ref.shortcode || parsed.kind !== ref.kind)
    throw new UniFetchError(
      'INVALID_URL',
      'The Instagram content reference is inconsistent.',
    );
  const body = new URLSearchParams({
    variables: JSON.stringify({
      shortcode: ref.shortcode,
      ...profile.variables,
    }),
    doc_id: profile.docId,
    server_timestamps: 'true',
  }).toString();
  return {
    url: profile.endpoint,
    method: profile.method,
    headers: { ...profile.headers, 'X-IG-App-ID': profile.appId },
    csrfHeader: profile.csrfHeader,
    body,
  };
}

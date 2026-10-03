import { POLARIS_POST_ROOT_PROFILE_V1 as profile } from '@unifetch/meta-resolver/instagram';
const origin = new URL(profile.endpoint).origin;
/** Ordinary deterministic request metadata; no fingerprint or account identifiers. */
export function anonymousRequestHeaders(input?: HeadersInit): Headers {
  const headers = new Headers({
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': profile.headers['Accept-Language'],
    Referer: `${origin}/`,
    'X-IG-App-ID': profile.appId,
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  new Headers(input).forEach((value, name) => headers.set(name, value));
  return headers;
}
/** A fresh jar for one anonymous resolve; no reusable or imported session state. */
export function createAnonymousCookieJar(): Map<string, string> {
  return new Map([
    ['csrftoken', ''],
    ['mid', ''],
    ['ig_pr', '1'],
    ['ig_vw', '1920'],
    ['s_network', ''],
    ['ds_user_id', ''],
  ]);
}
export function cookieHeader(cookies: ReadonlyMap<string, string>): string {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

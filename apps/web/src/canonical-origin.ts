const canonicalOrigin = 'https://unifetch.pages.dev';

/**
 * Cloudflare publishes each Pages deployment at an eight-character hexadecimal
 * hostname such as `75dcedd7.unifetch.pages.dev`. Those aliases are not in the
 * Resolver CORS allowlist, so resolving from one always fails with
 * NETWORK_ERROR before any media is shown. Keep a single user-facing origin by
 * redirecting production deployment aliases to it.
 */
const deploymentAliasPattern = /^[0-9a-f]{8}\.unifetch\.pages\.dev$/i;

export function canonicalProductionUrl(input: string): string | undefined {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || !deploymentAliasPattern.test(url.hostname))
    return undefined;
  return `${canonicalOrigin}${url.pathname}${url.search}${url.hash}`;
}

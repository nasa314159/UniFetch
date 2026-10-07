/**
 * The only non-cookie CSRF context this PoC reuses. The anonymous Worker obtains
 * the CSRF value from a bootstrap Set-Cookie; the extension deliberately does not
 * use a cookie API, so it reads the same value from the same-origin bootstrap
 * HTML instead. No session identifier or user credential is read or kept.
 * The token is used only locally, in memory, for one request.
 */
const patterns = [
  /"csrf_token"\s*:\s*"([^"]+)"/,
  /"csrfToken"\s*:\s*"([^"]+)"/,
  /<meta[^>]+name="csrf-token"[^>]+content="([^"]+)"/i,
];

export function extractCsrfToken(html: string): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

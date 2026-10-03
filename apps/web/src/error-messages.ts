import type { UniFetchError } from '@unifetch/core';
/** Keep diagnostic codes intact while explaining known failures without raw payloads. */
export function resolutionErrorMessage(error: UniFetchError): string {
  switch (error.code) {
    case 'BROWSER_RESTRICTION':
      return 'Your browser blocked the direct Instagram request required for local resolution. UniFetch did not send the request through a remote proxy. Try a demo link to explore the app.';
    case 'RATE_LIMITED':
      return 'Instagram temporarily limited this request. Please try again later.';
    case 'LOGIN_REQUIRED':
      return 'This content cannot be resolved by the current public, credential-free runtime. UniFetch does not offer a login flow or ask for cookies.';
    case 'PARSER_OUTDATED':
      return 'Instagram returned a response shape this UniFetch version does not recognize.';
    case 'CONTENT_UNAVAILABLE':
      return 'This content may be unavailable, removed, or not public.';
    default:
      return error.message;
  }
}

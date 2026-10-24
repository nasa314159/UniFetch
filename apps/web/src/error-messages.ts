import type { UniFetchError } from '@unifetch/core';
const wording = {
  LOGIN_REQUIRED: [
    'This post requires sign-in',
    'The platform does not make this content available to anonymous requests. UniFetch’s web resolver does not receive your credentials.',
  ],
  CONTENT_UNAVAILABLE: [
    "This post isn't available",
    'The platform did not make this content available to the resolver.',
  ],
  RATE_LIMITED: [
    'The platform temporarily limited this request',
    'Try again later.',
  ],
  PARSER_OUTDATED: [
    'The platform changed this response',
    'UniFetch received media data it does not currently understand.',
  ],
  GRAPHQL_EXECUTION_ERROR: [
    "The platform couldn't return this post",
    'The platform returned an application-level error for this request.',
  ],
} as const;
export function resolutionErrorTitle(error: UniFetchError): string {
  return error.code in wording
    ? wording[error.code as keyof typeof wording][0]
    : 'We couldn’t resolve this link';
}
/** Known failures never display upstream response text. */
export function resolutionErrorMessage(error: UniFetchError): string {
  return error.code in wording
    ? wording[error.code as keyof typeof wording][1]
    : error.message;
}

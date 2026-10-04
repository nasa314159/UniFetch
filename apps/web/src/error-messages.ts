import type { UniFetchError } from '@unifetch/core';
const wording = {
  LOGIN_REQUIRED: [
    'This post requires Instagram sign-in',
    "Instagram does not make this content available to anonymous requests. UniFetch's web resolver does not receive your Instagram credentials.",
  ],
  CONTENT_UNAVAILABLE: [
    "This post isn't available",
    'Instagram did not make this content available to the resolver.',
  ],
  RATE_LIMITED: [
    'Instagram temporarily limited this request',
    'Try again later.',
  ],
  PARSER_OUTDATED: [
    'Instagram changed this response',
    'UniFetch received media data it does not currently understand.',
  ],
  GRAPHQL_EXECUTION_ERROR: [
    "Instagram couldn't return this post",
    'Instagram returned an application-level error for this request.',
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

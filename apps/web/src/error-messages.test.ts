import { describe, expect, it } from 'vitest';
import { UniFetchError } from '@unifetch/core';
import { resolutionErrorTitle, resolutionErrorMessage } from './error-messages';
describe('Access error presentation', () => {
  it.each([
    [
      'LOGIN_REQUIRED',
      'This post requires sign-in',
      'The platform does not make this content available to anonymous requests. UniFetch’s web resolver does not receive your credentials.',
    ],
    [
      'CONTENT_UNAVAILABLE',
      "This post isn't available",
      'The platform did not make this content available to the resolver.',
    ],
    [
      'RATE_LIMITED',
      'The platform temporarily limited this request',
      'Try again later.',
    ],
    [
      'PARSER_OUTDATED',
      'The platform changed this response',
      'UniFetch received media data it does not currently understand.',
    ],
    [
      'GRAPHQL_EXECUTION_ERROR',
      "The platform couldn't return this post",
      'The platform returned an application-level error for this request.',
    ],
  ] as const)('explains %s without upstream text', (code, title, body) => {
    const error = new UniFetchError(code, 'private upstream text');
    expect(resolutionErrorTitle(error)).toBe(title);
    expect(resolutionErrorMessage(error)).toBe(body);
    expect(error.code).toBe(code);
  });
});

import { describe, expect, it } from 'vitest';
import { UniFetchError } from '@unifetch/core';
import { resolutionErrorTitle, resolutionErrorMessage } from './error-messages';
describe('Access error presentation', () => {
  it.each([
    [
      'LOGIN_REQUIRED',
      'This post requires Instagram sign-in',
      "Instagram does not make this content available to anonymous requests. UniFetch's web resolver does not receive your Instagram credentials.",
    ],
    [
      'CONTENT_UNAVAILABLE',
      "This post isn't available",
      'Instagram did not make this content available to the resolver.',
    ],
    [
      'RATE_LIMITED',
      'Instagram temporarily limited this request',
      'Try again later.',
    ],
    [
      'PARSER_OUTDATED',
      'Instagram changed this response',
      'UniFetch received media data it does not currently understand.',
    ],
    [
      'GRAPHQL_EXECUTION_ERROR',
      "Instagram couldn't return this post",
      'Instagram returned an application-level error for this request.',
    ],
  ] as const)('explains %s without upstream text', (code, title, body) => {
    const error = new UniFetchError(code, 'private upstream text');
    expect(resolutionErrorTitle(error)).toBe(title);
    expect(resolutionErrorMessage(error)).toBe(body);
    expect(error.code).toBe(code);
  });
});

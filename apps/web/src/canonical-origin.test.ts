import { describe, expect, it } from 'vitest';
import { canonicalProductionUrl } from './canonical-origin';

const alias = 'https://75dcedd7.unifetch.pages.dev';

describe('Canonical production origin', () => {
  it.each([
    [`${alias}/`, 'https://unifetch.pages.dev/'],
    [`${alias}/extension`, 'https://unifetch.pages.dev/extension'],
    [
      `${alias}/share?url=https%3A%2F%2Fwww.threads.com%2F%40demo%2Fpost%2Fcode%2F`,
      'https://unifetch.pages.dev/share?url=https%3A%2F%2Fwww.threads.com%2F%40demo%2Fpost%2Fcode%2F',
    ],
    ['https://093fea98.unifetch.pages.dev/', 'https://unifetch.pages.dev/'],
  ])('redirects a deployment alias %s', (input, expected) => {
    expect(canonicalProductionUrl(input)).toBe(expected);
  });

  it.each([
    'https://unifetch.pages.dev/',
    'https://unifetch.pages.dev/share?url=test',
    'https://main.unifetch.pages.dev/',
    'https://75dcedd7.unifetch.pages.dev.evil.example/',
    'https://75dcedd7-c190-45af-b394-0e3b997b8cb4.unifetch.pages.dev/',
    'http://75dcedd7.unifetch.pages.dev/',
    'not a url',
  ])('leaves non-deployment input unchanged: %s', (input) => {
    expect(canonicalProductionUrl(input)).toBeUndefined();
  });
});

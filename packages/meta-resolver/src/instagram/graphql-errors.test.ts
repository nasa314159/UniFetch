import { describe, expect, it } from 'vitest';
import { inspectInstagramGraphql } from './graphql-errors';
import fixtures from './__fixtures__/graphql-errors.json';
import image from './__fixtures__/single-image-response.json';
import { parseInstagramMediaResponse } from './parser';
describe('GraphQL classification boundary', () => {
  it.each([
    ['generic', 'GRAPHQL_EXECUTION_ERROR'],
    ['login', 'LOGIN_REQUIRED'],
    ['rate', 'RATE_LIMITED'],
    ['unavailable', 'CONTENT_UNAVAILABLE'],
  ] as const)('classifies fictional %s response', (fixture, code) => {
    expect(inspectInstagramGraphql(fixtures[fixture]).category).toBe(code);
  });
  it.each([
    [fixtures.unavailable.errors, fixtures.rate.errors, 'RATE_LIMITED'],
    [fixtures.rate.errors, fixtures.unavailable.errors, 'RATE_LIMITED'],
    [
      fixtures.unavailable.errors,
      [{ extensions: { code: 'LOGIN_REQUIRED' } }],
      'LOGIN_REQUIRED',
    ],
  ] as const)(
    'uses deterministic priority across error order',
    (first, last, code) => {
      expect(
        inspectInstagramGraphql({ data: {}, errors: [...first, ...last] })
          .category,
      ).toBe(code);
    },
  );
  it('rate limiting takes precedence over login flags', () => {
    expect(
      inspectInstagramGraphql({ ...fixtures.rate, login_required: true })
        .category,
    ).toBe('RATE_LIMITED');
  });
  it('does not infer authentication or age from generic failures or content', () => {
    expect(
      inspectInstagramGraphql({
        ...fixtures.generic,
        caption: 'age restricted',
        username: 'fictional_adult',
      }).category,
    ).toBe('GRAPHQL_EXECUTION_ERROR');
  });
  it('reports only allowlisted diagnostics', () => {
    const summary = inspectInstagramGraphql({
      data: null,
      errors: [
        {
          message: 'private username token url',
          extensions: { code: 'private-code' },
        },
      ],
      cookies: 'private-session',
    });
    expect(summary).toMatchObject({
      dataNull: true,
      dataPresent: false,
      mediaRootExists: false,
      errorsPresent: true,
      errorCount: 1,
      knownEnums: [],
    });
    expect(JSON.stringify(summary)).not.toContain('private');
  });
  it('keeps malformed media semantics in the parser', () => {
    const raw = {
      data: { xdt_api__v1__media__shortcode__web_info: { items: [{}] } },
    };
    expect(inspectInstagramGraphql(raw).category).toBeUndefined();
    expect(() => parseInstagramMediaResponse(raw, 'fictional')).toThrow(
      expect.objectContaining({ code: 'PARSER_OUTDATED' }),
    );
  });
  it('preserves successful partial media despite generic errors', () => {
    expect(
      inspectInstagramGraphql({ ...image, errors: fixtures.generic.errors })
        .category,
    ).toBeUndefined();
  });
  it('treats a malformed errors field as an application failure', () => {
    expect(
      inspectInstagramGraphql({ data: null, errors: { message: 'fictional' } })
        .category,
    ).toBe('GRAPHQL_EXECUTION_ERROR');
  });
});

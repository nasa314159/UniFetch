import { describe, expect, it, vi } from 'vitest';
import {
  normalizeInstagramMedia,
  parseInstagramContentRef,
  parseInstagramMediaResponse,
} from '@unifetch/meta-resolver/instagram';
import { validateBridgeRequest, validateInjectedOutcome } from './bridge';
import { classifyStrategyOutcome } from './classify';
import type {
  AuthenticatedStrategyResult,
  RawStrategyOutcome,
} from './contracts';
import { extractCsrfToken } from './csrf';
import { authenticatedRequestFunction } from './injected';
import { assertInstagramTabUrl, runStrategyMatrix } from './orchestrate';
import { categorizePath, describeUrl, resolveContentRef } from './preflight';
import { buildStrategyRequest } from './request';
import {
  prepareCsrfContext,
  runBackgroundFetch,
  type FetchLike,
} from './strategy';

const ref = parseInstagramContentRef('https://www.instagram.com/p/Abc_12/');

/** Synthetic authenticated response; no real identifiers. */
const authenticatedImageResponse = {
  data: {
    xdt_api__v1__media__shortcode__web_info: {
      items: [
        {
          id: 'fictional-root',
          code: 'raw-code-is-ignored',
          media_type: 1,
          image_versions2: {
            candidates: [
              {
                url: 'https://media.invalid/unifetch/image-high.jpg',
                width: 1600,
                height: 1200,
              },
              {
                url: 'https://media.invalid/unifetch/image-low.jpg',
                width: 320,
                height: 240,
              },
            ],
          },
          user: { username: 'fictional_user', full_name: 'Fictional' },
          caption: { text: 'Fictional authenticated fixture.' },
          taken_at: 1767225600,
        },
      ],
    },
  },
};

function raw(overrides: Partial<RawStrategyOutcome>): RawStrategyOutcome {
  return {
    reached: true,
    httpStatus: 200,
    responseKind: 'JSON',
    csrfUsed: false,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    status,
    redirected: false,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function htmlResponse(body: string, status = 200): Response {
  return {
    status,
    redirected: false,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'text/html' : null,
    },
    text: async () => body,
  } as unknown as Response;
}

describe('explicit tab validation', () => {
  it.each([
    'https://example.com/p/Abc/',
    'chrome://extensions',
    'https://www.facebook.com/p/Abc/',
    'https://www.instagram.com/stories/example/',
    undefined,
    'not a url',
  ])('rejects non-Instagram active tab %s', (url) => {
    expect(() => assertInstagramTabUrl(url)).toThrow();
  });
  it('parses an explicit Instagram post URL with existing content-ref logic', () => {
    const url =
      'https://www.instagram.com/p/Abc_12/?img_index=2&igsh=secret#fragment';
    const parsed = assertInstagramTabUrl(url);
    expect(parsed).toEqual(parseInstagramContentRef(url));
    expect(parsed.kind).toBe('post');
    expect(parsed.canonicalUrl).toBe(
      'https://www.instagram.com/p/Abc_12/?img_index=2',
    );
  });
});

describe('message bridge validation', () => {
  it.each([
    undefined,
    null,
    42,
    'message',
    [],
    {},
    { endpoint: 'https://www.instagram.com/graphql/query' },
    { endpoint: 1, body: 'b', csrfHeader: 'X-CSRFToken', headers: {} },
    {
      endpoint: 'https://www.instagram.com/graphql/query',
      body: 'b',
      csrfHeader: 2,
      headers: {},
    },
    {
      endpoint: 'https://www.instagram.com/graphql/query',
      body: 'b',
      csrfHeader: 'X-CSRFToken',
      headers: { 'X-IG-App-ID': 12 },
    },
  ])('rejects malformed bridge request %#', (value) => {
    expect(validateBridgeRequest(value)).toBeUndefined();
  });
  it('rejects a Cookie-named header in a bridge request', () => {
    expect(
      validateBridgeRequest({
        endpoint: 'https://www.instagram.com/graphql/query',
        body: 'doc_id=1',
        csrfHeader: 'X-CSRFToken',
        headers: { Cookie: 'sessionid=leaked' },
      }),
    ).toBeUndefined();
  });
  it('accepts a well-formed request and preserves the CSRF header name only', () => {
    const parsed = validateBridgeRequest({
      endpoint: 'https://www.instagram.com/graphql/query',
      body: 'doc_id=1',
      csrfHeader: 'X-CSRFToken',
      headers: { 'X-IG-App-ID': '936619743392459' },
      csrfToken: 'token-value',
    });
    expect(parsed).toMatchObject({
      endpoint: 'https://www.instagram.com/graphql/query',
      csrfHeader: 'X-CSRFToken',
      csrfToken: 'token-value',
    });
  });
  it.each([
    undefined,
    null,
    {},
    { reached: 'yes', httpStatus: 200, responseKind: 'JSON', csrfUsed: false },
    { reached: true, httpStatus: '200', responseKind: 'JSON', csrfUsed: false },
    { reached: true, httpStatus: 200, responseKind: 'BLOB', csrfUsed: false },
    { reached: true, httpStatus: 200, responseKind: 'JSON' },
  ])('rejects malformed injected outcome %#', (value) => {
    expect(validateInjectedOutcome(value)).toBeUndefined();
  });
  it('drops cookie, session and unknown fields from an injected outcome', () => {
    const result = validateInjectedOutcome({
      reached: true,
      httpStatus: 200,
      responseKind: 'JSON',
      csrfUsed: true,
      jsonText: '{"data":null}',
      cookie: 'csrftoken=leaked',
      sessionid: 'leaked',
      authorization: 'leaked',
      headers: { Cookie: 'leaked' },
      pageState: { leaked: true },
    });
    expect(result).toBeDefined();
    expect(Object.keys(result ?? {})).not.toContain('cookie');
    expect(Object.keys(result ?? {})).not.toContain('sessionid');
    expect(Object.keys(result ?? {})).not.toContain('authorization');
    expect(Object.keys(result ?? {})).not.toContain('headers');
    expect(JSON.stringify(result)).not.toContain('leaked');
  });
  it('keeps the injected function free of cookie and storage access', () => {
    const source = authenticatedRequestFunction.toString();
    expect(source).not.toContain('document.cookie');
    expect(source).not.toContain('sessionid');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('indexedDB');
    expect(source).not.toContain('chrome.cookies');
    expect(source).toMatch(/credentials:\s*['"]include['"]/);
  });
});

describe('parser and normalizer reuse', () => {
  it('resolves a mocked authenticated response through the existing pipeline', () => {
    const result = classifyStrategyOutcome(
      'main-world',
      raw({
        jsonText: JSON.stringify(authenticatedImageResponse),
        csrfUsed: true,
      }),
      ref,
    );
    expect(result).toMatchObject({
      strategy: 'main-world',
      status: 'SUCCESS',
      responseKind: 'JSON',
      assetCount: 1,
      assetTypes: ['image'],
    });
    const media = parseInstagramMediaResponse(
      authenticatedImageResponse,
      ref.shortcode,
    );
    const resolved = normalizeInstagramMedia(media, ref.canonicalUrl);
    expect(resolved.post.assets).toHaveLength(1);
    expect(resolved.post.id).toBe(ref.shortcode);
  });
  it('classifies unknown media structure as PARSER_OUTDATED', () => {
    const result = classifyStrategyOutcome(
      'main-world',
      raw({
        jsonText: JSON.stringify({
          data: {
            xdt_api__v1__media__shortcode__web_info: {
              items: [{ media_type: 99 }],
            },
          },
        }),
      }),
      ref,
    );
    expect(result.status).toBe('PARSER_OUTDATED');
  });
});

describe('isolated strategy classification', () => {
  it.each([
    [
      raw({
        reached: false,
        httpStatus: 0,
        responseKind: 'EMPTY',
        error: 'BROWSER_RESTRICTION',
      }),
      'BROWSER_RESTRICTION',
    ],
    [
      raw({
        reached: false,
        httpStatus: 0,
        responseKind: 'EMPTY',
        error: 'NETWORK_ERROR',
      }),
      'NETWORK_ERROR',
    ],
    [raw({ httpStatus: 403 }), 'LOGIN_REQUIRED'],
    [raw({ responseKind: 'HTML' }), 'LOGIN_REQUIRED'],
    [raw({ httpStatus: 500 }), 'HTTP_ERROR'],
    [raw({ redirected: true }), 'LOGIN_REQUIRED'],
    [raw({ jsonText: '<not json>' }), 'GRAPHQL_EXECUTION_ERROR'],
    [
      raw({
        jsonText: JSON.stringify({
          data: null,
          errors: [{ message: 'Fictional execution error' }],
        }),
      }),
      'GRAPHQL_EXECUTION_ERROR',
    ],
  ] as const)('classifies isolated outcome %#', (outcome, expected) => {
    expect(
      classifyStrategyOutcome('isolated-content-script', outcome, ref).status,
    ).toBe(expected);
  });
});

describe('background strategy classification', () => {
  it('targets only the Instagram profile and never the UniFetch Resolver', () => {
    const request = buildStrategyRequest(ref);
    expect(new URL(request.endpoint).origin).toBe('https://www.instagram.com');
    const names = Object.keys(request.headers).map((name) =>
      name.toLowerCase(),
    );
    expect(names).not.toContain('cookie');
    expect(names).not.toContain('authorization');
  });
  it('classifies a successful background fetch as SUCCESS without a Cookie header', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse(authenticatedImageResponse),
    );
    const outcome = await runBackgroundFetch(
      buildStrategyRequest(ref),
      undefined,
      fetchImpl,
    );
    const result = classifyStrategyOutcome('background-fetch', outcome, ref);
    expect(result).toMatchObject({
      strategy: 'background-fetch',
      status: 'SUCCESS',
      assetCount: 1,
      assetTypes: ['image'],
    });
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    const names = Object.keys(
      (init.headers ?? {}) as Record<string, string>,
    ).map((name) => name.toLowerCase());
    expect(names).not.toContain('cookie');
    expect(init.credentials).toBe('include');
  });
  it('uses a bootstrap CSRF value when available and never constructs a Cookie header', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse(authenticatedImageResponse),
    );
    await runBackgroundFetch(
      buildStrategyRequest(ref),
      'fictional-token',
      fetchImpl,
    );
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ 'X-CSRFToken': 'fictional-token' });
    expect(
      Object.keys((init.headers ?? {}) as Record<string, string>),
    ).not.toContain('Cookie');
  });
  it('classifies a background network failure as NETWORK_ERROR', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const outcome = await runBackgroundFetch(
      buildStrategyRequest(ref),
      undefined,
      fetchImpl,
    );
    expect(
      classifyStrategyOutcome('background-fetch', outcome, ref).status,
    ).toBe('NETWORK_ERROR');
  });
});

describe('CSRF context', () => {
  it('extracts a CSRF value from bootstrap HTML and returns undefined otherwise', () => {
    expect(extractCsrfToken('<script>{"csrf_token":"abc123"}</script>')).toBe(
      'abc123',
    );
    expect(extractCsrfToken('<html>no token here</html>')).toBeUndefined();
  });
  it('reads bootstrap HTML with credentials, never through a cookie API', async () => {
    const fetchImpl = vi.fn<FetchLike>(async (_url, init) => {
      expect(init?.credentials).toBe('include');
      return htmlResponse('{"csrf_token":"token-1"}');
    });
    await expect(
      prepareCsrfContext('https://www.instagram.com', fetchImpl),
    ).resolves.toBe('token-1');
  });
});

describe('strategy independence', () => {
  it('tests every strategy even when one throws', async () => {
    const seen: string[] = [];
    const results = await runStrategyMatrix(
      async (strategy): Promise<AuthenticatedStrategyResult> => {
        seen.push(strategy);
        if (strategy === 'main-world') throw new Error('injection failed');
        return { strategy, status: 'SUCCESS' };
      },
    );
    expect(seen).toEqual([
      'background-fetch',
      'isolated-content-script',
      'main-world',
    ]);
    expect(results).toHaveLength(3);
    expect(
      results.find((result) => result.strategy === 'main-world')?.status,
    ).toBe('UNKNOWN');
    expect(
      results.filter((result) => result.status === 'SUCCESS'),
    ).toHaveLength(2);
  });
});

describe('preflight tab URL detection', () => {
  it.each([
    ['/p/Abc_12/', 'post'],
    ['/p/Abc_12', 'post'],
    ['/reel/Abc_12/', 'reel'],
    ['/reels/Abc_12/', 'reel'],
    ['/', 'root'],
    ['', 'root'],
    ['/someuser/', 'profile-like'],
    ['/someuser/p/Abc_12/', 'other'],
    ['/explore/', 'profile-like'],
    ['/someuser/reel/Abc_12/extra/', 'other'],
  ])('categorizes %s as %s', (pathname, expected) => {
    expect(categorizePath(pathname)).toBe(expected);
  });
  it('never exposes the full URL or shortcode in a diagnostic', () => {
    const diagnostic = describeUrl(
      'https://www.instagram.com/p/SECRETCODE/?igsh=secret',
      'scripting-location',
    );
    const text = JSON.stringify(diagnostic);
    expect(text).not.toContain('SECRETCODE');
    expect(text).not.toContain('igsh');
    expect(text).not.toContain('https://');
    expect(diagnostic).toMatchObject({
      hostname: 'www.instagram.com',
      pathCategory: 'post',
      urlObtained: true,
      source: 'scripting-location',
    });
  });
  it('resolves a direct post URL candidate', () => {
    const result = resolveContentRef([
      {
        url: 'https://www.instagram.com/p/Abc_12/',
        source: 'scripting-location',
      },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.ref.canonicalUrl).toBe(
        'https://www.instagram.com/p/Abc_12/',
      );
  });
  it('falls back to a canonical URL when the address bar is not a post path', () => {
    const result = resolveContentRef([
      {
        url: 'https://www.instagram.com/someuser/',
        source: 'scripting-location',
      },
      { url: 'https://www.instagram.com/p/Abc_12/', source: 'canonical' },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.ref.canonicalUrl).toBe(
        'https://www.instagram.com/p/Abc_12/',
      );
  });
  it('reports a sanitized diagnostic when every candidate fails', () => {
    const result = resolveContentRef([
      {
        url: 'https://www.instagram.com/someuser/p/Abc_12/',
        source: 'scripting-location',
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic).toMatchObject({
        hostname: 'www.instagram.com',
        pathCategory: 'other',
        urlObtained: true,
        source: 'scripting-location',
      });
      expect(JSON.stringify(result.diagnostic)).not.toContain('someuser');
    }
  });
  it('reports when no active tab URL was obtained', () => {
    const result = resolveContentRef([{ url: undefined, source: 'none' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.urlObtained).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UniFetchError,
  type RuntimeAdapter,
  type RuntimeResponse,
} from '@unifetch/core';
import {
  parseInstagramContentRef,
  buildInstagramPostRootRequest,
  POLARIS_POST_ROOT_PROFILE_V1,
  PolarisPostRootAcquisitionAdapter,
  parseInstagramMediaResponse,
  normalizeInstagramMedia,
} from '@unifetch/meta-resolver/instagram';
import * as parser from './parser';
import * as normalizer from './normalize';
import image from './__fixtures__/single-image-response.json';

const ref = parseInstagramContentRef(
  'https://instagram.com/p/unifetch-acquisition-demo/',
);
const profile = POLARIS_POST_ROOT_PROFILE_V1;
const adapter = new PolarisPostRootAcquisitionAdapter();
function reply(raw: unknown, status = 200): RuntimeResponse {
  return {
    status,
    body: new TextEncoder().encode(JSON.stringify(raw)),
    contentType: 'application/json',
  };
}
function mockedRuntime(response = reply(image)) {
  const sessionRequest = vi.fn(async () => response);
  const prepareOriginSession = vi.fn(async () => ({ request: sessionRequest }));
  const runtime: RuntimeAdapter = {
    request: vi.fn(async () => {
      throw new Error('Use the runtime-owned origin session');
    }),
    capabilities: () => ({ downloads: true, crossOriginRequests: false }),
    download: vi.fn(async () => {}),
    prepareOriginSession,
  };
  return { runtime, sessionRequest, prepareOriginSession };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Instagram content references', () => {
  it.each(['instagram.com', 'www.instagram.com', 'm.instagram.com'])(
    'accepts post host %s',
    (host) => {
      expect(parseInstagramContentRef(`https://${host}/p/Ab_c-12/`)).toEqual({
        kind: 'post',
        shortcode: 'Ab_c-12',
        canonicalUrl: 'https://www.instagram.com/p/Ab_c-12/',
      });
    },
  );
  it.each(['instagram.com', 'www.instagram.com', 'm.instagram.com'])(
    'accepts Reel host %s',
    (host) =>
      expect(parseInstagramContentRef(`https://${host}/reel/Abc/`).kind).toBe(
        'reel',
      ),
  );
  it.each(['instagram.com', 'www.instagram.com'])(
    'canonicalizes /reels/ for %s',
    (host) =>
      expect(
        parseInstagramContentRef(`https://${host}/reels/Abc`).canonicalUrl,
      ).toBe('https://www.instagram.com/reel/Abc/'),
  );
  it('canonicalizes protocol, host, slash and known tracking deterministically', () => {
    const input =
      'http://m.instagram.com/reels/Abc?igsh=secret&utm_source=share&img_index=2#fragment';
    const first = parseInstagramContentRef(input);
    expect(first.canonicalUrl).toBe(
      'https://www.instagram.com/reel/Abc/?img_index=2',
    );
    expect(parseInstagramContentRef(first.canonicalUrl)).toEqual(first);
  });
  it.each([
    '/p',
    '/p/',
    '/p//',
    '/reel/',
    '/p/a/b/',
    '/p/a%20b/',
    '/p/a.b/',
    '/p/😺/',
  ])('rejects malformed path %s', (path) =>
    expect(() =>
      parseInstagramContentRef(`https://instagram.com${path}`),
    ).toThrow(expect.objectContaining({ code: 'INVALID_URL' })),
  );
  it.each(['/stories/example/', '/profile/', '/tv/Abc/', '/'])(
    'rejects unsupported path %s',
    (path) =>
      expect(() =>
        parseInstagramContentRef(`https://instagram.com${path}`),
      ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CONTENT' })),
  );
  it('rejects non-Instagram platforms', () =>
    expect(() =>
      parseInstagramContentRef('https://facebook.com/p/Abc/'),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_PLATFORM' })));
  it('accepts a URL object', () =>
    expect(parseInstagramContentRef(new URL(ref.canonicalUrl))).toEqual(ref));
});

describe('The single supplied endpoint profile and request builder', () => {
  it('contains exactly the supplied profile identifiers', () => {
    expect(profile).toMatchObject({
      name: 'PolarisPostRootQueryProfileV1',
      endpoint: 'https://www.instagram.com/graphql/query',
      method: 'POST',
      appId: '936619743392459',
      docId: '27128499623469141',
      version: 1,
    });
    expect(Object.isFrozen(profile)).toBe(true);
  });
  it('builds exact compact deterministic variables and form fields', () => {
    const request = buildInstagramPostRootRequest(ref);
    const body = new URLSearchParams(request.body);
    expect([...body.keys()]).toEqual([
      'variables',
      'doc_id',
      'server_timestamps',
    ]);
    expect(body.get('doc_id')).toBe(profile.docId);
    expect(body.get('server_timestamps')).toBe('true');
    expect(body.get('variables')).toBe(
      JSON.stringify({
        shortcode: ref.shortcode,
        __relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider: false,
      }),
    );
    expect(buildInstagramPostRootRequest(ref)).toEqual(request);
  });
  it('asks runtime to inject CSRF without receiving any token', () => {
    const request = buildInstagramPostRootRequest(ref);
    expect(request.url).toBe(profile.endpoint);
    expect(request.method).toBe('POST');
    expect(request.csrfHeader).toBe('X-CSRFToken');
    expect(request.headers).toEqual({
      ...profile.headers,
      'X-IG-App-ID': profile.appId,
    });
    expect(request.headers).not.toHaveProperty('X-CSRFToken');
    for (const name of [
      'cookie',
      'host',
      'origin',
      'connection',
      'content-length',
      'user-agent',
      'referer',
    ]) {
      expect(
        Object.keys(request.headers ?? {}).map((key) => key.toLowerCase()),
      ).not.toContain(name);
    }
  });
  it('rejects inconsistent references before transport', () =>
    expect(() =>
      buildInstagramPostRootRequest({ ...ref, shortcode: 'other' }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_URL' })));
});

describe('Offline mocked acquisition', () => {
  it('uses only RuntimeAdapter capabilities, never global fetch or M4A functions', async () => {
    const fetch = vi.fn(() => {
      throw new Error('No network permitted');
    });
    vi.stubGlobal('fetch', fetch);
    const parse = vi.spyOn(parser, 'parseInstagramMediaResponse');
    const normalize = vi.spyOn(normalizer, 'normalizeInstagramMedia');
    const { runtime, prepareOriginSession, sessionRequest } = mockedRuntime();
    const result = await adapter.acquirePublicMedia(ref, { runtime });
    expect(prepareOriginSession).toHaveBeenCalledExactlyOnceWith(
      'https://www.instagram.com',
      { csrfCookieName: 'csrftoken' },
    );
    expect(sessionRequest).toHaveBeenCalledExactlyOnceWith(
      buildInstagramPostRootRequest(ref),
    );
    expect(runtime.request).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    expect(normalize).not.toHaveBeenCalled();
    expect(result.raw).toEqual(image);
    expect(result.network).toEqual([
      { origin: 'https://www.instagram.com', purpose: 'metadata' },
    ]);
    expect(Object.keys(result)).toEqual(['raw', 'network']);
    expect(JSON.stringify(result.network)).not.toContain(ref.shortcode);
  });
  it('keeps absent media semantics distinct from parser drift', async () => {
    const { runtime } = mockedRuntime(
      reply({ data: { changed_schema: { value: 12 } } }),
    );
    await expect(
      adapter.acquirePublicMedia(ref, { runtime }),
    ).rejects.toMatchObject({ code: 'UNKNOWN' });
  });
  it('lets callers compose acquisition, parser and normalizer externally', async () => {
    const { runtime } = mockedRuntime();
    const result = await adapter.acquirePublicMedia(ref, { runtime });
    const media = parseInstagramMediaResponse(result.raw, ref.shortcode);
    const resolved = normalizeInstagramMedia(media, ref.canonicalUrl);
    expect(resolved.post.assets[0].type).toBe('image');
    expect(resolved.post.id).toBe(ref.shortcode);
    expect(resolved.trace.network).toEqual([]); // M4A stays offline; caller owns transport trace integration.
  });
  it('does not return cookies or tokens or use persistence', async () => {
    const storage = { setItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    const { runtime } = mockedRuntime();
    const result = await adapter.acquirePublicMedia(ref, { runtime });
    expect(result).not.toHaveProperty('cookies');
    expect(result).not.toHaveProperty('csrfToken');
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('rejects unsupported runtime sessions without speculative request fallback', async () => {
    const { runtime } = mockedRuntime();
    delete runtime.prepareOriginSession;
    await expect(
      adapter.acquirePublicMedia(ref, { runtime }),
    ).rejects.toMatchObject({ code: 'BROWSER_RESTRICTION' });
    expect(runtime.request).not.toHaveBeenCalled();
  });
  it.each([
    [429, 'RATE_LIMITED'],
    [302, 'LOGIN_REQUIRED'],
    [401, 'LOGIN_REQUIRED'],
    [403, 'LOGIN_REQUIRED'],
    [404, 'CONTENT_UNAVAILABLE'],
    [410, 'CONTENT_UNAVAILABLE'],
    [500, 'UNKNOWN'],
    [0, 'BROWSER_RESTRICTION'],
  ] as const)('classifies HTTP %s as %s', async (status, code) => {
    const { runtime } = mockedRuntime(reply({}, status));
    await expect(
      adapter.acquirePublicMedia(ref, { runtime }),
    ).rejects.toMatchObject({ code });
  });
  it('classifies a readable redirected response as login required', async () => {
    const { runtime } = mockedRuntime({ ...reply({}), redirected: true });
    await expect(
      adapter.acquirePublicMedia(ref, { runtime }),
    ).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
  });
  it.each(['bootstrap', 'post'])(
    'maps untyped runtime failure at %s to UNKNOWN',
    async (stage) => {
      const { runtime, prepareOriginSession, sessionRequest } = mockedRuntime();
      const failure = new Error('Sensitive transport details');
      if (stage === 'bootstrap')
        prepareOriginSession.mockRejectedValueOnce(failure);
      else sessionRequest.mockRejectedValueOnce(failure);
      await expect(
        adapter.acquirePublicMedia(ref, { runtime }),
      ).rejects.toMatchObject({
        code: 'UNKNOWN',
        message: 'Instagram metadata could not be processed.',
      });
    },
  );
  it.each(['bootstrap', 'post'])(
    'preserves browser restriction at %s',
    async (stage) => {
      const { runtime, prepareOriginSession, sessionRequest } = mockedRuntime();
      const failure = new UniFetchError(
        'BROWSER_RESTRICTION',
        'Browser blocked the session',
      );
      if (stage === 'bootstrap')
        prepareOriginSession.mockRejectedValueOnce(failure);
      else sessionRequest.mockRejectedValueOnce(failure);
      await expect(
        adapter.acquirePublicMedia(ref, { runtime }),
      ).rejects.toMatchObject({ code: 'BROWSER_RESTRICTION' });
    },
  );
  it.each([
    ['Rate limit exceeded', 'RATE_LIMITED'],
    ['Too many requests', 'RATE_LIMITED'],
    ['login_required', 'LOGIN_REQUIRED'],
    ['Authentication is required', 'LOGIN_REQUIRED'],
    ['Please log in to continue', 'LOGIN_REQUIRED'],
    ['You must be logged in', 'LOGIN_REQUIRED'],
    ['Media not found', 'CONTENT_UNAVAILABLE'],
    ['Media is unavailable', 'CONTENT_UNAVAILABLE'],
  ] as const)('classifies explicit GraphQL error %s', async (message, code) => {
    const { runtime } = mockedRuntime(
      reply({ data: null, errors: [{ message }] }),
    );
    await expect(
      adapter.acquirePublicMedia(ref, { runtime }),
    ).rejects.toMatchObject({ code });
  });
  it.each([
    { login_required: true },
    { require_login: true },
    { status: 'fail', message: 'login_required' },
  ])('classifies explicit authentication response %j', async (raw) => {
    const { runtime } = mockedRuntime(reply(raw));
    await expect(
      adapter.acquirePublicMedia(ref, { runtime }),
    ).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
  });
  it('classifies generic execution errors before downstream media parsing', async () => {
    const { runtime } = mockedRuntime(
      reply({ data: null, errors: [{ message: 'Fictional execution error' }] }),
    );
    await expect(
      adapter.acquirePublicMedia(ref, { runtime }),
    ).rejects.toMatchObject({ code: 'GRAPHQL_EXECUTION_ERROR' });
  });
  it('data takes precedence over partial GraphQL errors', async () => {
    const raw = { ...image, errors: [{ message: 'Rate limit exceeded' }] };
    const { runtime } = mockedRuntime(reply(raw));
    expect((await adapter.acquirePublicMedia(ref, { runtime })).raw).toEqual(
      raw,
    );
  });
  it('handles unrecognized malformed error entries without crashing', async () => {
    const { runtime } = mockedRuntime(
      reply({ data: null, errors: [null, 42, {}, 'Fictional failure'] }),
    );
    await expect(
      adapter.acquirePublicMedia(ref, { runtime }),
    ).rejects.toMatchObject({ code: 'GRAPHQL_EXECUTION_ERROR' });
  });
  it('rejects non-JSON HTTP 200 without exposing payload', async () => {
    const { runtime } = mockedRuntime({
      status: 200,
      body: new TextEncoder().encode('<html>SENSITIVE</html>'),
    });
    await expect(
      adapter.acquirePublicMedia(ref, { runtime }),
    ).rejects.toMatchObject({
      code: 'GRAPHQL_EXECUTION_ERROR',
      message: expect.not.stringContaining('SENSITIVE'),
    });
  });
  it('issues exactly one profile request, with no retries or fallbacks', async () => {
    const { runtime, sessionRequest } = mockedRuntime(reply({}, 429));
    await expect(
      adapter.acquirePublicMedia(ref, { runtime }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(sessionRequest).toHaveBeenCalledTimes(1);
  });
});

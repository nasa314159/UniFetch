import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UniFetchError } from '@unifetch/core';
import { WebRuntime } from './index';

const origin = 'https://unifetch.invalid';
const cookieContext = {
  cookie: 'csrftoken=runtime-private-token; unrelated=not-exported',
};
const runtime = new WebRuntime();
const fetch = vi.fn<typeof globalThis.fetch>();
beforeEach(() => {
  cookieContext.cookie =
    'csrftoken=runtime-private-token; unrelated=not-exported';
  vi.stubGlobal('window', { location: { origin } });
  vi.stubGlobal('document', cookieContext);
  vi.stubGlobal('fetch', fetch);
  fetch.mockReset().mockImplementation(
    async () =>
      new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WebRuntime standards-compliant transport and origin sessions', () => {
  it('keeps ordinary requests credential-free and uncached', async () => {
    const result = await runtime.request({
      url: '/demo/sample',
      method: 'POST',
      body: 'example=1',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(result.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: 'example=1',
      credentials: 'omit',
      mode: 'same-origin',
      redirect: 'manual',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  });
  it('rejects cross-origin session before any fetch or cookie access', async () => {
    const cookie = vi.spyOn(cookieContext, 'cookie', 'get');
    await expect(
      runtime.prepareOriginSession('https://www.instagram.com', {
        csrfCookieName: 'csrftoken',
      }),
    ).rejects.toMatchObject({ code: 'BROWSER_RESTRICTION' });
    expect(fetch).not.toHaveBeenCalled();
    expect(cookie).not.toHaveBeenCalled();
  });
  it('performs runtime-owned bootstrap and injects CSRF privately', async () => {
    const session = await runtime.prepareOriginSession(origin, {
      csrfCookieName: 'csrftoken',
    });
    expect(fetch.mock.calls[0][0].toString()).toBe(`${origin}/`);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
    });
    expect(Object.keys(session)).toEqual(['request']);
    const result = await session.request({
      url: `${origin}/metadata`,
      method: 'POST',
      body: 'a=1',
      csrfHeader: 'X-CSRFToken',
    });
    const options = fetch.mock.calls[1][1];
    expect(new Headers(options?.headers).get('X-CSRFToken')).toBe(
      'runtime-private-token',
    );
    expect(options).toMatchObject({
      credentials: 'same-origin',
      cache: 'no-store',
      mode: 'same-origin',
    });
    expect(result).not.toHaveProperty('cookies');
    expect(result).not.toHaveProperty('csrfToken');
    expect(JSON.stringify(session)).not.toContain('runtime-private-token');
  });
  it('does not persist or retain a CSRF snapshot between requests', async () => {
    const storage = { setItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    const session = await runtime.prepareOriginSession(origin, {
      csrfCookieName: 'csrftoken',
    });
    cookieContext.cookie = 'csrftoken=rotated-private-token';
    await session.request({
      url: `${origin}/metadata`,
      method: 'POST',
      csrfHeader: 'X-CSRFToken',
    });
    expect(
      new Headers(fetch.mock.calls[1][1]?.headers).get('X-CSRFToken'),
    ).toBe('rotated-private-token');
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('rejects inaccessible CSRF context after bootstrap', async () => {
    cookieContext.cookie = 'unrelated=not-a-token';
    await expect(
      runtime.prepareOriginSession(origin, { csrfCookieName: 'csrftoken' }),
    ).rejects.toMatchObject({ code: 'BROWSER_RESTRICTION' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('handles browser-denied cookie access without exporting the exception', async () => {
    vi.stubGlobal('document', {
      get cookie() {
        throw new Error('Private cookie details');
      },
    });
    await expect(
      runtime.prepareOriginSession(origin, { csrfCookieName: 'csrftoken' }),
    ).rejects.toMatchObject({
      code: 'BROWSER_RESTRICTION',
      message: expect.not.stringContaining('Private cookie details'),
    });
  });
  it('rejects a CSRF context that disappears before POST', async () => {
    const session = await runtime.prepareOriginSession(origin, {
      csrfCookieName: 'csrftoken',
    });
    cookieContext.cookie = '';
    await expect(
      session.request({ url: `${origin}/metadata`, csrfHeader: 'X-CSRFToken' }),
    ).rejects.toMatchObject({ code: 'BROWSER_RESTRICTION' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('binds session requests to their origin', async () => {
    const session = await runtime.prepareOriginSession(origin, {
      csrfCookieName: 'csrftoken',
    });
    await expect(
      session.request({
        url: 'https://evil.invalid/collect',
        csrfHeader: 'X-CSRFToken',
      }),
    ).rejects.toMatchObject({ code: 'BROWSER_RESTRICTION' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    'https://other.invalid/',
    'javascript:alert(1)',
    'https://user:pass@unifetch.invalid/',
  ])('rejects restricted URL %s without fetch', async (url) => {
    await expect(runtime.request({ url })).rejects.toMatchObject({
      code: 'BROWSER_RESTRICTION',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['opaque', 'opaqueredirect'])(
    'rejects browser-hidden %s response',
    async (type) => {
      fetch.mockResolvedValueOnce({ type, status: 0 } as Response);
      await expect(runtime.request({ url: '/' })).rejects.toMatchObject({
        code: 'BROWSER_RESTRICTION',
      });
    },
  );
  it('maps network transport failure to NETWORK_ERROR', async () => {
    fetch.mockRejectedValueOnce(new TypeError('Transport failed'));
    await expect(runtime.request({ url: '/' })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });
  it('preserves typed browser policy errors', async () => {
    fetch.mockRejectedValueOnce(
      new UniFetchError('BROWSER_RESTRICTION', 'Blocked by browser policy'),
    );
    await expect(runtime.request({ url: '/' })).rejects.toMatchObject({
      code: 'BROWSER_RESTRICTION',
    });
  });
  it.each([
    [429, 'RATE_LIMITED'],
    [302, 'LOGIN_REQUIRED'],
    [401, 'LOGIN_REQUIRED'],
    [403, 'LOGIN_REQUIRED'],
    [404, 'CONTENT_UNAVAILABLE'],
    [500, 'NETWORK_ERROR'],
  ] as const)('classifies bootstrap HTTP %s', async (status, code) => {
    fetch.mockResolvedValueOnce(new Response('{}', { status }));
    await expect(
      runtime.prepareOriginSession(origin, { csrfCookieName: 'csrftoken' }),
    ).rejects.toMatchObject({ code });
  });
  it.each([
    'Host',
    'Origin',
    'Connection',
    'Content-Length',
    'User-Agent',
    'Cookie',
    'Referer',
    'Sec-Fetch-Site',
    'Proxy-Authorization',
  ])('does not try to set browser-owned %s header', async (name) => {
    await expect(
      runtime.request({ url: '/', headers: { [name]: 'forbidden' } }),
    ).rejects.toMatchObject({ code: 'BROWSER_RESTRICTION' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects browser-owned CSRF header injection targets', async () => {
    const session = await runtime.prepareOriginSession(origin, {
      csrfCookieName: 'csrftoken',
    });
    await expect(
      session.request({ url: '/', csrfHeader: 'Cookie' }),
    ).rejects.toMatchObject({ code: 'BROWSER_RESTRICTION' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([`${origin}/path`, `${origin}/?query=1`])(
    'rejects a non-origin session configuration %s',
    async (url) => {
      await expect(
        runtime.prepareOriginSession(url, { csrfCookieName: 'csrftoken' }),
      ).rejects.toMatchObject({ code: 'BROWSER_RESTRICTION' });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

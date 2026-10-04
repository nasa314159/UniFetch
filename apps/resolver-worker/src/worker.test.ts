import { describe, expect, it, vi } from 'vitest';
import { createWorker } from './index';
import { POLARIS_POST_ROOT_PROFILE_V1 as profile } from '@unifetch/meta-resolver/instagram';
import { resolverApiResponseSchema } from '@unifetch/core';
import image from '../../../packages/meta-resolver/src/instagram/__fixtures__/single-image-response.json';
import carousel from '../../../packages/meta-resolver/src/instagram/__fixtures__/carousel-response.json';
import reel from '../../../packages/meta-resolver/src/instagram/__fixtures__/reel-response.json';
const env = { ALLOWED_ORIGINS: 'https://web.invalid,http://127.0.0.1:5173' };
const api = 'https://resolver.invalid/api/resolve';
function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(api, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://web.invalid',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
function setup(raw: unknown = image, status = 200) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response('bootstrap', {
        status: 200,
        headers: {
          'Set-Cookie': 'csrftoken=private-test-token; Path=/; Secure',
        },
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify(raw), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  return { worker: createWorker(fetcher), fetcher };
}
describe('Metadata-only Worker API', () => {
  it.each([
    ['p', image, 1],
    ['p', carousel, 4],
    ['reel', reel, 1],
    ['reels', reel, 1],
  ] as const)(
    'resolves /%s/ from sanitized upstream metadata',
    async (path, raw, count) => {
      const { worker, fetcher } = setup(raw);
      const response = await worker.fetch(
        post({ url: `https://www.instagram.com/${path}/synthetic-M5/` }),
        env,
      );
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.result.post.assets).toHaveLength(count);
      expect(body.result.post.canonicalUrl).toBe(
        `https://www.instagram.com/${path === 'p' ? 'p' : 'reel'}/synthetic-M5/`,
      );
      expect(resolverApiResponseSchema.safeParse(body).success).toBe(true);
      expect(body.result.trace).toMatchObject({
        processedLocally: false,
        remoteProxyUsed: true,
        metadataResolverUsed: true,
        mediaProxyUsed: false,
        credentialsExported: false,
      });
      expect(body.transport).toEqual({
        metadataResolver: 'unifetch-cloudflare-worker',
        mediaProxyUsed: false,
      });
      expect(fetcher.mock.calls.map((call) => String(call[0]))).toEqual([
        `${new URL(profile.endpoint).origin}/`,
        profile.endpoint,
      ]);
      expect(
        fetcher.mock.calls.every(
          (call) =>
            call[1]?.cache === 'no-store' && call[1]?.redirect === 'manual',
        ),
      ).toBe(true);
      const options = fetcher.mock.calls[1][1];
      const fields = new URLSearchParams(String(options?.body));
      expect(fields.get('doc_id')).toBe(profile.docId);
      expect(new Headers(options?.headers).get('X-IG-App-ID')).toBe(
        profile.appId,
      );
      expect(new Headers(options?.headers).get('X-CSRFToken')).toBe(
        'private-test-token',
      );
      expect(new Headers(options?.headers).get('Cookie')).toContain(
        'csrftoken=private-test-token',
      );
      expect(JSON.stringify(body)).not.toContain('private-test-token');
      expect(JSON.stringify(body)).not.toContain('image_versions2');
      expect(JSON.stringify(body)).not.toContain('video_versions');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.has('Set-Cookie')).toBe(false);
    },
  );
  it.each([
    'https://example.com/p/a/',
    'javascript:alert(1)',
    'data:text/plain,a',
    'file:///tmp/a',
    'http://localhost/p/a/',
    'https://127.0.0.1/p/a/',
    'https://[::1]/p/a/',
    'https://facebook.com/p/a/',
    'https://instagram.com/stories/a/',
    'http://instagram.com/p/a/',
    'https://user:pass@instagram.com/p/a/',
    'https://instagram.com:8080/p/a/',
    'https://instagram.com.evil.invalid/p/a/',
    'https://m.instagram.com/reel/a/',
  ])('rejects unsafe or unsupported URL %s', async (url) => {
    const { worker, fetcher } = setup();
    const response = await worker.fetch(post({ url }), env);
    expect(response.status).toBe(400);
    expect((await response.json()).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { url: ['https://instagram.com/p/a/'] },
    { url: 'https://instagram.com/p/a/', cookies: 'private' },
    { shortcode: 'abc' },
    { url: 'https://instagram.com/p/a/', headers: {} },
    { url: 'https://instagram.com/p/a/', upstream: 'https://localhost/' },
    { url: 'https://instagram.com/p/a/', token: 'x' },
    {},
  ])('rejects unexpected request structure %j', async (body) => {
    const { worker, fetcher } = setup();
    const response = await worker.fetch(post(body), env);
    expect((await response.json()).error.code).toBe('INVALID_URL');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects GET and reports Allow', async () => {
    const { worker } = setup();
    const response = await worker.fetch(new Request(api), env);
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST, OPTIONS');
  });
  it('handles configured CORS preflight without credentials', async () => {
    const { worker, fetcher } = setup();
    const response = await worker.fetch(
      new Request(api, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://web.invalid',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      }),
      env,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://web.invalid',
    );
    expect(response.headers.has('Access-Control-Allow-Credentials')).toBe(
      false,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not grant CORS to unconfigured origins', async () => {
    const { worker, fetcher } = setup();
    const response = await worker.fetch(
      post(
        { url: 'https://instagram.com/p/a/' },
        { Origin: 'https://evil.invalid' },
      ),
      env,
    );
    expect(response.status).toBe(403);
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects auth-header preflight', async () => {
    const { worker } = setup();
    const response = await worker.fetch(
      new Request(api, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://web.invalid',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization',
        },
      }),
      env,
    );
    expect(response.status).toBe(400);
  });
  it.each(['Cookie', 'Authorization'])(
    'rejects client %s credential headers',
    async (name) => {
      const { worker, fetcher } = setup();
      const response = await worker.fetch(
        post({ url: 'https://instagram.com/p/a/' }, { [name]: 'private' }),
        env,
      );
      expect((await response.json()).error.code).toBe('INVALID_URL');
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it('rejects malformed JSON', async () => {
    const { worker } = setup();
    const response = await worker.fetch(
      new Request(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      }),
      env,
    );
    expect((await response.json()).error.code).toBe('INVALID_URL');
  });
  it.each(['text/plain', 'application/x-www-form-urlencoded'])(
    'rejects non-JSON content type %s',
    async (content) => {
      const { worker } = setup();
      const response = await worker.fetch(
        post(
          { url: 'https://instagram.com/p/a/' },
          { 'Content-Type': content },
        ),
        env,
      );
      expect(response.status).toBe(400);
    },
  );
  it('bounds actual streamed bytes even without Content-Length', async () => {
    const { worker, fetcher } = setup();
    const response = await worker.fetch(
      new Request(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: ' '.repeat(4097),
      }),
      env,
    );
    expect((await response.json()).error.code).toBe('INVALID_URL');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['/api/media', '/api/download', '/api/proxy'])(
    'has no media relay route %s',
    async (path) => {
      const { worker, fetcher } = setup();
      const response = await worker.fetch(
        new Request(`https://resolver.invalid${path}`, { method: 'POST' }),
        env,
      );
      expect(response.status).toBe(404);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each([
    [429, 'RATE_LIMITED'],
    [401, 'LOGIN_REQUIRED'],
    [404, 'CONTENT_UNAVAILABLE'],
  ] as const)('classifies upstream %s', async (status, code) => {
    const { worker } = setup({}, status);
    const response = await worker.fetch(
      post({ url: 'https://instagram.com/p/synthetic-error/' }),
      env,
    );
    expect((await response.json()).error.code).toBe(code);
  });
  it('classifies structured authentication error', async () => {
    const { worker } = setup({
      data: null,
      errors: [{ message: 'login_required' }],
    });
    const response = await worker.fetch(
      post({ url: 'https://instagram.com/p/synthetic-auth/' }),
      env,
    );
    expect((await response.json()).error.code).toBe('LOGIN_REQUIRED');
  });
  it('does not call an absent media root parser drift', async () => {
    const { worker } = setup({ data: { changed: true } });
    const response = await worker.fetch(
      post({ url: 'https://instagram.com/p/synthetic-drift/' }),
      env,
    );
    expect((await response.json()).error.code).toBe('UNKNOWN');
  });
  it('classifies network failure without exception details', async () => {
    const { worker, fetcher } = setup();
    fetcher.mockReset().mockRejectedValue(new Error('sensitive raw details'));
    const response = await worker.fetch(
      post({ url: 'https://instagram.com/p/synthetic-network/' }),
      env,
    );
    const body = await response.json();
    expect(body.error.code).toBe('NETWORK_ERROR');
    expect(JSON.stringify(body)).not.toContain('sensitive');
  });
  it('does not follow bootstrap redirects', async () => {
    const { worker, fetcher } = setup();
    fetcher.mockReset().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://evil.invalid/' },
      }),
    );
    const response = await worker.fetch(
      post({ url: 'https://instagram.com/p/synthetic-redirect/' }),
      env,
    );
    expect((await response.json()).error.code).toBe('LOGIN_REQUIRED');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('reports missing transient CSRF as login-required', async () => {
    const { worker, fetcher } = setup();
    fetcher.mockReset().mockResolvedValueOnce(new Response('bootstrap'));
    const response = await worker.fetch(
      post({ url: 'https://instagram.com/p/synthetic-session/' }),
      env,
    );
    expect((await response.json()).error.code).toBe('LOGIN_REQUIRED');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bounds upstream JSON', async () => {
    const { worker, fetcher } = setup();
    fetcher
      .mockReset()
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { 'Set-Cookie': 'csrftoken=transient; Path=/' },
        }),
      )
      .mockResolvedValueOnce(new Response(' '.repeat(1024 * 1024 + 1)));
    const response = await worker.fetch(
      post({ url: 'https://instagram.com/p/synthetic-large/' }),
      env,
    );
    expect((await response.json()).error.code).toBe('PARSER_OUTDATED');
  });
});

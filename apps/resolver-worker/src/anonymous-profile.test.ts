import { describe, expect, it, vi } from 'vitest';
import { createWorker } from './index';
import {
  anonymousRequestHeaders,
  createAnonymousCookieJar,
  cookieHeader,
} from './anonymous-profile';
import { POLARIS_POST_ROOT_PROFILE_V1 as profile } from '@unifetch/meta-resolver/instagram';
import type { DiagnosticRecord } from './diagnostics';
import image from '../../../packages/meta-resolver/src/instagram/__fixtures__/single-image-response.json';
const origin = new URL(profile.endpoint).origin;
const env = { ALLOWED_ORIGINS: '' };
function request() {
  return new Request('http://127.0.0.1/api/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: 'https://www.instagram.com/p/synthetic-anonymous/',
    }),
  });
}
function bootstrap(token = 'synthetic-transient-token') {
  return new Response(null, {
    headers: { 'Set-Cookie': `csrftoken=${token}; Path=/; Secure` },
  });
}
function metadata() {
  return new Response(JSON.stringify(image), {
    headers: { 'Content-Type': 'application/json' },
  });
}
describe('Worker anonymous request/session profile', () => {
  it('uses only deterministic ordinary request metadata and the existing app ID', () => {
    const headers = anonymousRequestHeaders();
    expect([...headers.keys()].sort()).toEqual([
      'accept',
      'accept-language',
      'referer',
      'user-agent',
      'x-ig-app-id',
    ]);
    expect(headers.get('Accept')).toContain('text/html');
    expect(headers.get('Accept-Language')).toBe(
      profile.headers['Accept-Language'],
    );
    expect(headers.get('Referer')).toBe(`${origin}/`);
    expect(headers.get('X-IG-App-ID')).toBe(profile.appId);
    expect(headers.get('User-Agent')).toMatch(
      /^Mozilla\/5\.0 .* Chrome\/124\.0\.0\.0 Safari\/537\.36$/,
    );
    expect(headers.has('Authorization')).toBe(false);
  });
  it('initializes only empty/generic anonymous cookie state with no sessionid', () => {
    const cookies = createAnonymousCookieJar();
    expect([...cookies]).toEqual([
      ['csrftoken', ''],
      ['mid', ''],
      ['ig_pr', '1'],
      ['ig_vw', '1920'],
      ['s_network', ''],
      ['ds_user_id', ''],
    ]);
    expect(cookies.has('sessionid')).toBe(false);
    expect(cookieHeader(cookies)).toBe(
      'csrftoken=; mid=; ig_pr=1; ig_vw=1920; s_network=; ds_user_id=',
    );
  });
  it('creates independent jars rather than reusable session state', () => {
    const first = createAnonymousCookieJar();
    first.set('csrftoken', 'synthetic-transient-token');
    const second = createAnonymousCookieJar();
    expect(second.get('csrftoken')).toBe('');
    first.clear();
    expect(second.get('ig_pr')).toBe('1');
  });
  it('uses the anonymous bootstrap profile and proceeds with the unchanged centralized GraphQL request', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(bootstrap())
      .mockResolvedValueOnce(metadata());
    const records: DiagnosticRecord[] = [];
    const response = await createWorker(fetcher, (record) =>
      records.push(record),
    ).fetch(request(), env);
    expect((await response.json()).ok).toBe(true);
    expect(fetcher.mock.calls.map((call) => String(call[0]))).toEqual([
      `${origin}/`,
      profile.endpoint,
    ]);
    const initial = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(initial.get('Cookie')).toBe(
      cookieHeader(createAnonymousCookieJar()),
    );
    expect(initial.get('Accept')).toBe(anonymousRequestHeaders().get('Accept'));
    const graph = new Headers(fetcher.mock.calls[1][1]?.headers);
    for (const key of [
      'Accept-Language',
      'Referer',
      'User-Agent',
      'X-IG-App-ID',
    ])
      expect(graph.get(key)).toBe(initial.get(key));
    expect(graph.get('Accept')).toBe(profile.headers.Accept);
    expect(graph.get('Content-Type')).toBe(profile.headers['Content-Type']);
    expect(graph.get(profile.csrfHeader)).toBe('synthetic-transient-token');
    const fields = new URLSearchParams(String(fetcher.mock.calls[1][1]?.body));
    expect(fields.get('doc_id')).toBe(profile.docId);
    expect(JSON.parse(fields.get('variables')!)).toEqual({
      shortcode: 'synthetic-anonymous',
      ...profile.variables,
    });
    expect(records).toContainEqual(
      expect.objectContaining({
        stage: 'SESSION_EXTRACTION',
        csrfTokenFound: true,
      }),
    );
    expect(JSON.stringify(records)).not.toContain('synthetic-transient-token');
    expect(response.headers.has('Set-Cookie')).toBe(false);
  });
  it('does not mistake the empty CSRF placeholder for an extracted token', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null));
    const records: DiagnosticRecord[] = [];
    const response = await createWorker(fetcher, (record) =>
      records.push(record),
    ).fetch(request(), env);
    expect((await response.json()).error.code).toBe('LOGIN_REQUIRED');
    expect(records).toContainEqual(
      expect.objectContaining({
        stage: 'SESSION_EXTRACTION',
        csrfTokenFound: false,
      }),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('stops on the bootstrap redirect without following it or making GraphQL requests', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: {
          Location: 'https://www.facebook.com/',
          'Content-Type': 'text/html',
        },
      }),
    );
    const response = await createWorker(fetcher).fetch(request(), env);
    expect((await response.json()).error.code).toBe('LOGIN_REQUIRED');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: 'manual',
      cache: 'no-store',
      credentials: 'omit',
    });
  });
  it('never forwards populated sessionid or account identifiers from bootstrap headers', async () => {
    const response = bootstrap();
    response.headers.append(
      'Set-Cookie',
      'sessionid=synthetic-forbidden-session; Path=/',
    );
    response.headers.append(
      'Set-Cookie',
      'ds_user_id=synthetic-forbidden-account; Path=/',
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(metadata());
    expect(
      (await (await createWorker(fetcher).fetch(request(), env)).json()).ok,
    ).toBe(true);
    const header = new Headers(fetcher.mock.calls[1][1]?.headers).get(
      'Cookie',
    )!;
    expect(header).not.toContain('sessionid=');
    expect(header).not.toContain('synthetic-forbidden');
    expect(header).toMatch(/(?:^|; )ds_user_id=(?:;|$)/);
  });
  it('does not reuse received cookie values across resolve requests or write application storage', async () => {
    const storage = { setItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    try {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(bootstrap('synthetic-first'))
        .mockResolvedValueOnce(metadata())
        .mockResolvedValueOnce(bootstrap('synthetic-second'))
        .mockResolvedValueOnce(metadata());
      const worker = createWorker(fetcher);
      expect((await (await worker.fetch(request(), env)).json()).ok).toBe(true);
      expect((await (await worker.fetch(request(), env)).json()).ok).toBe(true);
      const second = new Headers(fetcher.mock.calls[2][1]?.headers).get(
        'Cookie',
      );
      expect(second).toBe(cookieHeader(createAnonymousCookieJar()));
      expect(storage.setItem).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

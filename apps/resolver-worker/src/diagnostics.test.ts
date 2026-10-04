import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorker } from './index';
import diagnosticWorker from './dev-diagnostic';
import { type DiagnosticRecord, exceptionDetails } from './diagnostics';
import { POLARIS_POST_ROOT_PROFILE_V1 as profile } from '@unifetch/meta-resolver/instagram';
import raw from '../../../packages/meta-resolver/src/instagram/__fixtures__/single-image-response.json';
const env = { ALLOWED_ORIGINS: 'https://web.invalid' };
const input = 'https://www.instagram.com/p/synthetic-diagnostic-reference/';
const api = 'http://127.0.0.1:8788/api/resolve';
function request() {
  return new Request(api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: input }),
  });
}
function bootstrap() {
  const headers = new Headers();
  headers.append(
    'Set-Cookie',
    'sessionid=synthetic-private-session; Path=/; Secure',
  );
  headers.append(
    'Set-Cookie',
    'csrftoken=synthetic-private-csrf; Path=/; Secure',
  );
  return new Response(null, { headers });
}
function setup(
  first: Response | Error = bootstrap(),
  second: Response | Error = new Response(JSON.stringify(raw), {
    headers: { 'Content-Type': 'application/json' },
  }),
) {
  const fetcher = vi.fn<typeof fetch>();
  if (first instanceof Error) fetcher.mockRejectedValueOnce(first);
  else fetcher.mockResolvedValueOnce(first);
  if (second instanceof Error) fetcher.mockRejectedValueOnce(second);
  else fetcher.mockResolvedValueOnce(second);
  const records: DiagnosticRecord[] = [];
  return {
    fetcher,
    records,
    worker: createWorker(fetcher, (record) => records.push(record)),
  };
}
afterEach(() => vi.unstubAllGlobals());
describe('Internal Worker diagnostics and HTTP classification', () => {
  it('invokes injected standalone fetch without a runtime receiver for bootstrap and GraphQL', async () => {
    const calls: {
      receiver: unknown;
      input: RequestInfo | URL;
      init?: RequestInit;
    }[] = [];
    const fetcher = async function (
      this: unknown,
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      calls.push({ receiver: this, input, init });
      if (this !== undefined)
        throw new TypeError(
          'Illegal invocation: function called with incorrect this',
        );
      return calls.length === 1
        ? bootstrap()
        : new Response(JSON.stringify(raw), {
            headers: { 'Content-Type': 'application/json' },
          });
    };
    const records: DiagnosticRecord[] = [];
    const response = await createWorker(fetcher, (record) =>
      records.push(record),
    ).fetch(request(), env);
    expect((await response.json()).ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.receiver === undefined)).toBe(true);
    expect(calls.map((call) => String(call.input))).toEqual([
      `${new URL(profile.endpoint).origin}/`,
      profile.endpoint,
    ]);
    expect(calls[0].init).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'manual',
    });
    expect(calls[1].init).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'manual',
    });
    expect(calls[1].init?.body).toEqual(expect.any(String));
    expect(calls[1].init?.headers).toBeInstanceOf(Headers);
    expect(
      records.some(
        (record) =>
          record.fetchThrew || record.category === 'RUNTIME_BINDING_ERROR',
      ),
    ).toBe(false);
    expect(records.at(-1)?.stage).toBe('PARSER');
  });

  it('identifies a thrown bootstrap fetch as transport failure', async () => {
    const { worker, records, fetcher } = setup(
      new TypeError('TLS certificate failed for private input'),
    );
    const response = await worker.fetch(request(), env);
    expect((await response.json()).error.code).toBe('NETWORK_ERROR');
    expect(records).toMatchObject([
      {
        stage: 'BOOTSTRAP_REQUEST',
        fetchThrew: true,
        exceptionName: 'TypeError',
        category: 'TLS_FAILURE',
      },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 404, 429, 500, 503])(
    'HTTP %s bootstrap is not a transport failure',
    async (status) => {
      const { worker, records, fetcher } = setup(
        new Response(null, {
          status,
          headers: { 'Content-Type': 'text/html' },
        }),
      );
      const response = await worker.fetch(request(), env);
      const code = (await response.json()).error.code;
      expect(code).toBe(
        status === 429
          ? 'RATE_LIMITED'
          : status === 404
            ? 'CONTENT_UNAVAILABLE'
            : status < 500
              ? 'LOGIN_REQUIRED'
              : 'UNKNOWN',
      );
      expect(records[0]).toMatchObject({
        stage: 'BOOTSTRAP_REQUEST',
        fetchThrew: false,
        status,
      });
      expect(records[1]).toMatchObject({
        stage: 'BOOTSTRAP_RESPONSE',
        status,
        contentType: 'text/html',
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it.each([403, 429, 500, 503])(
    'HTTP %s GraphQL is not a transport failure',
    async (status) => {
      const { worker, records } = setup(
        bootstrap(),
        new Response(null, { status }),
      );
      const response = await worker.fetch(request(), env);
      const code = (await response.json()).error.code;
      expect(code).toBe(
        status === 429
          ? 'RATE_LIMITED'
          : status === 403
            ? 'LOGIN_REQUIRED'
            : 'UNKNOWN',
      );
      expect(records).toContainEqual(
        expect.objectContaining({ stage: 'GRAPHQL_RESPONSE', status }),
      );
    },
  );
  it('classifies login redirect and reveals hostname only', async () => {
    const { worker, records } = setup(
      new Response(null, {
        status: 302,
        headers: {
          Location:
            'https://www.instagram.com/accounts/login/?next=/private-path',
        },
      }),
    );
    expect((await (await worker.fetch(request(), env)).json()).error.code).toBe(
      'LOGIN_REQUIRED',
    );
    expect(records[1]).toMatchObject({
      redirected: true,
      redirectHostname: 'www.instagram.com',
    });
    expect(JSON.stringify(records)).not.toContain('/accounts/login/');
  });
  it('classifies a clear structured login response', async () => {
    const { worker } = setup(
      bootstrap(),
      new Response('{"login_required":true}', {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect((await (await worker.fetch(request(), env)).json()).error.code).toBe(
      'LOGIN_REQUIRED',
    );
  });
  it('separates HTTP 200 HTML from fetch failure', async () => {
    const { worker, records } = setup(
      bootstrap(),
      new Response('<html>synthetic challenge</html>', {
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    expect((await (await worker.fetch(request(), env)).json()).error.code).toBe(
      'GRAPHQL_EXECUTION_ERROR',
    );
    expect(records).toContainEqual(
      expect.objectContaining({
        stage: 'GRAPHQL_REQUEST',
        fetchThrew: false,
        status: 200,
      }),
    );
    expect(records).toContainEqual(
      expect.objectContaining({ stage: 'RESPONSE_READ', bodyKind: 'HTML' }),
    );
    expect(JSON.stringify(records)).not.toContain('synthetic challenge');
  });
  it.each(['{}', '{"data":{"unexpected":true}}'])(
    'keeps absent media semantics separate from parser failure',
    async (body) => {
      const { worker, records } = setup(
        bootstrap(),
        new Response(body, { headers: { 'Content-Type': 'application/json' } }),
      );
      expect(
        (await (await worker.fetch(request(), env)).json()).error.code,
      ).toBe('UNKNOWN');
      expect(records).toContainEqual(
        expect.objectContaining({
          stage: 'GRAPHQL_CLASSIFICATION',
          category: 'UNKNOWN',
        }),
      );
    },
  );
  it('classifies malformed JSON at the response read/JSON boundary', async () => {
    const { worker, records } = setup(
      bootstrap(),
      new Response('{broken', {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect((await (await worker.fetch(request(), env)).json()).error.code).toBe(
      'GRAPHQL_EXECUTION_ERROR',
    );
    expect(records).toContainEqual(
      expect.objectContaining({ stage: 'RESPONSE_READ', bodyKind: 'JSON' }),
    );
  });
  it('distinguishes visible Set-Cookie with missing CSRF internally', async () => {
    const { worker, records, fetcher } = setup(
      new Response(null, {
        headers: {
          'Set-Cookie': 'sessionid=synthetic-private-session; Path=/',
        },
      }),
    );
    expect((await (await worker.fetch(request(), env)).json()).error.code).toBe(
      'LOGIN_REQUIRED',
    );
    expect(records).toContainEqual(
      expect.objectContaining({
        stage: 'SESSION_EXTRACTION',
        setCookiePresent: true,
        csrfTokenFound: false,
      }),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('extracts multiple cookies but never exposes values or input in observations', async () => {
    const { worker, records } = setup();
    const response = await worker.fetch(request(), env);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body).not.toHaveProperty('diagnostics');
    expect(records).toContainEqual(
      expect.objectContaining({
        stage: 'SESSION_EXTRACTION',
        setCookiePresent: true,
        csrfTokenFound: true,
      }),
    );
    const output = JSON.stringify(records);
    for (const secret of [
      input,
      'synthetic-diagnostic-reference',
      'synthetic-private-csrf',
      'synthetic-private-session',
      'csrftoken=',
      'sessionid=',
      'variables',
      'media.invalid',
    ])
      expect(output).not.toContain(secret);
    expect(records.every((record) => Number.isFinite(record.elapsedMs))).toBe(
      true,
    );
  });
  it('uses combined Set-Cookie fallback without splitting an Expires date incorrectly', async () => {
    const response = new Response(null, {
      headers: {
        'Set-Cookie':
          'sessionid=private; Expires=Wed, 21 Oct 2037 07:28:00 GMT, csrftoken=private-csrf; Path=/',
      },
    });
    Object.defineProperty(response.headers, 'getSetCookie', {
      value: undefined,
    });
    const { worker, records } = setup(response);
    expect((await (await worker.fetch(request(), env)).json()).ok).toBe(true);
    expect(records).toContainEqual(
      expect.objectContaining({
        stage: 'SESSION_EXTRACTION',
        csrfTokenFound: true,
      }),
    );
  });
  it('identifies GraphQL fetch failure only after successful session extraction', async () => {
    const { worker, records } = setup(
      bootstrap(),
      new Error('connection reset'),
    );
    expect((await (await worker.fetch(request(), env)).json()).error.code).toBe(
      'NETWORK_ERROR',
    );
    expect(records.at(-1)).toMatchObject({
      stage: 'GRAPHQL_REQUEST',
      fetchThrew: true,
      category: 'CONNECTION_FAILURE',
    });
  });
  it.each([
    'Illegal invocation: function called with incorrect this',
    'Unsupported cache mode',
  ])(
    'distinguishes local fetch configuration failure from transport: %s',
    async (message) => {
      const { worker, records } = setup(new TypeError(message));
      expect(
        (await (await worker.fetch(request(), env)).json()).error.code,
      ).toBe('UNKNOWN');
      expect(records[0]).toMatchObject({
        stage: 'BOOTSTRAP_REQUEST',
        fetchThrew: true,
      });
      expect(['RUNTIME_BINDING_ERROR', 'FETCH_CONFIGURATION_ERROR']).toContain(
        records[0].category,
      );
    },
  );
  it('does not echo custom exception names or messages', () => {
    const error = new Error(input);
    error.name = 'private-session-value';
    expect(exceptionDetails(error)).toEqual({
      exceptionName: 'Error',
      category: 'UNCLASSIFIED_EXCEPTION',
    });
  });
  it('keeps local diagnostic output narrow even when resolution succeeds', async () => {
    const { fetcher } = setup();
    vi.stubGlobal('fetch', fetcher);
    const body = await (await diagnosticWorker.fetch(request(), env)).json();
    expect(body.ok).toBe(true);
    expect(body).not.toHaveProperty('result');
    expect(body.diagnostics).toHaveLength(8);
    expect(JSON.stringify(body)).not.toContain('synthetic-private');
  });
  it('refuses diagnostic exposure on non-local deployed hosts', async () => {
    const response = await diagnosticWorker.fetch(
      new Request('https://preview.workers.dev/api/resolve', {
        method: 'POST',
      }),
      env,
    );
    expect(response.status).toBe(404);
  });
});

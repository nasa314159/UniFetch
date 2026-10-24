import { describe, expect, it, vi } from 'vitest';
import type {
  ThreadsContentRef,
  ThreadsShareRef,
} from '@unifetch/meta-resolver/threads';
import { createThreadsAcquisition } from './acquisition';
import type { ThreadsHeaderRule } from './header-rule';
import {
  embedHtml,
  imageCode,
  imageSsr,
  threadsUsername,
} from './__fixtures__/ssr';

const canonical = `https://www.threads.com/@${threadsUsername}/post/${imageCode}/`;

function ref(overrides: Partial<ThreadsContentRef> = {}): ThreadsContentRef {
  return {
    username: threadsUsername,
    shortcode: imageCode,
    canonicalUrl: canonical,
    ...overrides,
  };
}

function shareRef(): ThreadsShareRef {
  return {
    token: 'synthetic-share-token',
    canonicalShareUrl: 'https://www.threads.com/share/synthetic-share-token/',
  };
}

function headerRule(): ThreadsHeaderRule & {
  withHeaders: ReturnType<typeof vi.fn>;
} {
  return {
    withHeaders: vi.fn(async (task: () => Promise<unknown>) => task()),
  } as never;
}

function response(
  html: string,
  options: {
    url?: string;
    redirected?: boolean;
    status?: number;
    type?: string;
  } = {},
): Response {
  const status = options.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    type: options.type ?? 'basic',
    url: options.url ?? '',
    redirected: options.redirected ?? false,
    body: new Response(html).body,
    text: async () => html,
    headers: new Headers({ 'content-type': 'text/html' }),
  } as Response;
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('Threads browser acquisition', () => {
  it('fetches the canonical post with credentials omitted and reuses it', async () => {
    const fetcher = vi.fn(async () => response(imageSsr()));
    const rule = headerRule();
    const acquisition = createThreadsAcquisition({
      fetchImpl: fetcher,
      headerRule: rule,
    });
    const first = await acquisition.acquirePost(ref());
    const second = await acquisition.acquirePost(ref());
    expect(fetcher).toHaveBeenCalledOnce();
    expect(rule.withHeaders).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(canonical);
    expect(init).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(first.html).toContain(imageCode);
    expect(second.html).toBe(first.html);
    expect(first.network).toEqual([
      { origin: 'https://www.threads.com', purpose: 'metadata' },
    ]);
  });

  it('fails closed when the final post is not the requested publisher', async () => {
    const acquisition = createThreadsAcquisition({
      headerRule: headerRule(),
      fetchImpl: async () =>
        response(imageSsr(), {
          url: 'https://www.threads.com/@someone_else/post/synthetic-threads-image/',
          redirected: true,
        }),
    });
    await expectCode(acquisition.acquirePost(ref()), 'UNSUPPORTED_CONTENT');
  });

  it('fails closed when the final post code differs', async () => {
    const acquisition = createThreadsAcquisition({
      headerRule: headerRule(),
      fetchImpl: async () =>
        response(imageSsr(), {
          url: 'https://www.threads.com/@unifetch_threads_demo/post/different-code/',
          redirected: true,
        }),
    });
    await expectCode(acquisition.acquirePost(ref()), 'UNSUPPORTED_CONTENT');
  });

  it('classifies a login destination as LOGIN_REQUIRED', async () => {
    const acquisition = createThreadsAcquisition({
      headerRule: headerRule(),
      fetchImpl: async () =>
        response('', {
          url: 'https://www.threads.com/login/?next=%2F',
          redirected: true,
        }),
    });
    await expectCode(acquisition.acquirePost(ref()), 'LOGIN_REQUIRED');
  });

  it('expands a share link from the final URL and caches the post payload', async () => {
    const fetcher = vi.fn(async () =>
      response(imageSsr(), {
        url: `${canonical}?xmt=synthetic-share-attribution`,
        redirected: true,
      }),
    );
    const acquisition = createThreadsAcquisition({
      fetchImpl: fetcher,
      headerRule: headerRule(),
    });
    const expansion = await acquisition.acquireShare(shareRef());
    expect(fetcher).toHaveBeenCalledWith(
      'https://www.threads.com/share/synthetic-share-token/',
      expect.objectContaining({ credentials: 'omit', redirect: 'follow' }),
    );
    expect(expansion.location).toBe(
      `${canonical}?xmt=synthetic-share-attribution`,
    );
    const post = await acquisition.acquirePost(ref());
    expect(fetcher).toHaveBeenCalledOnce();
    expect(post.html).toContain(imageCode);
  });

  it('treats a 200 share shell with no redirect as unavailable', async () => {
    const acquisition = createThreadsAcquisition({
      headerRule: headerRule(),
      fetchImpl: async () =>
        response('<!doctype html><title>Threads</title>', {
          url: 'https://www.threads.com/share/synthetic-share-token/',
          redirected: false,
        }),
    });
    await expectCode(
      acquisition.acquireShare(shareRef()),
      'CONTENT_UNAVAILABLE',
    );
  });

  it('classifies an invalid_post redirect as unavailable, not unsupported', async () => {
    const acquisition = createThreadsAcquisition({
      headerRule: headerRule(),
      fetchImpl: async () =>
        response('', {
          url: 'https://www.threads.com/?error=invalid_post',
          redirected: true,
        }),
    });
    await expectCode(
      acquisition.acquireShare(shareRef()),
      'CONTENT_UNAVAILABLE',
    );
  });

  it('does not accept a share redirect outside the official host', async () => {
    const acquisition = createThreadsAcquisition({
      headerRule: headerRule(),
      fetchImpl: async () =>
        response(imageSsr(), {
          url: 'https://evil.invalid/@user/post/code/',
          redirected: true,
        }),
    });
    await expectCode(
      acquisition.acquireShare(shareRef()),
      'UNSUPPORTED_CONTENT',
    );
  });

  it('fetches the exact official embed and checks its final URL', async () => {
    const fetcher = vi.fn(async () => response(embedHtml));
    const acquisition = createThreadsAcquisition({
      fetchImpl: fetcher,
      headerRule: headerRule(),
    });
    const result = await acquisition.acquireEmbed(ref());
    expect(result.html).toContain('giphy.com');
    expect(fetcher.mock.calls[0][0]).toBe(
      `https://www.threads.com/@${threadsUsername}/post/${imageCode}/embed`,
    );
  });

  it('does not request an embed built from malformed reference segments', async () => {
    const fetcher = vi.fn(async () => response(embedHtml));
    const rule = headerRule();
    const acquisition = createThreadsAcquisition({
      fetchImpl: fetcher,
      headerRule: rule,
    });
    await expectCode(
      acquisition.acquireEmbed(
        ref({
          shortcode: 'code?x=1',
          canonicalUrl:
            'https://www.threads.com/@unifetch_threads_demo/post/code/',
        }),
      ),
      'UNSUPPORTED_CONTENT',
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(rule.withHeaders).not.toHaveBeenCalled();
  });

  it('rejects an embed that redirects outside the exact post embed path', async () => {
    const acquisition = createThreadsAcquisition({
      headerRule: headerRule(),
      fetchImpl: async () =>
        response(embedHtml, {
          url: `${canonical}`,
          redirected: true,
        }),
    });
    await expectCode(acquisition.acquireEmbed(ref()), 'UNSUPPORTED_CONTENT');
  });

  it.each([
    [403, 'LOGIN_REQUIRED'],
    [401, 'LOGIN_REQUIRED'],
    [429, 'RATE_LIMITED'],
    [404, 'CONTENT_UNAVAILABLE'],
    [410, 'CONTENT_UNAVAILABLE'],
    [500, 'NETWORK_ERROR'],
  ])('maps an HTTP %i to %s', async (status, code) => {
    const acquisition = createThreadsAcquisition({
      headerRule: headerRule(),
      fetchImpl: async () => response('', { status }),
    });
    await expectCode(acquisition.acquireEmbed(ref()), code);
  });

  it('classifies an opaque response as a browser restriction', async () => {
    const acquisition = createThreadsAcquisition({
      headerRule: headerRule(),
      fetchImpl: async () => response('', { status: 0, type: 'opaque' }),
    });
    await expectCode(acquisition.acquireEmbed(ref()), 'BROWSER_RESTRICTION');
  });

  it('classifies a rejected fetch as a browser restriction', async () => {
    const acquisition = createThreadsAcquisition({
      headerRule: headerRule(),
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expectCode(acquisition.acquireEmbed(ref()), 'BROWSER_RESTRICTION');
  });

  it('classifies an aborted fetch as a network timeout', async () => {
    const acquisition = createThreadsAcquisition({
      headerRule: headerRule(),
      fetchImpl: async () => {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      },
    });
    await expectCode(acquisition.acquireEmbed(ref()), 'NETWORK_ERROR');
  });

  it('refuses a response larger than the bound', async () => {
    const acquisition = createThreadsAcquisition({
      headerRule: headerRule(),
      fetchImpl: async () => response('x'.repeat(4 * 1024 * 1024 + 1)),
    });
    await expectCode(acquisition.acquireEmbed(ref()), 'PARSER_OUTDATED');
  });
});

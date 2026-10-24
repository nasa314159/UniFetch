import { describe, expect, it, vi } from 'vitest';
import {
  THREADS_HOST_PERMISSION,
  ensureThreadsPermission,
  hasThreadsPermission,
  requestThreadsPermissionNow,
  type PermissionsApi,
} from './permission';

function api(options: {
  contains: boolean;
  request?: boolean | Error;
}): PermissionsApi & {
  contains: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
} {
  return {
    contains: vi.fn(async () => options.contains),
    request: vi.fn(async () => {
      if (options.request instanceof Error) throw options.request;
      return options.request ?? false;
    }),
  } as never;
}

describe('optional Threads host permission', () => {
  it('uses exactly the official Threads origin', () => {
    expect(THREADS_HOST_PERMISSION).toBe('https://www.threads.com/*');
  });

  it('does not prompt when the narrow grant already exists', async () => {
    const permissions = api({ contains: true });
    await expect(hasThreadsPermission(permissions)).resolves.toBe(true);
    await expect(ensureThreadsPermission(permissions)).resolves.toEqual({
      granted: true,
      requested: false,
    });
    expect(permissions.request).not.toHaveBeenCalled();
  });

  it('requests the same narrow origin only after a user gesture', async () => {
    const permissions = api({ contains: false, request: true });
    await expect(ensureThreadsPermission(permissions)).resolves.toEqual({
      granted: true,
      requested: true,
    });
    expect(permissions.request).toHaveBeenCalledExactlyOnceWith({
      origins: [THREADS_HOST_PERMISSION],
    });
  });

  it.each([
    ['denied', false],
    ['thrown', new Error('gesture required')],
  ])('fails closed when the request is %s', async (_label, request) => {
    const permissions = api({ contains: false, request });
    await expect(ensureThreadsPermission(permissions)).resolves.toEqual({
      granted: false,
      requested: true,
    });
  });

  it('fails closed when the permissions API is unavailable', async () => {
    await expect(hasThreadsPermission(undefined)).resolves.toBe(false);
    await expect(ensureThreadsPermission(undefined)).resolves.toEqual({
      granted: false,
      requested: false,
    });
  });

  it('does not broaden a permission query that throws', async () => {
    const permissions: PermissionsApi = {
      contains: vi.fn(async () => {
        throw new Error('unavailable');
      }),
      request: vi.fn(async () => true),
    };
    await expect(ensureThreadsPermission(permissions)).resolves.toEqual({
      granted: false,
      requested: false,
    });
    expect(permissions.request).not.toHaveBeenCalled();
  });

  it('requests synchronously inside the user gesture without a contains await', async () => {
    const permissions = api({ contains: false, request: true });
    const pending = requestThreadsPermissionNow(permissions);
    // `request` must already be in flight before any microtask runs, otherwise
    // Chrome may reject the call as not user-gesture initiated.
    expect(permissions.request).toHaveBeenCalledExactlyOnceWith({
      origins: [THREADS_HOST_PERMISSION],
    });
    expect(permissions.contains).not.toHaveBeenCalled();
    await expect(pending).resolves.toEqual({ granted: true, requested: true });
  });

  it('reports a gesture-scoped denial or throw as a typed failure', async () => {
    await expect(
      requestThreadsPermissionNow(api({ contains: false, request: false })),
    ).resolves.toEqual({ granted: false, requested: true });
    await expect(
      requestThreadsPermissionNow(
        api({ contains: false, request: new Error('no gesture') }),
      ),
    ).resolves.toEqual({ granted: false, requested: true });
    await expect(requestThreadsPermissionNow(undefined)).resolves.toEqual({
      granted: false,
      requested: false,
    });
  });

  it('never waits indefinitely for an unanswered native prompt', async () => {
    const permissions: PermissionsApi = {
      contains: vi.fn(async () => false),
      request: vi.fn(() => new Promise<boolean>(() => {})),
    };
    await expect(requestThreadsPermissionNow(permissions, 10)).resolves.toEqual(
      { granted: false, requested: true, timedOut: true },
    );
  });
});

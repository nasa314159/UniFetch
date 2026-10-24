import { describe, expect, it, vi } from 'vitest';
import {
  THREADS_HOST_PERMISSION,
  ensureThreadsPermission,
  hasThreadsPermission,
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
});

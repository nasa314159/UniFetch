import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { UniFetchError } from '@unifetch/core';
import { useResolutionStore } from './resolution';
import { resolutionErrorMessage } from '../error-messages';
import image from '../../../../fixtures/instagram/image.json';

const { resolve } = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('../resolver-client', () => ({
  createWebResolver: () => ({ resolve }),
}));
beforeEach(() => {
  setActivePinia(createPinia());
  resolve.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Resolution store and live error presentation', () => {
  it.each([
    'BROWSER_RESTRICTION',
    'RATE_LIMITED',
    'LOGIN_REQUIRED',
    'PARSER_OUTDATED',
    'CONTENT_UNAVAILABLE',
    'GRAPHQL_EXECUTION_ERROR',
  ] as const)('retains %s at UI/store boundary', async (code) => {
    const error = new UniFetchError(code, 'Internal safe diagnostic');
    resolve.mockRejectedValueOnce(error);
    const store = useResolutionStore();
    await store.resolve('https://instagram.com/p/synthetic-store/');
    expect(store.state).toBe('ERROR');
    expect(store.error).toBe(error);
    expect(store.error?.code).toBe(code);
    expect(store.result).toBeNull();
    if (code !== 'BROWSER_RESTRICTION')
      expect(resolutionErrorMessage(error)).not.toBe(
        'Internal safe diagnostic',
      );
  });
  it('explains browser restriction without implying a proxy or server failure', () => {
    const message = resolutionErrorMessage(
      new UniFetchError(
        'BROWSER_RESTRICTION',
        'Your browser blocked the direct Instagram request required for local resolution. UniFetch did not send the request through a remote proxy.',
      ),
    );
    expect(message).toContain('browser blocked the direct Instagram request');
    expect(message).toContain(
      'did not send the request through a remote proxy',
    );
  });
  it.each(['fixture', 'live'] as const)(
    'keeps resolved source %s for result UI',
    async (source) => {
      const result = {
        ...structuredClone(image),
        source,
        kind: 'image' as const,
      };
      resolve.mockResolvedValueOnce(result);
      const store = useResolutionStore();
      await store.resolve('https://instagram.com/p/synthetic-result/');
      expect(store.state).toBe('RESOLVED');
      expect(store.result?.source).toBe(source);
    },
  );
  it('clears previous result/trace on a failed resolution', async () => {
    const store = useResolutionStore();
    resolve.mockResolvedValueOnce({
      ...structuredClone(image),
      source: 'fixture',
      kind: 'image',
    });
    await store.resolve('fixture');
    resolve.mockRejectedValueOnce(
      new UniFetchError('BROWSER_RESTRICTION', 'Restricted'),
    );
    await store.resolve('live');
    expect(store.result).toBeNull();
  });
  it('keeps RESOLVING indeterminate until the operation completes', async () => {
    let finish!: () => void;
    resolve.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const store = useResolutionStore();
    const pending = store.resolve('synthetic');
    expect(store.state).toBe('RESOLVING');
    finish();
    await pending;
  });
  it('does not write URLs or results to persistent storage', async () => {
    const storage = { setItem: vi.fn() };
    const db = { open: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    vi.stubGlobal('indexedDB', db);
    resolve.mockRejectedValueOnce(
      new UniFetchError('BROWSER_RESTRICTION', 'Restricted'),
    );
    await useResolutionStore().resolve(
      'https://instagram.com/p/synthetic-transient/',
    );
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(db.open).not.toHaveBeenCalled();
  });
});

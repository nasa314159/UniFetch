import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UniFetchError,
  type MediaAsset,
  type RuntimeAdapter,
} from '@unifetch/core';
import {
  batchDownloadSummary,
  createDownloadBatch,
  createDownloadFilename,
  downloadSequential,
  requiresIndividualSave,
  selectDownloadEntries,
  type PreparedDownload,
} from './index';

const assets: MediaAsset[] = Array.from({ length: 4 }, (_, index) => ({
  id: `demo-${index}`,
  type: 'image',
  url: `https://media.invalid/demo-${index}.jpg`,
  suggestedFilename: createDownloadFilename({
    platform: 'instagram',
    username: 'fictional-studio',
    caption: 'Original art',
    assetIndex: index,
    assetCount: 4,
    mediaType: 'image',
    mimeType: 'image/jpeg',
  }),
}));
const entries = selectDownloadEntries(
  assets,
  assets.map((asset) => asset.id),
);
function dependencies() {
  const prepare = vi.fn(async (asset: MediaAsset) => ({
    status: 'ready' as const,
    file: {
      blob: new Blob(['fictional'], { type: 'image/jpeg' }),
      filename: asset.suggestedFilename,
      formatFallback: false,
    },
  }));
  const dispatch = vi.fn<(file: PreparedDownload) => { status: 'requested' }>(
    () => ({ status: 'requested' }),
  );
  return { prepare, dispatch, pause: async () => {} };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('Independent sequential downloads', () => {
  it('continues all four runtime attempts after asset 2 rejects and records independent results', async () => {
    vi.useFakeTimers();
    const download = vi.fn(async (asset: MediaAsset) => {
      if (asset.id === assets[1].id)
        throw new UniFetchError('BROWSER_RESTRICTION', 'unreadable');
    });
    const pending = downloadSequential(assets, {
      download,
    } as unknown as RuntimeAdapter);
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(download.mock.calls.map(([asset]) => asset.id)).toEqual(
      assets.map((asset) => asset.id),
    );
    expect(result.results.map((item) => item.status)).toEqual([
      'requested',
      'browser-restricted',
      'requested',
      'requested',
    ]);
    expect(result.results[1].errorCode).toBe('BROWSER_RESTRICTION');
    expect(result.completed).toBe(0); // Dispatch cannot observe whether the browser actually saved.
    expect(batchDownloadSummary(result)).not.toContain('Downloaded 4 of 4');
  });
});
describe('Prepared batch and manual save fallback', () => {
  it('attempts every checked asset in post order', async () => {
    const deps = dependencies();
    const batch = createDownloadBatch(entries, { ...deps, manual: false });
    await batch.run();
    expect(deps.prepare).toHaveBeenCalledTimes(4);
    expect(deps.dispatch).toHaveBeenCalledTimes(4);
    expect(batch.snapshot().results.map((item) => item.status)).toEqual(
      Array(4).fill('requested'),
    );
  });
  it('only prepares selected #2 and #4 and preserves original filename indices', async () => {
    const deps = dependencies();
    const selected = selectDownloadEntries(assets, [
      assets[3].id,
      assets[1].id,
    ]);
    const batch = createDownloadBatch(selected, { ...deps, manual: false });
    await batch.run();
    expect(selected.map((entry) => entry.index)).toEqual([1, 3]);
    expect(deps.dispatch.mock.calls.map(([file]) => file.filename)).toEqual([
      'fictional-studio_Original-art_02.jpg',
      'fictional-studio_Original-art_04.jpg',
    ]);
    expect(deps.prepare.mock.calls.map(([asset]) => asset.id)).toEqual([
      assets[1].id,
      assets[3].id,
    ]);
  });
  it('Download all bypasses selection', async () => {
    const deps = dependencies();
    const checked = [assets[1].id];
    expect(selectDownloadEntries(assets, checked)).toHaveLength(1);
    const batch = createDownloadBatch(
      selectDownloadEntries(
        assets,
        assets.map((asset) => asset.id),
      ),
      { ...deps, manual: false },
    );
    await batch.run();
    expect(deps.dispatch).toHaveBeenCalledTimes(4);
  });
  it('isolates preparation failure without losing asset 3/4 or claiming full success', async () => {
    const deps = dependencies();
    deps.prepare.mockImplementation(async (asset) => {
      if (asset.id === assets[1].id)
        throw new UniFetchError('BROWSER_RESTRICTION', 'unreadable');
      return {
        status: 'ready',
        file: {
          blob: new Blob(['demo']),
          filename: asset.suggestedFilename,
          formatFallback: false,
        },
      };
    });
    const batch = createDownloadBatch(entries, { ...deps, manual: false });
    await batch.run();
    expect(deps.prepare).toHaveBeenCalledTimes(4);
    expect(deps.dispatch).toHaveBeenCalledTimes(3);
    batch.confirm(0);
    expect(batch.snapshot().completed).toBe(1);
    expect(batch.snapshot().results[1]).toMatchObject({
      index: 1,
      status: 'browser-restricted',
      errorCode: 'BROWSER_RESTRICTION',
    });
    expect(batchDownloadSummary(batch.snapshot())).toContain(
      '3 files still need saving or confirmation',
    );
  });
  it('isolates anchor dispatch failure and allows that prepared file to be retried', async () => {
    const deps = dependencies();
    deps.dispatch.mockImplementationOnce(() => {
      throw new Error('click failed');
    });
    const batch = createDownloadBatch(entries, { ...deps, manual: false });
    await batch.run();
    expect(deps.dispatch).toHaveBeenCalledTimes(4);
    expect(batch.snapshot().results[0].status).toBe('failed');
    expect(batch.save(0)).toBe(true);
    expect(deps.dispatch).toHaveBeenCalledTimes(5);
  });
  it('prepares all files without automatic clicks when batch capability is unavailable', async () => {
    const deps = dependencies();
    const batch = createDownloadBatch(entries, { ...deps, manual: true });
    await batch.run();
    expect(deps.prepare).toHaveBeenCalledTimes(4);
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(
      batch.snapshot().results.every((item) => item.status === 'ready'),
    ).toBe(true);
  });
  it('Save N synchronously dispatches exactly N without another fetch or lost gesture', async () => {
    const deps = dependencies();
    const batch = createDownloadBatch(entries, { ...deps, manual: true });
    await batch.run();
    expect(batch.save(2)).toBe(true);
    expect(deps.prepare).toHaveBeenCalledTimes(4);
    expect(deps.dispatch).toHaveBeenCalledOnce();
    expect(deps.dispatch.mock.calls[0][0].filename).toContain('_03.jpg');
    expect(batch.snapshot().results.map((item) => item.status)).toEqual([
      'ready',
      'ready',
      'requested',
      'ready',
    ]);
  });
  it('requires confirmation, excludes completed files from saving, and completes only after all four', async () => {
    const deps = dependencies();
    const batch = createDownloadBatch(entries, { ...deps, manual: true });
    await batch.run();
    batch.confirm(0); // Not yet dispatched; ignore.
    expect(batch.snapshot().completed).toBe(0);
    for (const index of [0, 1, 2]) {
      batch.save(index);
      batch.confirm(index);
    }
    expect(batch.snapshot().completed).toBe(3);
    expect(batch.save(1)).toBe(false);
    expect(batch.hasPrepared(1)).toBe(false);
    expect(deps.dispatch).toHaveBeenCalledTimes(3);
    expect(batchDownloadSummary(batch.snapshot())).not.toContain(
      'Downloaded 4 of 4',
    );
    batch.save(3);
    expect(batch.snapshot().completed).toBe(3);
    batch.confirm(3);
    expect(batchDownloadSummary(batch.snapshot())).toBe(
      'Downloaded 4 of 4 (confirmed).',
    );
  });
  it('can retry preparation for only the failed file', async () => {
    const deps = dependencies();
    deps.prepare.mockRejectedValueOnce(
      new UniFetchError('NETWORK_ERROR', 'failed'),
    );
    const batch = createDownloadBatch(entries, { ...deps, manual: true });
    await batch.run();
    await batch.retry(0);
    expect(deps.prepare).toHaveBeenCalledTimes(5);
    expect(batch.snapshot().results[0].status).toBe('ready');
    expect(deps.dispatch).not.toHaveBeenCalled();
  });
  it('disposal releases prepared files and rejects all stale Save actions', async () => {
    const deps = dependencies();
    const batch = createDownloadBatch(entries, { ...deps, manual: true });
    await batch.run();
    batch.dispose();
    expect(batch.hasPrepared(0)).toBe(false);
    expect(batch.save(0)).toBe(false);
    await batch.retry(0);
    expect(deps.prepare).toHaveBeenCalledTimes(4);
    expect(deps.dispatch).not.toHaveBeenCalled();
  });
  it('disposal during fetch cannot populate a stale queue or click an anchor', async () => {
    let resolve!: (
      value: Awaited<ReturnType<ReturnType<typeof dependencies>['prepare']>>,
    ) => void;
    const deps = dependencies();
    deps.prepare.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const change = vi.fn();
    const batch = createDownloadBatch(entries, {
      ...deps,
      manual: false,
      onChange: change,
    });
    const pending = batch.run();
    batch.dispose();
    resolve({
      status: 'ready',
      file: {
        blob: new Blob(['demo']),
        filename: 'demo.jpg',
        formatFallback: false,
      },
    });
    await pending;
    expect(batch.hasPrepared(0)).toBe(false);
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(change).toHaveBeenCalledTimes(1);
  });
  it('does not run a batch twice or silently duplicate save requests', async () => {
    const deps = dependencies();
    const batch = createDownloadBatch(entries, { ...deps, manual: false });
    await batch.run();
    await batch.run();
    expect(deps.dispatch).toHaveBeenCalledTimes(4);
  });
});
describe('Isolated conservative platform guard', () => {
  it.each([
    { userAgent: 'iPhone Mobile Safari', maxTouchPoints: 1 },
    { userAgent: 'iPad Mobile Safari', maxTouchPoints: 5 },
    { userAgent: 'Macintosh Safari', maxTouchPoints: 5 },
  ])('uses individual gestures for iOS/iPadOS %s', (device) => {
    expect(requiresIndividualSave(device)).toBe(true);
  });
  it.each([
    { userAgent: 'Android Chrome', maxTouchPoints: 5 },
    { userAgent: 'Windows Chrome', maxTouchPoints: 0 },
    { userAgent: 'Macintosh Safari', maxTouchPoints: 0 },
  ])('preserves automatic sequential dispatch for %s', (device) => {
    expect(requiresIndividualSave(device)).toBe(false);
  });
});

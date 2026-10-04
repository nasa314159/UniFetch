import {
  asUniFetchError,
  type ErrorCode,
  type MediaAsset,
} from '@unifetch/core';
import {
  prepareBlobDownload,
  dispatchPreparedDownload,
  type DownloadDiagnostics,
  type DownloadAttemptResult,
  type PreparedDownload,
  type PrepareDownloadResult,
} from './index';

// Dispatch is observable; saving to the filesystem is not. "downloaded" requires user confirmation.
export type AssetDownloadStatus =
  | 'preparing'
  | 'ready'
  | 'requested'
  | 'downloaded'
  | 'browser-restricted'
  | 'opened-original'
  | 'failed';
export interface AssetDownloadResult {
  index: number;
  filename: string;
  status: AssetDownloadStatus;
  errorCode?: ErrorCode;
  diagnostics?: DownloadDiagnostics;
  formatFallback?: boolean;
}
export interface BatchDownloadResult {
  requested: number;
  completed: number;
  results: AssetDownloadResult[];
}
export interface DownloadEntry {
  index: number;
  asset: MediaAsset;
}
export interface BatchOptions {
  manual: boolean;
  onChange?(result: BatchDownloadResult): void;
  prepare?: typeof prepareBlobDownload;
  dispatch?: typeof dispatchPreparedDownload;
  pause?(): Promise<void>;
}
/** Isolated conservative guard: browsers expose no capability or event proving multiple files saved.
 * iOS/iPadOS batches prepare first and require one explicit gesture per file. This is a fallback,
 * not a diagnosis of a fetch rejection. Other browsers retain sequential automatic dispatch.
 */
export function requiresIndividualSave(
  device: Pick<Navigator, 'userAgent' | 'maxTouchPoints'>,
): boolean {
  return (
    /iPhone|iPad|iPod/.test(device.userAgent) ||
    (/Macintosh/.test(device.userAgent) && device.maxTouchPoints > 1)
  );
}
export function selectDownloadEntries(
  assets: readonly MediaAsset[],
  ids: readonly string[],
): DownloadEntry[] {
  return assets.flatMap((asset, index) =>
    ids.includes(asset.id) ? [{ index, asset }] : [],
  );
}
export function batchDownloadSummary(result: BatchDownloadResult): string {
  if (result.completed === result.requested)
    return `Downloaded ${result.completed} of ${result.requested} (confirmed).`;
  const dispatched = result.results.filter(
    (item) => item.status === 'requested',
  ).length;
  return `Downloaded ${result.completed} of ${result.requested} (confirmed). ${result.requested - result.completed} files still need saving or confirmation.${dispatched ? ` ${dispatched} save requests sent; check Downloads before confirming.` : ''}`;
}
/** Blobs live only in this session. Release on confirmation, replacement, or component disposal. */
export function createDownloadBatch(
  entries: readonly DownloadEntry[],
  options: BatchOptions,
) {
  const files = new Map<number, PreparedDownload>();
  const results: AssetDownloadResult[] = entries.map(({ index, asset }) => ({
    index,
    filename: asset.suggestedFilename,
    status: 'preparing',
  }));
  const preparing = new Set<number>();
  let disposed = false;
  let started = false;
  const snapshot = (): BatchDownloadResult => ({
    requested: results.length,
    completed: results.filter((item) => item.status === 'downloaded').length,
    results: results.map((item) => ({
      ...item,
      diagnostics: item.diagnostics && { ...item.diagnostics },
    })),
  });
  const publish = () => {
    if (!disposed) options.onChange?.(snapshot());
  };
  const failed = (item: AssetDownloadResult, code: ErrorCode) => {
    item.status =
      code === 'BROWSER_RESTRICTION' ? 'browser-restricted' : 'failed';
    item.errorCode = code;
  };
  async function prepare(index: number) {
    const item = results.find((item) => item.index === index);
    const entry = entries.find((entry) => entry.index === index);
    if (
      disposed ||
      !item ||
      !entry ||
      item.status === 'downloaded' ||
      preparing.has(index)
    )
      return;
    preparing.add(index);
    files.delete(index);
    item.status = 'preparing';
    item.errorCode = undefined;
    item.diagnostics = {
      fetch: 'not-attempted',
      objectUrlCreated: false,
      anchorClickAttempted: false,
    };
    publish();
    try {
      const prepared: PrepareDownloadResult = await (
        options.prepare ?? prepareBlobDownload
      )(entry.asset, item.diagnostics);
      if (disposed) return;
      if (prepared.status === 'ready') {
        files.set(index, prepared.file);
        item.filename = prepared.file.filename;
        item.formatFallback = prepared.file.formatFallback;
        item.status = 'ready';
      } else
        failed(
          item,
          prepared.status === 'browser-restricted'
            ? 'BROWSER_RESTRICTION'
            : 'NETWORK_ERROR',
        );
    } catch (cause) {
      if (!disposed) failed(item, asUniFetchError(cause).code);
    } finally {
      preparing.delete(index);
      publish();
    }
  }
  // No await before the click: Save must dispatch within the user's new gesture.
  function save(index: number): boolean {
    const item = results.find((item) => item.index === index);
    const file = files.get(index);
    if (
      disposed ||
      !item ||
      !file ||
      !['ready', 'requested', 'failed'].includes(item.status)
    )
      return false;
    try {
      const dispatched: DownloadAttemptResult = (
        options.dispatch ?? dispatchPreparedDownload
      )(file, item.diagnostics);
      if (dispatched.status === 'requested') {
        item.status = 'requested';
        item.errorCode = undefined;
      } else
        failed(
          item,
          dispatched.status === 'browser-restricted'
            ? 'BROWSER_RESTRICTION'
            : 'NETWORK_ERROR',
        );
    } catch (cause) {
      failed(item, asUniFetchError(cause).code);
    }
    publish();
    return item.status === 'requested';
  }
  function confirm(index: number) {
    const item = results.find((item) => item.index === index);
    if (disposed || !item || item.status !== 'requested') return;
    item.status = 'downloaded';
    files.delete(index);
    publish();
  }
  async function run() {
    if (started || disposed) return;
    started = true;
    for (const { index } of entries) {
      if (disposed) break;
      await prepare(index);
      if (!options.manual && !disposed) {
        save(index);
        if (entries.length > 1)
          await (
            options.pause ??
            (() => new Promise((resolve) => setTimeout(resolve, 350)))
          )();
      }
    }
    return snapshot();
  }
  function dispose() {
    disposed = true;
    files.clear();
  }
  return {
    run,
    save,
    confirm,
    retry: prepare,
    snapshot,
    dispose,
    hasPrepared: (index: number) => files.has(index),
  };
}

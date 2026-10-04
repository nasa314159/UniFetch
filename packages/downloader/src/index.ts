import {
  UniFetchError,
  asUniFetchError,
  type MediaAsset,
  type RuntimeAdapter,
} from '@unifetch/core';

import { finalizeDownloadFilename } from './filename';
import { normalizeStillImage } from './image-normalization';
export {
  createDownloadFilename,
  finalizeDownloadFilename,
  extensionForMime,
} from './filename';
export type { FilenameInput } from './filename';
export { normalizeStillImage } from './image-normalization';

export * from './batch';
import type { BatchDownloadResult } from './batch';

export interface DownloadDiagnostics {
  fetch: 'not-attempted' | 'succeeded' | 'failed' | 'opaque' | 'http-failed';
  blobMime?: string;
  blobSize?: number;
  objectUrlCreated: boolean;
  anchorClickAttempted: boolean;
}
export interface PreparedDownload {
  blob: Blob;
  filename: string;
  formatFallback: boolean;
}
export type PrepareDownloadResult =
  | { status: 'ready'; file: PreparedDownload }
  | Exclude<
      DownloadAttemptResult,
      { status: 'requested' } | { status: 'navigation-requested' }
    >;

export type DownloadAttemptResult =
  | { status: 'requested'; formatFallback?: boolean }
  | { status: 'navigation-requested' }
  | { status: 'browser-restricted'; reason: 'cors-or-network' | 'opaque' }
  | { status: 'failed' };

export function originalMediaUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(
      input,
      typeof window === 'undefined' ? undefined : window.location.origin,
    );
  } catch {
    throw new UniFetchError('BROWSER_RESTRICTION', 'The media URL is invalid.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new UniFetchError('BROWSER_RESTRICTION', 'The media URL is unsafe.');
  return url.href;
}
function clickAnchor(
  url: string,
  filename: string,
  newTab = false,
  diagnostics?: DownloadDiagnostics,
): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener noreferrer';
  anchor.referrerPolicy = 'no-referrer';
  if (newTab) anchor.target = '_blank';
  try {
    document.body.append(anchor);
    if (diagnostics) diagnostics.anchorClickAttempted = true;
    anchor.click();
  } finally {
    anchor.remove();
  }
}
/** Cross-origin download attributes cannot guarantee saving; never report a saved file. */
export function attemptAnchorDownload(
  asset: MediaAsset,
): DownloadAttemptResult {
  const url = originalMediaUrl(asset.url);
  const crossOrigin = new URL(url).origin !== window.location.origin;
  clickAnchor(url, asset.suggestedFilename, crossOrigin);
  return { status: crossOrigin ? 'navigation-requested' : 'requested' };
}
/** Fetch only the direct source. CORS remains enforced; there is no relay fallback. */
export async function prepareBlobDownload(
  asset: MediaAsset,
  diagnostics?: DownloadDiagnostics,
): Promise<PrepareDownloadResult> {
  const url = originalMediaUrl(asset.url);
  let response: Response;
  try {
    response = await fetch(url, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    if (diagnostics) diagnostics.fetch = 'failed';
    return { status: 'browser-restricted', reason: 'cors-or-network' };
  }
  if (response.type === 'opaque' || response.status === 0) {
    if (diagnostics) diagnostics.fetch = 'opaque';
    return { status: 'browser-restricted', reason: 'opaque' };
  }
  if (!response.ok) {
    if (diagnostics) diagnostics.fetch = 'http-failed';
    return { status: 'failed' };
  }
  if (diagnostics) diagnostics.fetch = 'succeeded';
  try {
    const source = await response.blob();
    const normalized =
      asset.type === 'image'
        ? await normalizeStillImage(source)
        : { blob: source, fallback: false };
    if (diagnostics) {
      diagnostics.blobMime = normalized.blob.type;
      diagnostics.blobSize = normalized.blob.size;
    }
    return {
      status: 'ready',
      file: {
        blob: normalized.blob,
        filename: finalizeDownloadFilename(
          asset.suggestedFilename,
          normalized.blob.type,
        ),
        formatFallback: normalized.fallback,
      },
    };
  } catch {
    return { status: 'failed' };
  }
}
/** Synchronous dispatch lets an explicit Save gesture use a previously prepared Blob. */
export function dispatchPreparedDownload(
  file: PreparedDownload,
  diagnostics?: DownloadDiagnostics,
): DownloadAttemptResult {
  let objectUrl: string | undefined;
  try {
    objectUrl = URL.createObjectURL(file.blob);
    if (diagnostics) {
      diagnostics.objectUrlCreated = true;
    }
    clickAnchor(objectUrl, file.filename, false, diagnostics);
    return file.formatFallback
      ? { status: 'requested', formatFallback: true }
      : { status: 'requested' };
  } catch {
    return { status: 'failed' };
  } finally {
    // Allow slow mobile browsers to consume the link. Every dispatch has bounded cleanup.
    if (objectUrl) {
      const disposable = objectUrl;
      setTimeout(() => URL.revokeObjectURL(disposable), 60_000);
    }
  }
}
export async function attemptBlobDownload(
  asset: MediaAsset,
): Promise<DownloadAttemptResult> {
  const prepared = await prepareBlobDownload(asset);
  return prepared.status === 'ready'
    ? dispatchPreparedDownload(prepared.file)
    : prepared;
}
/** Still images use readable Blob fetch and client-side JPEG normalization, including fixtures. */
export async function downloadLocalAsset(
  asset: MediaAsset,
  onResult?: (result: DownloadAttemptResult) => void,
): Promise<void> {
  const url = originalMediaUrl(asset.url);
  const result =
    asset.type !== 'image' && new URL(url).origin === window.location.origin
      ? attemptAnchorDownload(asset)
      : await attemptBlobDownload(asset);
  if (result.status === 'browser-restricted')
    throw new UniFetchError(
      'BROWSER_RESTRICTION',
      'Your browser could not read this source file for download. Cross-origin rules or a network failure may prevent it. You can try Open original.',
    );
  if (result.status !== 'requested')
    throw new UniFetchError(
      'NETWORK_ERROR',
      'The source file could not be downloaded. You can try Open original.',
    );
  onResult?.(result);
}
export async function downloadSequential(
  assets: readonly MediaAsset[],
  runtime: RuntimeAdapter,
): Promise<BatchDownloadResult> {
  const results: BatchDownloadResult['results'] = [];
  for (const [index, asset] of assets.entries()) {
    try {
      await runtime.download(asset);
      results.push({
        index,
        status: 'requested',
        filename: asset.suggestedFilename,
      });
    } catch (cause) {
      const error = asUniFetchError(cause);
      results.push({
        index,
        status:
          error.code === 'BROWSER_RESTRICTION'
            ? 'browser-restricted'
            : 'failed',
        errorCode: error.code,
        filename: asset.suggestedFilename,
      });
    }
    if (assets.length > 1)
      await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return { requested: assets.length, completed: 0, results };
}

import {
  UniFetchError,
  type MediaAsset,
  type RuntimeAdapter,
} from '@unifetch/core';

export type DownloadAttemptResult =
  | { status: 'requested' }
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
function clickAnchor(url: string, filename: string, newTab = false): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener noreferrer';
  anchor.referrerPolicy = 'no-referrer';
  if (newTab) anchor.target = '_blank';
  document.body.append(anchor);
  try {
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
/** Fetch only the direct source. Browser CORS remains enforced; there is no relay fallback. */
export async function attemptBlobDownload(
  asset: MediaAsset,
): Promise<DownloadAttemptResult> {
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
    // Fetch intentionally hides whether a rejection was CORS or a network failure.
    return { status: 'browser-restricted', reason: 'cors-or-network' };
  }
  if (response.type === 'opaque' || response.status === 0)
    return { status: 'browser-restricted', reason: 'opaque' };
  if (!response.ok) return { status: 'failed' };
  let objectUrl: string;
  try {
    objectUrl = URL.createObjectURL(await response.blob());
  } catch {
    return { status: 'failed' };
  }
  try {
    clickAnchor(objectUrl, asset.suggestedFilename);
    return { status: 'requested' };
  } catch {
    return { status: 'failed' };
  } finally {
    // Leave time for the browser to consume the link, then release the in-memory file.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}
/** Compatibility entry point: local fixtures use anchors, remote assets use readable Blob fetch. */
export async function downloadLocalAsset(asset: MediaAsset): Promise<void> {
  const url = originalMediaUrl(asset.url);
  const result =
    new URL(url).origin === window.location.origin
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
}
export async function downloadSequential(
  assets: readonly MediaAsset[],
  runtime: RuntimeAdapter,
): Promise<void> {
  for (const asset of assets) {
    await runtime.download(asset);
    if (assets.length > 1)
      await new Promise((resolve) => setTimeout(resolve, 350));
  }
}

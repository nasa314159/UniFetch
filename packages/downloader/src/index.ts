import {
  UniFetchError,
  type MediaAsset,
  type RuntimeAdapter,
} from '@unifetch/core';
/** Browser-native downloads; only same-origin local assets are supported in this milestone. */
export async function downloadLocalAsset(asset: MediaAsset): Promise<void> {
  const url = new URL(asset.url, window.location.origin);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== window.location.origin ||
    !url.pathname.startsWith('/demo/')
  )
    throw new UniFetchError(
      'BROWSER_RESTRICTION',
      'This browser cannot save this media directly. No remote download proxy is used.',
    );
  const anchor = document.createElement('a');
  anchor.href = url.href;
  anchor.download = asset.suggestedFilename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
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

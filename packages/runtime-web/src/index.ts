import {
  UniFetchError,
  type RuntimeAdapter,
  type RuntimeRequest,
  type RuntimeResponse,
  type MediaAsset,
} from '@unifetch/core';
import { downloadLocalAsset } from '@unifetch/downloader';
export class WebRuntime implements RuntimeAdapter {
  capabilities() {
    return { downloads: true, crossOriginRequests: false };
  }
  async request(input: RuntimeRequest): Promise<RuntimeResponse> {
    const url = new URL(input.url, window.location.origin);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== window.location.origin
    )
      throw new UniFetchError(
        'BROWSER_RESTRICTION',
        'This web runtime only permits same-origin requests.',
      );
    try {
      const response = await fetch(url, {
        method: input.method ?? 'GET',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      return {
        status: response.status,
        body: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') ?? undefined,
      };
    } catch {
      throw new UniFetchError(
        'NETWORK_ERROR',
        'The request could not be completed.',
      );
    }
  }
  download(asset: MediaAsset): Promise<void> {
    return downloadLocalAsset(asset);
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { MediaAsset } from '@unifetch/core';
import {
  attemptAnchorDownload,
  attemptBlobDownload,
  downloadLocalAsset,
  originalMediaUrl,
} from './index';
const asset: MediaAsset = {
  id: 'fictional',
  type: 'image',
  url: 'https://media.invalid/image.jpg',
  suggestedFilename: 'fictional.jpg',
};
let anchor: Record<string, unknown>;
const fetcher = vi.fn<typeof fetch>();
const revoke = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  anchor = { click: vi.fn(), remove: vi.fn() };
  vi.stubGlobal('window', { location: { origin: 'https://unifetch.invalid' } });
  vi.stubGlobal('document', {
    createElement: vi.fn(() => anchor),
    body: { append: vi.fn() },
  });
  vi.stubGlobal('fetch', fetcher);
  fetcher.mockReset();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fictional');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke);
  revoke.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('Direct browser downloads', () => {
  it('downloads local still-image fixtures through normalization', async () => {
    fetcher.mockResolvedValue(
      new Response(new Blob(['fictional jpeg'], { type: 'image/jpeg' })),
    );
    await downloadLocalAsset({ ...asset, url: '/demo/image.svg' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(anchor).toMatchObject({
      href: 'blob:fictional',
      download: 'fictional.jpg',
    });
  });
  it('normalizes WebP to JPEG and replaces the source extension', async () => {
    fetcher.mockResolvedValue(
      new Response(new Blob(['fictional webp'], { type: 'image/webp' })),
    );
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 32, height: 24, close: vi.fn() }),
    );
    const output = new Blob(['fictional jpeg'], { type: 'image/jpeg' });
    const create = document.createElement as ReturnType<typeof vi.fn>;
    create.mockImplementation((tag: string) =>
      tag === 'canvas'
        ? {
            getContext: () => ({ fillRect: vi.fn(), drawImage: vi.fn() }),
            toBlob: (callback: (blob: Blob) => void) => callback(output),
          }
        : anchor,
    );
    expect(
      await attemptBlobDownload({
        ...asset,
        suggestedFilename: 'studio_post_01.jpg.webp',
      }),
    ).toEqual({ status: 'requested' });
    expect(URL.createObjectURL).toHaveBeenCalledWith(output);
    expect(anchor.download).toBe('studio_post_01.jpg');
  });
  it('saves conversion fallback in its real format with an accurate result', async () => {
    const source = new Blob(['fictional webp'], { type: 'image/webp' });
    fetcher.mockResolvedValue(new Response(source));
    expect(
      await attemptBlobDownload({
        ...asset,
        suggestedFilename: 'studio_post_01.jpg',
      }),
    ).toEqual({ status: 'requested', formatFallback: true });
    expect(anchor.download).toBe('studio_post_01.webp');
    expect(
      (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0].type,
    ).toBe('image/webp');
  });
  it('never decodes video and preserves MP4 bytes and extension', async () => {
    fetcher.mockResolvedValue(
      new Response(new Blob(['fictional mp4'], { type: 'video/mp4' })),
    );
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    await attemptBlobDownload({
      ...asset,
      type: 'video',
      suggestedFilename: 'studio_caption_03.jpg',
    });
    expect(decode).not.toHaveBeenCalled();
    expect(anchor.download).toBe('studio_caption_03.mp4');
  });

  it('retains local video fixture anchor download and filename without fetch', async () => {
    await downloadLocalAsset({
      ...asset,
      type: 'video',
      url: '/demo/video.mp4',
    });
    expect(anchor).toMatchObject({
      href: 'https://unifetch.invalid/demo/video.mp4',
      download: 'fictional.jpg',
    });
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not claim cross-origin anchor navigation is a download', () => {
    expect(attemptAnchorDownload(asset)).toEqual({
      status: 'navigation-requested',
    });
    expect(anchor).toMatchObject({
      href: asset.url,
      target: '_blank',
      rel: 'noopener noreferrer',
    });
  });
  it('readable JPEG Blob requests a jpg filename, then revokes', async () => {
    fetcher.mockResolvedValue(
      new Response(new Blob(['fictional media'], { type: 'image/jpeg' })),
    );
    expect(await attemptBlobDownload(asset)).toEqual({ status: 'requested' });
    expect(anchor).toMatchObject({
      href: 'blob:fictional',
      download: asset.suggestedFilename,
    });
    expect(revoke).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:fictional');
  });
  it('revokes the object URL even if clicking fails', async () => {
    fetcher.mockResolvedValue(
      new Response(new Blob(['fictional media'], { type: 'image/jpeg' })),
    );
    (anchor.click as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('click failed');
    });
    expect(await attemptBlobDownload(asset)).toEqual({ status: 'failed' });
    await vi.runAllTimersAsync();
    expect(revoke).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
  });
  it('classifies a CORS fetch rejection without pretending network errors are distinguishable', async () => {
    fetcher.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await attemptBlobDownload(asset)).toEqual({
      status: 'browser-restricted',
      reason: 'cors-or-network',
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(anchor.click).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('maps unreadable download to typed restriction without fallback request', async () => {
    fetcher.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(downloadLocalAsset(asset)).rejects.toMatchObject({
      code: 'BROWSER_RESTRICTION',
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('never routes media fetch through the Resolver or uses cookies', async () => {
    fetcher.mockResolvedValue(
      new Response(new Blob(['fictional media'], { type: 'image/jpeg' })),
    );
    await downloadLocalAsset(asset);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(asset.url, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  });
  it('rejects opaque responses', async () => {
    fetcher.mockResolvedValue({ type: 'opaque', status: 0 } as Response);
    expect(await attemptBlobDownload(asset)).toEqual({
      status: 'browser-restricted',
      reason: 'opaque',
    });
  });
  it('does not download HTTP failure bodies', async () => {
    fetcher.mockResolvedValue(new Response('not media', { status: 403 }));
    expect(await attemptBlobDownload(asset)).toEqual({ status: 'failed' });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it.each([
    'javascript:alert(1)',
    'data:text/plain,x',
    'file:///example',
    'https://user:secret@media.invalid/a',
  ])('rejects unsafe original URL %s', (url) => {
    expect(() => originalMediaUrl(url)).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('retains the direct original URL', () => {
    expect(originalMediaUrl(asset.url)).toBe(asset.url);
  });
  it('keeps Worker route allowlist metadata-only', () => {
    const worker = readFileSync(
      new URL('../../../apps/resolver-worker/src/index.ts', import.meta.url),
      'utf8',
    );
    expect(worker).not.toContain('/api/download');
    expect(worker).not.toContain('/api/media');
    expect(worker).toContain("'/api/resolve'");
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareBlobDownload } from '@unifetch/downloader';
import type { ThreadsAcquisitionAdapter } from '@unifetch/meta-resolver/threads';
import { parseThreadsTarget } from '../target';
import { resolveThreadsTarget } from './resolve';
import {
  carouselCode,
  carouselSsr,
  embedHtml,
  gifCode,
  gifSsr,
  image,
  imageCode,
  imageSsr,
  ssrHtml,
  threadsUsername,
  videoCode,
  videoSsr,
} from './__fixtures__/ssr';

function acquisition(
  postHtml: string,
  shareLocation = `https://www.threads.com/@${threadsUsername}/post/${imageCode}/?xmt=synthetic`,
): ThreadsAcquisitionAdapter {
  return {
    acquirePost: vi.fn(async () => ({
      html: postHtml,
      network: [{ origin: 'https://www.threads.com', purpose: 'metadata' }],
    })),
    acquireEmbed: vi.fn(async () => ({
      html: embedHtml,
      network: [{ origin: 'https://www.threads.com', purpose: 'metadata' }],
    })),
    acquireShare: vi.fn(async () => ({
      location: shareLocation,
      network: [{ origin: 'https://www.threads.com', purpose: 'metadata' }],
    })),
  } as never;
}

async function finalNames(
  url: string,
  postHtml: string,
  shareLocation?: string,
): Promise<string[]> {
  const target = parseThreadsTarget(url);
  if (!target) throw new Error('expected a Threads target');
  const result = await resolveThreadsTarget(
    target,
    acquisition(postHtml, shareLocation),
  );
  if (!result.ok) throw new Error(result.error);
  const names: string[] = [];
  for (const asset of result.assets) {
    const mimeType =
      asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new Blob([new Uint8Array([0])], { type: mimeType })),
      ),
    );
    const prepared = await prepareBlobDownload(asset);
    if (prepared.status !== 'ready')
      throw new Error(`unexpected ${prepared.status}`);
    names.push(prepared.file.filename);
  }
  return names;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Threads final downloaded filenames', () => {
  it('uses the same caption filename through an official share URL', async () => {
    await expect(
      finalNames(
        'https://www.threads.com/share/synthetic-share-token/',
        imageSsr(),
        `https://www.threads.com/@${threadsUsername}/post/${imageCode}/?xmt=synthetic`,
      ),
    ).resolves.toEqual([
      'unifetch_threads_demo_Synthetic-Threads-image-for-pa.jpg',
    ]);
  });

  it('uses the caption for a single image after final MIME finalization', async () => {
    await expect(
      finalNames(
        `https://www.threads.com/@${threadsUsername}/post/${imageCode}/`,
        imageSsr(),
      ),
    ).resolves.toEqual([
      'unifetch_threads_demo_Synthetic-Threads-image-for-pa.jpg',
    ]);
  });

  it('uses the caption and MP4 extension for a native video', async () => {
    await expect(
      finalNames(
        `https://www.threads.com/@${threadsUsername}/post/${videoCode}/`,
        videoSsr(),
      ),
    ).resolves.toEqual([
      'unifetch_threads_demo_Synthetic-Threads-video-for-pa.mp4',
    ]);
  });

  it('keeps ordered indices and per-item extensions for a mixed carousel', async () => {
    await expect(
      finalNames(
        `https://www.threads.com/@${threadsUsername}/post/${carouselCode}/`,
        carouselSsr(),
      ),
    ).resolves.toEqual([
      'unifetch_threads_demo_Synthetic-mixed-Threads-carous_01.jpg',
      'unifetch_threads_demo_Synthetic-mixed-Threads-carous_02.mp4',
      'unifetch_threads_demo_Synthetic-mixed-Threads-carous_03.jpg',
      'unifetch_threads_demo_Synthetic-mixed-Threads-carous_04.mp4',
    ]);
  });

  it('falls back to username_shortcode when the caption is empty', async () => {
    const noCaption = structuredClone(image);
    noCaption.caption = { text: '' };
    await expect(
      finalNames(
        `https://www.threads.com/@${threadsUsername}/post/${imageCode}/`,
        ssrHtml(noCaption),
      ),
    ).resolves.toEqual(['unifetch_threads_demo_synthetic-threads-image.jpg']);
  });

  it('falls back to username_shortcode for an emoji-only caption', async () => {
    const emojiOnly = structuredClone(image);
    emojiOnly.caption = { text: '🌿🌿🌿' };
    await expect(
      finalNames(
        `https://www.threads.com/@${threadsUsername}/post/${imageCode}/`,
        ssrHtml(emojiOnly),
      ),
    ).resolves.toEqual(['unifetch_threads_demo_synthetic-threads-image.jpg']);
  });

  it('preserves a Unicode caption through final download preparation', async () => {
    const unicode = structuredClone(image);
    unicode.caption = { text: '真剣なミケ' };
    await expect(
      finalNames(
        `https://www.threads.com/@${threadsUsername}/post/${imageCode}/`,
        ssrHtml(unicode),
      ),
    ).resolves.toEqual(['unifetch_threads_demo_真剣なミケ.jpg']);
  });

  it('keeps the GIF extension after download preparation', async () => {
    await expect(
      finalNames(
        `https://www.threads.com/@${threadsUsername}/post/${gifCode}/`,
        gifSsr(),
      ),
    ).resolves.toEqual([
      'unifetch_threads_demo_Synthetic-Threads-GIF-for-pars.gif',
    ]);
  });
});

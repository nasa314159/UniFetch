import type {
  ThreadsResolvedMedia,
  ThreadsResolvedAsset,
} from '../../../../../packages/meta-resolver/src/threads/types';
import image from '../../../../../packages/meta-resolver/src/threads/__fixtures__/image.json';
import video from '../../../../../packages/meta-resolver/src/threads/__fixtures__/video.json';
import carousel from '../../../../../packages/meta-resolver/src/threads/__fixtures__/carousel.json';
import gif from '../../../../../packages/meta-resolver/src/threads/__fixtures__/gif.json';

export const threadsUsername = 'unifetch_threads_demo';
export const imageCode = 'synthetic-threads-image';
export const videoCode = 'synthetic-threads-video';
export const carouselCode = 'synthetic-threads-carousel';
export const gifCode = 'synthetic-threads-gif';

export { image, video, carousel, gif };

/** Wraps one synthetic media object in the SSR script shape the parser reads. */
export function ssrHtml(media: unknown): string {
  const payload = {
    require: [
      [
        'ScheduledServerJS',
        'handle',
        null,
        [
          {
            __bbox: {
              require: [
                [
                  'RelayPrefetchedStreamCache',
                  'next',
                  [],
                  [
                    'synthetic-preloader',
                    { __bbox: { complete: true, result: { data: { media } } } },
                  ],
                ],
              ],
            },
          },
        ],
      ],
    ],
  };
  return `<!doctype html><html><body><script type="application/json" data-sjs>${JSON.stringify(payload)}</script></body></html>`;
}

export function imageSsr(): string {
  return ssrHtml(image);
}

export function videoSsr(): string {
  return ssrHtml(video);
}

export function carouselSsr(): string {
  return ssrHtml(carousel);
}

export function gifSsr(): string {
  return ssrHtml(gif);
}

export const embedHtml = `<!doctype html><html><body>
<a href="https://www.threads.com/&#064;${threadsUsername}/post/${gifCode}?xmt=synthetic">View on Threads</a>
<img src="https://external-tpe1-1.xx.fbcdn.net/emg1/v/t13/synthetic?url=https%3A%2F%2Fmedia.giphy.com%2Fmedia%2Fsynthetic%2F200.gif&amp;utld=giphy.com" alt="" />
</body></html>`;

export function assetKinds(
  media: ThreadsResolvedMedia,
): ThreadsResolvedAsset['type'][] {
  return media.assets.map((asset) => asset.type);
}

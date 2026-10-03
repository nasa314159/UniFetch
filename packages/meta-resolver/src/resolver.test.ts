import { describe, expect, it, vi } from 'vitest';
import { createResolver } from './index';
import type { RuntimeAdapter } from '@unifetch/core';
const request = vi.fn(async () => {
  throw new Error('Fixture resolution must not request network');
});
const runtime: RuntimeAdapter = {
  request,
  download: async () => {},
  capabilities: () => ({ downloads: true, crossOriginRequests: false }),
};
const resolver = createResolver(runtime);
describe('Deterministic Instagram fixtures', () => {
  it('resolves a single image', async () => {
    const { post } = await resolver.resolve(
      'https://www.instagram.com/p/unifetch-demo-image/',
    );
    expect(post.assets).toHaveLength(1);
    expect(post.assets[0].type).toBe('image');
  });
  it('resolves the ordered carousel', async () => {
    const { post } = await resolver.resolve(
      'https://m.instagram.com/p/unifetch-demo-carousel/?igsh=test',
    );
    expect(post.assets.map((a) => a.type)).toEqual([
      'image',
      'image',
      'video',
      'image',
    ]);
  });
  it('resolves a Reel', async () => {
    const { post } = await resolver.resolve(
      'https://instagram.com/reel/unifetch-demo-reel',
    );
    expect(post.assets[0]).toMatchObject({
      type: 'video',
      width: 540,
      height: 960,
    });
  });
  it('rejects arbitrary live Instagram URLs explicitly', async () => {
    await expect(
      resolver.resolve('https://instagram.com/p/REAL123/'),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
      message: expect.stringContaining(
        'Live Instagram resolution is not implemented',
      ),
    });
  });
  it.each(['image', 'carousel', 'reel'])(
    'reports accurate privacy for %s',
    async (kind) => {
      const { trace } = await resolver.resolve(
        `https://instagram.com/${kind === 'reel' ? 'reel' : 'p'}/unifetch-demo-${kind}/`,
      );
      expect(trace).toEqual({
        processedLocally: true,
        remoteProxyUsed: false,
        credentialsExported: false,
        network: [],
      });
      expect(request).not.toHaveBeenCalled();
    },
  );
  it('returns isolated results', async () => {
    const first = await resolver.resolve(
      'https://instagram.com/p/unifetch-demo-image/',
    );
    first.post.caption = 'changed';
    const second = await resolver.resolve(
      'https://instagram.com/p/unifetch-demo-image/',
    );
    expect(second.post.caption).not.toBe('changed');
  });
});

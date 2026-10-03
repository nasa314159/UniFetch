import { describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import ResultPanel from './ResultPanel.vue';
import { createWebResolver } from '../resolver-client';

describe('Rendered resolution privacy', () => {
  it('shows Resolver source and separates metadata from media', async () => {
    const fixture = await createWebResolver().resolve(
      'https://instagram.com/p/unifetch-demo-image/',
    );
    const result = {
      ...fixture,
      source: 'worker' as const,
      trace: {
        processedLocally: false,
        remoteProxyUsed: true,
        metadataResolverUsed: true,
        mediaProxyUsed: false,
        credentialsExported: false,
        network: [],
      },
    };
    const html = await renderToString(createSSRApp(ResultPanel, { result }));
    expect(html).toContain('Resolution source: UniFetch Resolver');
    expect(html).toContain('Metadata resolved by UniFetch Resolver');
    expect(html).toContain('Media is not proxied through UniFetch');
    expect(html).toContain('No Instagram credentials uploaded');
    expect(html).not.toContain('Processed locally');
    expect(html).not.toContain('No remote UniFetch proxy');
  });
  it('retains the accurate local demo source and privacy', async () => {
    const result = await createWebResolver().resolve(
      'https://instagram.com/p/unifetch-demo-image/',
    );
    const html = await renderToString(createSSRApp(ResultPanel, { result }));
    expect(html).toContain('Resolution source: Demo fixture');
    expect(html).toContain('Processed locally');
    expect(html).toContain('No real Instagram request');
  });
});

describe('Direct original media actions', () => {
  it('opens the direct URL separately and never labels navigation as a saved download', async () => {
    const fixture = await createWebResolver().resolve(
      'https://instagram.com/p/unifetch-demo-image/',
    );
    const result = {
      ...fixture,
      source: 'worker' as const,
      post: {
        ...fixture.post,
        assets: [
          {
            ...fixture.post.assets[0],
            url: 'https://media.invalid/original.jpg',
          },
        ],
      },
    };
    const html = await renderToString(createSSRApp(ResultPanel, { result }));
    expect(html).toContain('href="https://media.invalid/original.jpg"');
    expect(html).toContain('Open original');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('without claiming it was saved');
    expect(html).not.toContain('Download complete');
  });
});

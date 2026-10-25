import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  normalizeInstagramMedia,
  parseInstagramContentRef,
  parseInstagramMediaResponse,
} from '@unifetch/meta-resolver/instagram';
import {
  normalizeThreadsMedia,
  parseThreadsContentRef,
  parseThreadsSsrHtml,
} from '@unifetch/meta-resolver/threads';

const evidenceDir = process.env.L2A_EVIDENCE_DIR;
const instagramReady = Boolean(
  evidenceDir && existsSync(join(evidenceDir, 'instagram-raw.json')),
);
const threadsReady = Boolean(
  evidenceDir && existsSync(join(evidenceDir, 'threads-raw.html')),
);

function readJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(join(evidenceDir as string, name), 'utf8'),
  ) as T;
}

function writeJson(name: string, value: unknown): void {
  writeFileSync(
    join(evidenceDir as string, name),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

describe.skipIf(!instagramReady)('live Instagram parser evidence', () => {
  it('parses the native response with the production parser and normalizer', () => {
    const fetched = readJson<{
      shortcode: string;
      kind: 'post' | 'reel';
      canonicalUrl: string;
      status: number;
      csrfFound: boolean;
    }>('instagram-fetch.json');
    const raw = readJson<unknown>('instagram-raw.json');
    const ref = parseInstagramContentRef(fetched.canonicalUrl);

    expect(fetched.status).toBe(200);
    expect(fetched.csrfFound).toBe(true);
    expect(ref.shortcode).toBe(fetched.shortcode);
    expect(ref.kind).toBe(fetched.kind);

    const media = parseInstagramMediaResponse(raw, ref.shortcode);
    expect(media.kind).toBe('image');
    const normalized = normalizeInstagramMedia(media, ref.canonicalUrl);
    expect(normalized.post.platform).toBe('instagram');
    expect(normalized.post.assets.length).toBe(1);
    expect(normalized.post.assets[0].type).toBe('image');
    expect(normalized.post.assets[0].suggestedFilename).toMatch(/\.jpg$/);

    const asset = normalized.post.assets[0];
    const trace = {
      ...normalized.trace,
      processedLocally: true,
      remoteProxyUsed: false,
      metadataResolverUsed: false,
      mediaProxyUsed: false,
      credentialsExported: false,
      network: [
        { origin: 'https://www.instagram.com', purpose: 'metadata' as const },
      ],
    };
    writeJson('instagram-asset.json', {
      url: asset.url,
      suggestedFilename: asset.suggestedFilename,
    });
    writeJson('instagram-parsed.json', {
      platform: normalized.post.platform,
      kind: media.kind,
      canonicalUrl: normalized.post.canonicalUrl,
      authorUsername: normalized.post.author?.username ?? null,
      captionLength: normalized.post.caption?.length ?? 0,
      assetCount: normalized.post.assets.length,
      assets: normalized.post.assets.map((entry) => ({
        type: entry.type,
        width: entry.width ?? null,
        height: entry.height ?? null,
        suggestedFilename: entry.suggestedFilename,
      })),
      trace,
    });
  });
});

describe.skipIf(!threadsReady)('live Threads parser evidence', () => {
  it('parses the native SSR response with the production parser and normalizer', () => {
    const fetched = readJson<{
      status: number;
      requestedUsername: string;
      requestedShortcode: string;
      finalUsername: string;
      finalShortcode: string;
      finalUrl: string;
      redirected: boolean;
    }>('threads-fetch.json');
    const html = readFileSync(
      join(evidenceDir as string, 'threads-raw.html'),
      'utf8',
    );
    const ref = parseThreadsContentRef(fetched.finalUrl);

    expect(fetched.status).toBe(200);
    expect(ref.shortcode).toBe(fetched.requestedShortcode);
    expect(ref.username).toBe(fetched.finalUsername);
    expect(fetched.finalShortcode).toBe(fetched.requestedShortcode);

    const media = parseThreadsSsrHtml(html, ref);
    expect(media.kind).toBe('image');
    expect(media.username).toBe(fetched.finalUsername);
    expect(media.shortcode).toBe(fetched.requestedShortcode);

    const normalized = normalizeThreadsMedia(media, ref.canonicalUrl);
    expect(normalized.post.platform).toBe('threads');
    expect(normalized.post.assets.length).toBe(1);
    expect(normalized.post.assets[0].type).toBe('image');
    expect(normalized.post.assets[0].suggestedFilename).toMatch(/\.jpg$/);

    const asset = normalized.post.assets[0];
    const trace = {
      ...normalized.trace,
      processedLocally: true,
      remoteProxyUsed: false,
      metadataResolverUsed: false,
      mediaProxyUsed: false,
      credentialsExported: false,
      network: [
        { origin: 'https://www.threads.com', purpose: 'metadata' as const },
      ],
    };
    writeJson('threads-asset.json', {
      url: asset.url,
      suggestedFilename: asset.suggestedFilename,
    });
    writeJson('threads-parsed.json', {
      platform: normalized.post.platform,
      kind: media.kind,
      canonicalUrl: normalized.post.canonicalUrl,
      authorUsername: normalized.post.author?.username ?? null,
      captionLength: normalized.post.caption?.length ?? 0,
      redirected: fetched.redirected,
      assetCount: normalized.post.assets.length,
      assets: normalized.post.assets.map((entry) => ({
        type: entry.type,
        width: entry.width ?? null,
        height: entry.height ?? null,
        suggestedFilename: entry.suggestedFilename,
      })),
      trace,
    });
  });
});

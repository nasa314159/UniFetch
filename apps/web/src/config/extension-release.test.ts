import { describe, expect, it } from 'vitest';
import manifestSource from '../../../extension/manifest.json?raw';
import packageSource from '../../../extension/package.json?raw';
import {
  EXTENSION_RELEASE,
  formatReleaseSize,
  hasVerifiedRelease,
} from './extension-release';

const manifest = JSON.parse(manifestSource) as {
  version: string;
  minimum_chrome_version?: string;
};
const packageJson = JSON.parse(packageSource) as { version: string };

describe('verified extension release configuration', () => {
  it('matches the published release and source version', () => {
    // The website points at the published v0.3.0 asset and the source manifest
    // must stay in lockstep with it.
    expect(manifest.version).toBe(packageJson.version);
    expect(EXTENSION_RELEASE.fileName).toBe(
      `unifetch-chromium-extension-v${EXTENSION_RELEASE.version}.zip`,
    );
    expect(EXTENSION_RELEASE.tag).toBe(
      `extension-v${EXTENSION_RELEASE.version}`,
    );
    expect(EXTENSION_RELEASE.minChromeVersion).toBe(
      manifest.minimum_chrome_version,
    );
    const published = EXTENSION_RELEASE.version.split('.').map(Number);
    const source = manifest.version.split('.').map(Number);
    expect(source.length).toBe(3);
    expect(published.length).toBe(3);
    expect(
      source[0] > published[0] ||
        (source[0] === published[0] && source[1] >= published[1]),
    ).toBe(true);
  });

  it('keeps download URLs and checksums internally consistent', () => {
    expect(EXTENSION_RELEASE.releasesUrl).toBe(
      `${EXTENSION_RELEASE.repositoryUrl}/releases`,
    );
    if (EXTENSION_RELEASE.downloadUrl) {
      expect(EXTENSION_RELEASE.downloadUrl).toBe(
        `${EXTENSION_RELEASE.repositoryUrl}/releases/download/${EXTENSION_RELEASE.tag}/${EXTENSION_RELEASE.fileName}`,
      );
      expect(EXTENSION_RELEASE.downloadUrl).not.toContain('/latest/');
      expect(EXTENSION_RELEASE.downloadUrl).not.toContain('chrome.google.com');
    }
    expect(EXTENSION_RELEASE.installHelpUrl).toMatch(
      /^https:\/\/developer\.chrome\.com\//,
    );
  });

  it('publishes a checksum and size only for a concrete release', () => {
    if (EXTENSION_RELEASE.downloadUrl) {
      expect(EXTENSION_RELEASE.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(EXTENSION_RELEASE.sizeBytes).toBeGreaterThan(0);
      expect(hasVerifiedRelease()).toBe(true);
    } else {
      expect(EXTENSION_RELEASE.sha256).toBeNull();
      expect(EXTENSION_RELEASE.sizeBytes).toBeNull();
      expect(hasVerifiedRelease()).toBe(false);
    }
  });

  it('fails closed when any release field is missing or malformed', () => {
    const verified = {
      ...EXTENSION_RELEASE,
      downloadUrl: `https://github.com/nasa314159/UniFetch/releases/download/${EXTENSION_RELEASE.tag}/${EXTENSION_RELEASE.fileName}`,
      sha256: 'a'.repeat(64),
      sizeBytes: 1024,
    };
    expect(hasVerifiedRelease(verified)).toBe(true);
    expect(hasVerifiedRelease({ ...verified, downloadUrl: null })).toBe(false);
    expect(hasVerifiedRelease({ ...verified, sha256: null })).toBe(false);
    expect(hasVerifiedRelease({ ...verified, sha256: 'abc' })).toBe(false);
    expect(hasVerifiedRelease({ ...verified, sizeBytes: 0 })).toBe(false);
  });

  it('formats archive sizes for the install page', () => {
    expect(formatReleaseSize(null)).toBe('size unavailable');
    expect(formatReleaseSize(512)).toBe('512 B');
    expect(formatReleaseSize(1536)).toBe('1.5 KiB');
    expect(formatReleaseSize(2 * 1024 * 1024)).toBe('2.00 MiB');
  });
});

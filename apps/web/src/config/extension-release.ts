/**
 * The single source of truth for the public extension release.
 *
 * Only point `downloadUrl` at a GitHub Releases asset that has actually been
 * published and downloaded back from GitHub. When no verified asset exists,
 * set `downloadUrl`, `sha256` and `sizeBytes` to null; the install page then
 * shows an accurate "release not yet available" state instead of a dead link.
 *
 * The build/packaging tests keep this file consistent with
 * apps/extension/manifest.json and the GitHub Release asset name.
 */
export interface ExtensionReleaseConfig {
  version: string;
  tag: string;
  fileName: string;
  downloadUrl: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  repositoryUrl: string;
  releasesUrl: string;
  installHelpUrl: string;
  minChromeVersion: string;
}

const repositoryUrl = 'https://github.com/nasa314159/UniFetch';

export const EXTENSION_RELEASE: ExtensionReleaseConfig = {
  version: '0.2.0',
  tag: 'extension-v0.2.0',
  fileName: 'unifetch-chromium-extension-v0.2.0.zip',
  downloadUrl: null,
  sha256: null,
  sizeBytes: null,
  repositoryUrl,
  releasesUrl: `${repositoryUrl}/releases`,
  installHelpUrl:
    'https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked',
  minChromeVersion: '118',
};

/** True only when a concrete, versioned release asset and checksum exist. */
export function hasVerifiedRelease(
  release: ExtensionReleaseConfig = EXTENSION_RELEASE,
): boolean {
  return Boolean(
    release.downloadUrl &&
    release.sha256 &&
    /^[a-f0-9]{64}$/.test(release.sha256) &&
    release.sizeBytes &&
    release.sizeBytes > 0,
  );
}

export function formatReleaseSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return 'size unavailable';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertManifestPolicy,
  assertNoSecrets,
  assertSafeArchivePath,
  createZip,
  crc32,
  dirtyTreeEntries,
  manifestRuntimeFiles,
  readZip,
} from './package-extension.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'apps/web/src/config/extension-release.ts');
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts');
const metadataPath = path.join(ARTIFACTS_DIR, 'extension-release.json');
const artifactExists = existsSync(metadataPath);

function configValue(key) {
  const source = readFileSync(CONFIG_PATH, 'utf8');
  const match = source.match(
    new RegExp(`\\b${key}:\\s*(?:'([^']*)'|"([^"]*)"|(null)|(\\d+))`),
  );
  return match?.[3]
    ? null
    : match?.[4]
      ? Number(match[4])
      : (match?.[1] ?? match?.[2]);
}

describe('deterministic extension ZIP writer', () => {
  const entries = [
    {
      archivePath: 'unifetch-chromium-extension-v0.2.0/manifest.json',
      data: Buffer.from('{"manifest_version":3}'),
    },
    {
      archivePath: 'unifetch-chromium-extension-v0.2.0/background.js',
      data: Buffer.from('console.log("background");'),
    },
    {
      archivePath: 'unifetch-chromium-extension-v0.2.0/popup.html',
      data: Buffer.from('<!doctype html><title>UniFetch</title>'),
    },
  ];

  it('produces byte-identical archives regardless of input order', () => {
    const first = createZip(entries);
    const second = createZip([...entries].reverse());
    expect(first.equals(second)).toBe(true);
    expect(createHash('sha256').update(first).digest('hex')).toBe(
      createHash('sha256').update(second).digest('hex'),
    );
  });

  it('round-trips every file with valid CRCs', () => {
    const decoded = readZip(createZip(entries));
    expect(decoded.map((entry) => entry.path)).toEqual(
      [...entries].map((entry) => entry.archivePath).sort(),
    );
    for (const entry of entries) {
      const match = decoded.find((item) => item.path === entry.archivePath);
      expect(match?.data.equals(entry.data)).toBe(true);
      expect(crc32(entry.data)).toBeGreaterThan(0);
    }
  });

  it('stores manifest.json one level below the archive root, not under dist/', () => {
    const decoded = readZip(createZip(entries));
    const roots = new Set(decoded.map((entry) => entry.path.split('/')[0]));
    expect(roots.size).toBe(1);
    const root = [...roots][0];
    expect(root).toBe('unifetch-chromium-extension-v0.2.0');
    expect(
      decoded.some((entry) => entry.path === `${root}/manifest.json`),
    ).toBe(true);
    expect(decoded.some((entry) => entry.path.includes('/dist/'))).toBe(false);
  });

  it('rejects duplicate and unsafe archive paths', () => {
    expect(() => createZip([entries[0], entries[0]])).toThrow(
      /Duplicate archive path/,
    );
    expect(() => assertSafeArchivePath('../secret.js')).toThrow(
      /Unsafe archive path/,
    );
    expect(() => assertSafeArchivePath('/absolute.js')).toThrow(
      /Unsafe archive path/,
    );
    expect(() => assertSafeArchivePath('root/data.bin')).toThrow(
      /Unexpected runtime file type/,
    );
  });
});

describe('release archive audit rules', () => {
  it('rejects source, environment and local development files', () => {
    for (const file of [
      'root/node_modules/pkg/index.js',
      'root/.env',
      'root/opencode.jsonc',
      'root/src/background.ts',
      'root/.DS_Store',
      'root/source-map.js.map',
    ]) {
      expect(() => assertSafeArchivePath(file)).toThrow();
    }
  });

  it('accepts only runtime extension files', () => {
    for (const file of [
      'root/manifest.json',
      'root/background.js',
      'root/popup.html',
      'root/icon.svg',
    ]) {
      expect(assertSafeArchivePath(file)).toBe(file);
    }
  });

  it('rejects credentials, session identifiers and local config references', () => {
    expect(() =>
      assertNoSecrets('background.js', Buffer.from('const x = "sessionid";')),
    ).toThrow(/secret or development reference/);
    expect(() =>
      assertNoSecrets(
        'background.js',
        Buffer.from(`const token = "ghp_${'a'.repeat(36)}";`),
      ),
    ).toThrow(/secret or development reference/);
    expect(() =>
      assertNoSecrets('popup.js', Buffer.from('opencode.jsonc')),
    ).toThrow(/secret or development reference/);
    expect(() =>
      assertNoSecrets('popup.js', Buffer.from('console.log("safe runtime");')),
    ).not.toThrow();
  });

  it('detects manifest-referenced runtime files', () => {
    expect(
      manifestRuntimeFiles({
        background: { service_worker: 'background.js' },
        action: { default_popup: 'popup.html' },
        icons: { 16: 'icon-16.png' },
      }),
    ).toEqual(['background.js', 'icon-16.png', 'popup.html']);
  });

  it('rejects weakened manifest permissions and broad host access', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(ROOT, 'apps/extension/manifest.json'), 'utf8'),
    );
    expect(() => assertManifestPolicy(manifest)).not.toThrow();
    expect(manifest.optional_host_permissions).toEqual([
      'https://www.threads.com/*',
    ]);
    expect(() =>
      assertManifestPolicy({
        ...manifest,
        permissions: [...manifest.permissions, 'cookies'],
      }),
    ).toThrow(/Unexpected extension permissions/);
    expect(() =>
      assertManifestPolicy({
        ...manifest,
        host_permissions: ['<all_urls>'],
      }),
    ).toThrow(/Unexpected host permissions/);
    expect(() =>
      assertManifestPolicy({
        ...manifest,
        optional_host_permissions: ['https://*/*'],
      }),
    ).toThrow(/Unexpected optional host permissions/);
  });

  it('ignores only local agent config and generated artifacts when checking dirtiness', () => {
    const status = [
      '?? opencode.jsonc',
      '?? artifacts/unifetch.zip',
      ' M apps/web/src/App.vue',
      '?? docs/new.md',
    ].join('\0');
    expect(dirtyTreeEntries(`${status}\0`)).toEqual([
      { status: ' M', file: 'apps/web/src/App.vue' },
      { status: '??', file: 'docs/new.md' },
    ]);
  });
});

describe.skipIf(!artifactExists)('published artifact verification', () => {
  it('matches the verified website configuration', () => {
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    const archivePath = path.join(ARTIFACTS_DIR, metadata.assetName);
    expect(existsSync(archivePath)).toBe(true);
    const archive = readFileSync(archivePath);
    expect(createHash('sha256').update(archive).digest('hex')).toBe(
      metadata.sha256,
    );
    expect(archive.length).toBe(metadata.sizeBytes);
    // A newer local candidate may exist before it is published. Only the
    // version recorded on the website must match the published artifact.
    if (metadata.version !== configValue('version')) {
      expect(configValue('version')).toBe('0.2.0');
      expect(metadata.version).toBe('0.3.0');
      return;
    }
    expect(metadata.sha256).toBe(configValue('sha256'));
    expect(metadata.assetName).toBe(configValue('fileName'));
    expect(metadata.tag).toBe(configValue('tag'));
    expect(configValue('downloadUrl')).toBe(
      `https://github.com/nasa314159/UniFetch/releases/download/${metadata.tag}/${metadata.assetName}`,
    );
  });

  it('contains exactly one loadable extension root with verified manifest references', () => {
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    const decoded = readZip(
      readFileSync(path.join(ARTIFACTS_DIR, metadata.assetName)),
    );
    const roots = new Set(decoded.map((entry) => entry.path.split('/')[0]));
    expect(roots.size).toBe(1);
    const root = [...roots][0];
    expect(root).toBe(`unifetch-chromium-extension-v${metadata.version}`);
    expect(decoded.some((entry) => entry.path.includes('/dist/'))).toBe(false);

    const manifestEntry = decoded.find(
      (entry) => entry.path === `${root}/manifest.json`,
    );
    expect(manifestEntry).toBeTruthy();
    const manifest = JSON.parse(manifestEntry.data.toString('utf8'));
    expect(manifest.version).toBe(metadata.version);
    expect(manifest.manifest_version).toBe(3);

    const packaged = new Set(
      decoded.map((entry) => entry.path.slice(root.length + 1)),
    );
    for (const reference of manifestRuntimeFiles(manifest)) {
      expect(packaged.has(reference)).toBe(true);
    }
    expect(packaged.has('background.js')).toBe(true);
    expect(packaged.has('popup.html')).toBe(true);
    expect(packaged.has('popup.js')).toBe(true);

    for (const entry of decoded) {
      const relative = entry.path.slice(root.length + 1);
      expect(() => assertSafeArchivePath(relative)).not.toThrow();
      expect(() => assertNoSecrets(relative, entry.data)).not.toThrow();
      expect(relative).not.toMatch(/(?:^|\/)dist(?:\/|$)/);
      expect(relative).not.toContain('opencode.jsonc');
      expect(relative).not.toContain('node_modules');
      expect(relative).not.toMatch(/\.(?:ts|vue|map|env)$/);
    }
  });
});

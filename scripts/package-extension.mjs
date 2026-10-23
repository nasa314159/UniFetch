#!/usr/bin/env node
/**
 * Build, audit and deterministically package the Chromium extension.
 *
 * The archive contains ONE top-level directory named after the release. That
 * directory directly contains manifest.json and every runtime file referenced
 * by the manifest. It contains no source, node_modules, environment files or
 * development caches.
 *
 * Determinism: files are sorted, a fixed 1980-01-01 DOS timestamp is used and
 * no extra fields are written. Building the same extension source twice must
 * produce byte-identical archives and the same SHA-256 checksum.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
);

/** Files that must never enter a release archive. */
export const FORBIDDEN_NAMES = new Set([
  '.DS_Store',
  '.env',
  '.env.local',
  'opencode.jsonc',
  'node_modules',
  '.git',
  '.wrangler',
  'pnpm-lock.yaml',
]);

/** Known development/source extensions that must never ship. */
export const FORBIDDEN_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.vue',
  '.map',
  '.md',
  '.env',
  '.local',
  '.log',
  '.sqlite',
  '.pem',
  '.key',
]);

/** Runtime extensions we expect to be able to load in Chromium. */
export const ALLOWED_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.html',
  '.json',
  '.css',
  '.png',
  '.jpg',
  '.jpeg',
  '.svg',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.wasm',
]);

export const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bCLOUDFLARE_API_TOKEN\b/,
  /\bINSTAGRAM_(?:PASSWORD|SESSION|COOKIE)\b/,
  /\bsessionid\b/i,
  /\bopencode\.jsonc\b/,
];

const PERMISSION_ALLOWLIST = ['activeTab', 'clipboardRead', 'scripting'];
const HOST_ALLOWLIST = ['https://www.instagram.com/*'];

/* ------------------------------------------------------------------ ZIP --- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Fixed 1980-01-01 00:00:00 timestamp for reproducible archives. */
const FIXED_DOS_TIME = 0;
const FIXED_DOS_DATE = (0 << 9) | (1 << 5) | 1;

/**
 * Create a deterministic ZIP from `{ archivePath, data }` entries.
 * @param {{ archivePath: string, data: Buffer }[]} entries
 * @returns {Buffer}
 */
export function createZip(entries) {
  const files = [...entries].sort((left, right) =>
    left.archivePath < right.archivePath
      ? -1
      : left.archivePath > right.archivePath
        ? 1
        : 0,
  );
  const seen = new Set();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    if (seen.has(file.archivePath)) {
      throw new Error(`Duplicate archive path: ${file.archivePath}`);
    }
    seen.add(file.archivePath);
    if (file.archivePath.includes('\\') || file.archivePath.startsWith('/')) {
      throw new Error(`Unsafe archive path: ${file.archivePath}`);
    }
    const name = Buffer.from(file.archivePath, 'utf8');
    const data = Buffer.isBuffer(file.data)
      ? file.data
      : Buffer.from(file.data);
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(FIXED_DOS_TIME, 10);
    local.writeUInt16LE(FIXED_DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(FIXED_DOS_TIME, 12);
    central.writeUInt16LE(FIXED_DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

/**
 * Read a ZIP produced by `createZip` (or any well-formed stored/deflated ZIP)
 * and verify CRCs while extracting.
 * @param {Buffer} buffer
 * @returns {{ path: string, data: Buffer }[]}
 */
export function readZip(buffer) {
  let endOffset = -1;
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      endOffset = index;
      break;
    }
  }
  if (endOffset === -1) throw new Error('Not a ZIP archive: no end record');
  const count = buffer.readUInt16LE(endOffset + 10);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  const entries = [];
  let cursor = centralOffset;

  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('Corrupt ZIP central directory');
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString('utf8');

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Corrupt local header for ${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const payload = buffer.subarray(dataStart, dataStart + compressedSize);
    const data =
      method === 0
        ? Buffer.from(payload)
        : method === 8
          ? inflateRawSync(payload)
          : (() => {
              throw new Error(`Unsupported ZIP method ${method} for ${name}`);
            })();
    if (data.length !== uncompressedSize) {
      throw new Error(`Size mismatch for ${name}`);
    }
    if (crc32(data) !== crc) throw new Error(`CRC mismatch for ${name}`);
    entries.push({ path: name, data });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/* --------------------------------------------------------------- AUDIT --- */

export function assertSafeArchivePath(archivePath) {
  const posix = archivePath.split('\\').join('/');
  if (posix.startsWith('/') || posix.split('/').includes('..')) {
    throw new Error(`Unsafe archive path: ${archivePath}`);
  }
  const segments = posix.split('/');
  for (const segment of segments.slice(0, -1)) {
    if (FORBIDDEN_NAMES.has(segment)) {
      throw new Error(`Forbidden directory in archive: ${archivePath}`);
    }
  }
  const base = segments.pop() ?? '';
  if (FORBIDDEN_NAMES.has(base)) {
    throw new Error(`Forbidden file in archive: ${archivePath}`);
  }
  const extension = path.extname(base).toLowerCase();
  if (FORBIDDEN_EXTENSIONS.has(extension)) {
    throw new Error(`Forbidden source/development file: ${archivePath}`);
  }
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error(`Unexpected runtime file type: ${archivePath}`);
  }
  return posix;
}

/** Scan a runtime file for credentials and development-only references. */
export function assertNoSecrets(archivePath, data) {
  const text = data.toString('utf8');
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error(
        `Possible secret or development reference in ${archivePath}: ${pattern}`,
      );
    }
  }
}

/** Collect manifest-referenced relative paths that must exist in the build. */
export function manifestRuntimeFiles(manifest) {
  const references = new Set();
  const add = (value) => {
    if (typeof value !== 'string' || value.trim() === '') return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('/')) return;
    if (value.includes('*')) return;
    references.add(value.replace(/^\.\//, ''));
  };
  const addIconSet = (value) => {
    if (typeof value === 'string') add(value);
    else if (value && typeof value === 'object') {
      for (const icon of Object.values(value)) add(icon);
    }
  };

  add(manifest.background?.service_worker);
  add(manifest.action?.default_popup);
  add(manifest.options_page);
  add(manifest.options_ui?.page);
  add(manifest.devtools_page);
  add(manifest.side_panel?.default_path);
  addIconSet(manifest.action?.default_icon);
  addIconSet(manifest.icons);
  for (const script of manifest.content_scripts ?? []) {
    for (const file of script.js ?? []) add(file);
    for (const file of script.css ?? []) add(file);
  }
  for (const resource of manifest.web_accessible_resources ?? []) {
    for (const file of resource.resources ?? []) add(file);
  }
  return [...references].sort();
}

export function assertManifestPolicy(manifest) {
  if (manifest.manifest_version !== 3) {
    throw new Error('Extension manifest must use Manifest V3');
  }
  const permissions = [...(manifest.permissions ?? [])].sort();
  if (JSON.stringify(permissions) !== JSON.stringify(PERMISSION_ALLOWLIST)) {
    throw new Error(
      `Unexpected extension permissions: ${JSON.stringify(permissions)}`,
    );
  }
  const hosts = [...(manifest.host_permissions ?? [])].sort();
  if (JSON.stringify(hosts) !== JSON.stringify(HOST_ALLOWLIST)) {
    throw new Error(`Unexpected host permissions: ${JSON.stringify(hosts)}`);
  }
  const serialized = JSON.stringify(manifest);
  for (const token of [
    'cookies',
    'history',
    'webRequest',
    '<all_urls>',
    'http://*/*',
    'https://*/*',
  ]) {
    if (serialized.includes(token)) {
      throw new Error(`Forbidden manifest token: ${token}`);
    }
  }
}

async function walkFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absolute, relative)));
    } else if (entry.isFile()) {
      files.push({ relative, absolute });
    } else {
      throw new Error(`Unsupported file type: ${relative}`);
    }
  }
  return files;
}

export function dirtyTreeEntries(porcelainZ) {
  return Buffer.from(porcelainZ)
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((item) => {
      const status = item.slice(0, 2);
      const file = item.slice(3);
      return { status, file };
    })
    .filter(({ file }) => {
      // Local-only agent configuration is never packaged or committed.
      if (file === 'opencode.jsonc') return false;
      if (file === 'artifacts' || file.startsWith('artifacts/')) return false;
      return true;
    });
}

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Build (unless skipped), audit and package the extension.
 * @param {{ skipBuild?: boolean, root?: string, outDir?: string }} options
 */
export async function packageExtension(options = {}) {
  const root = options.root ?? ROOT;
  const extensionDir = path.join(root, 'apps/extension');
  const distDir = path.join(extensionDir, 'dist');
  const outDir = options.outDir ?? path.join(root, 'artifacts');

  const dirty = dirtyTreeEntries(
    execFileSync(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      { cwd: root, encoding: 'buffer' },
    ),
  );
  if (dirty.length > 0) {
    throw new Error(
      `Refusing to package a dirty working tree:\n${dirty
        .map(({ status, file }) => `  ${status} ${file}`)
        .join('\n')}`,
    );
  }

  if (!options.skipBuild) {
    execFileSync('pnpm', ['--filter', '@unifetch/extension', 'build'], {
      cwd: root,
      stdio: 'inherit',
    });
  }

  const packageJson = JSON.parse(
    await readFile(path.join(extensionDir, 'package.json'), 'utf8'),
  );
  const manifestPath = path.join(distDir, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    throw new Error(
      'apps/extension/dist/manifest.json is missing. Run without --skip-build.',
    );
  }
  if (manifest.version !== packageJson.version) {
    throw new Error(
      `Manifest version ${manifest.version} does not match package version ${packageJson.version}`,
    );
  }
  assertManifestPolicy(manifest);

  const referenced = manifestRuntimeFiles(manifest);
  if (referenced.length === 0) {
    throw new Error('Manifest references no runtime files');
  }
  const distFiles = await walkFiles(distDir);
  const distPaths = new Set(distFiles.map(({ relative }) => relative));
  for (const reference of referenced) {
    if (!distPaths.has(reference)) {
      throw new Error(`Manifest-referenced file is missing: ${reference}`);
    }
  }

  const archiveRoot = `unifetch-chromium-extension-v${manifest.version}`;
  const entries = [];
  for (const file of distFiles) {
    const safe = assertSafeArchivePath(file.relative);
    const data = await readFile(file.absolute);
    assertNoSecrets(file.relative, data);
    entries.push({ archivePath: `${archiveRoot}/${safe}`, data });
  }

  // Verify the generated archive exactly matches the audited build.
  const archive = createZip(entries);
  const extracted = readZip(archive);
  if (extracted.length !== entries.length) {
    throw new Error('Archive verification failed: entry count mismatch');
  }
  for (const entry of entries) {
    const match = extracted.find((item) => item.path === entry.archivePath);
    if (!match || !match.data.equals(entry.data)) {
      throw new Error(`Archive verification failed for ${entry.archivePath}`);
    }
  }
  if (!extracted.some((item) => item.path === `${archiveRoot}/manifest.json`)) {
    throw new Error(
      'Archive verification failed: manifest.json is not at root',
    );
  }

  const assetName = `unifetch-chromium-extension-v${manifest.version}.zip`;
  const sha256 = createHash('sha256').update(archive).digest('hex');
  const sourceCommit = git(root, ['rev-parse', 'HEAD']);
  const metadata = {
    name: 'UniFetch Chromium Extension',
    version: manifest.version,
    tag: `extension-v${manifest.version}`,
    assetName,
    sha256,
    sizeBytes: archive.length,
    sourceCommit,
    installPage: 'https://unifetch.pages.dev/extension',
    repository: 'nasa314159/UniFetch',
    files: extracted.map((item) => item.path).sort(),
  };

  await mkdir(outDir, { recursive: true });
  const assetPath = path.join(outDir, assetName);
  await writeFile(assetPath, archive);
  await writeFile(
    path.join(outDir, `${assetName}.sha256`),
    `${sha256}  ${assetName}\n`,
  );
  await writeFile(
    path.join(outDir, 'extension-release.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );

  return {
    ...metadata,
    assetPath,
    metadataPath: path.join(outDir, 'extension-release.json'),
  };
}

async function main() {
  const skipBuild = process.argv.includes('--skip-build');
  const result = await packageExtension({ skipBuild });
  process.stdout.write(
    [
      `Packaged ${result.assetPath}`,
      `Version: ${result.version}`,
      `Tag: ${result.tag}`,
      `Source commit: ${result.sourceCommit}`,
      `Size: ${result.sizeBytes} bytes`,
      `SHA-256: ${result.sha256}`,
      '',
    ].join('\n'),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}

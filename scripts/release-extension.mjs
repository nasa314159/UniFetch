#!/usr/bin/env node
/**
 * Publish the already-audited extension archive as a GitHub Release.
 *
 * Safety rules:
 * - The working tree must be clean (except local opencode.jsonc / artifacts).
 * - The current branch must be main or release/instagram-stable.
 * - HEAD must already exist on origin.
 * - The tag and release must not already exist.
 * - A fresh deterministic package must match the checksum in the website
 *   configuration. If it differs, nothing is published.
 *
 * Usage:
 *   node scripts/release-extension.mjs            # verify only, print plan
 *   node scripts/release-extension.mjs --publish  # create the GitHub Release
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { packageExtension } from './package-extension.mjs';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
);
const CONFIG_PATH = path.join(ROOT, 'apps/web/src/config/extension-release.ts');
const ALLOWED_BRANCHES = ['main', 'release/instagram-stable'];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', options.inherit ? 'inherit' : 'pipe'],
  }).trim();
}

function readConfigValue(source, key) {
  const match = source.match(
    new RegExp(`\\b${key}:\\s*(?:'([^']*)'|"([^"]*)"|(null)|(\\d+))`),
  );
  if (!match)
    throw new Error(`Could not read ${key} from extension release config`);
  if (match[3]) return null;
  if (match[4]) return Number(match[4]);
  return match[1] ?? match[2];
}

const publish = process.argv.includes('--publish');
const skipBuild = process.argv.includes('--skip-build');

const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (!ALLOWED_BRANCHES.includes(branch)) {
  throw new Error(
    `Refusing to release from ${branch}; use one of ${ALLOWED_BRANCHES.join(', ')}`,
  );
}

const head = run('git', ['rev-parse', 'HEAD']);
const originHead = run('git', ['rev-parse', `origin/${branch}`]);
if (head !== originHead) {
  throw new Error(
    `HEAD ${head} is not pushed to origin/${branch} (${originHead}). Push first.`,
  );
}

const result = await packageExtension({ skipBuild });
const config = await readFile(CONFIG_PATH, 'utf8');
const expectedSha = readConfigValue(config, 'sha256');
const expectedFile = readConfigValue(config, 'fileName');
const expectedVersion = readConfigValue(config, 'version');
const expectedTag = readConfigValue(config, 'tag');
const downloadUrl = readConfigValue(config, 'downloadUrl');

if (expectedSha !== result.sha256) {
  throw new Error(
    `Website checksum ${expectedSha} does not match freshly built archive ${result.sha256}. Update ${path.relative(ROOT, CONFIG_PATH)} and commit it before releasing.`,
  );
}
if (expectedFile !== result.assetName) {
  throw new Error(
    `Website fileName ${expectedFile} does not match ${result.assetName}`,
  );
}
if (expectedVersion !== result.version) {
  throw new Error(
    `Website version ${expectedVersion} does not match ${result.version}`,
  );
}
if (expectedTag !== result.tag) {
  throw new Error(`Website tag ${expectedTag} does not match ${result.tag}`);
}

const existingLocalTag = run('git', ['tag', '-l', result.tag]);
if (existingLocalTag) {
  throw new Error(
    `Local tag ${result.tag} already exists; refusing to overwrite`,
  );
}
const remoteTag = run('git', [
  'ls-remote',
  '--tags',
  'origin',
  `refs/tags/${result.tag}`,
]);
if (remoteTag) {
  throw new Error(
    `Remote tag ${result.tag} already exists; refusing to overwrite`,
  );
}
try {
  run('gh', ['release', 'view', result.tag, '--json', 'url']);
  throw new Error(
    `Release ${result.tag} already exists; refusing to overwrite`,
  );
} catch (error) {
  if (
    error instanceof Error &&
    error.message.includes('already exists; refusing')
  ) {
    throw error;
  }
  // A missing release is the expected state.
}

const expectedDownloadUrl = `https://github.com/nasa314159/UniFetch/releases/download/${result.tag}/${result.assetName}`;
if (downloadUrl !== expectedDownloadUrl) {
  throw new Error(
    `Website downloadUrl ${downloadUrl} does not match ${expectedDownloadUrl}`,
  );
}

const archive = await readFile(result.assetPath);
const actualSha = createHash('sha256').update(archive).digest('hex');
if (actualSha !== expectedSha) {
  throw new Error('Archive on disk does not match the recorded checksum');
}

const notes = [
  `UniFetch Chromium Extension v${result.version}`,
  '',
  'Manual unpacked installation for desktop Chrome / Chromium. The extension is not listed in the Chrome Web Store and downloading the ZIP does not install it automatically.',
  '',
  `- Asset: \`${result.assetName}\``,
  `- SHA-256: \`${result.sha256}\``,
  `- Source commit: \`${result.sourceCommit}\``,
  `- Install guide: https://unifetch.pages.dev/extension`,
  '',
  'Supports authenticated Instagram Posts, Carousels, Reels and Stories only when the URL contains an explicit Story ID. Username-only Stories, Highlights and Story enumeration are not supported and fail closed.',
  '',
  'Also supports public-only Threads posts: static images, image carousels, native MP4 video, mixed carousels, tested Giphy GIFs and official /share/ links. Threads requests are sent with credentials omitted and never use your logged-in Threads session. A separate optional threads.com host permission is requested only when you use a Threads link; Instagram does not trigger it. A canonical post whose username changed is accepted only when Threads itself redirects to the same shortcode, and the publisher is validated against the final URL.',
  '',
  'Threads download filenames follow the Instagram caption-first convention: `<author>_<caption-snippet>[_NN].<ext>`, with a stable shortcode fallback when no usable caption exists. Instagram behavior is unchanged.',
  '',
  'The extension uses the Instagram session already present in your browser; it does not read or export cookies, does not use a UniFetch media proxy and sends no telemetry. It does not grant access to content you cannot already view.',
  '',
  'Verify the downloaded ZIP against the SHA-256 above before loading it.',
  '',
].join('\n');

process.stdout.write(
  [
    `Verified ${result.assetName}`,
    `Version: ${result.version}`,
    `Tag: ${result.tag}`,
    `Commit: ${head}`,
    `SHA-256: ${result.sha256}`,
    `Download: ${expectedDownloadUrl}`,
    publish
      ? 'Publishing GitHub Release…'
      : 'Dry run only. Pass --publish to create the release.',
    '',
  ].join('\n'),
);

if (publish) {
  run(
    'gh',
    [
      'release',
      'create',
      result.tag,
      `${result.assetPath}#${result.assetName}`,
      `${result.assetPath}.sha256#${result.assetName}.sha256`,
      '--target',
      head,
      '--title',
      `UniFetch Chromium Extension v${result.version}`,
      '--notes',
      notes,
    ],
    { inherit: true },
  );
  const release = JSON.parse(
    run('gh', [
      'release',
      'view',
      result.tag,
      '--json',
      'url,assets,tagName,isDraft,isPrerelease',
    ]),
  );
  for (const name of [result.assetName, `${result.assetName}.sha256`]) {
    const asset = release.assets?.find((item) => item.name === name);
    if (!asset) throw new Error(`Release was created but ${name} is missing`);
    process.stdout.write(`${name}: ${asset.url}\n`);
  }
  process.stdout.write(
    [
      `Release: ${release.url}`,
      `Draft: ${release.isDraft}; Prerelease: ${release.isPrerelease}`,
      '',
    ].join('\n'),
  );
}

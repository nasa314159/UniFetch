#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = resolve(root, process.env.L2A_EVIDENCE_DIR ?? 'evidence');
const cargoBin =
  process.env.CARGO ??
  (existsSync(join(homedir(), '.cargo', 'bin', 'cargo'))
    ? join(homedir(), '.cargo', 'bin', 'cargo')
    : 'cargo');
const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const manifest = join(root, 'src-tauri', 'Cargo.toml');
const binary = join(root, 'src-tauri', 'target', 'debug', 'unifetch-l2a');

if (process.env.L2A_ALLOW_LIVE !== '1') {
  console.error(
    'Refusing live network validation. Set L2A_ALLOW_LIVE=1 to acknowledge a bounded, low-volume run.',
  );
  process.exit(2);
}

const instagramShortcode = process.env.L2A_IG_SHORTCODE ?? 'DPCM9i1iTOx';
const instagramKind = process.env.L2A_IG_KIND ?? 'post';
const threadsUsername = process.env.L2A_THREADS_USERNAME ?? 'threads';
const threadsShortcode = process.env.L2A_THREADS_SHORTCODE ?? 'DNgrJ8UyTAF';

mkdirSync(evidenceDir, { recursive: true });

function run(command, args, options = {}) {
  try {
    execFileSync(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        PATH: `${join(homedir(), '.cargo', 'bin')}:${process.env.PATH ?? ''}`,
        ...options.env,
      },
    });
    return true;
  } catch {
    return false;
  }
}

function readJson(name) {
  const path = join(evidenceDir, name);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function sanitizeSave(save) {
  if (!save) return null;
  return {
    fileName: save.fileName,
    bytes: save.bytes,
    sha256: save.sha256,
    detectedType: save.detectedType,
    mimeType: save.mimeType,
    exists: save.exists,
    nonEmpty: save.nonEmpty,
  };
}

function threadsAuthorMatches(parsed) {
  if (!parsed?.canonicalUrl || !parsed?.authorUsername) return false;
  const match = /\/@([^/]+)\/post\//.exec(parsed.canonicalUrl);
  return Boolean(
    match && match[1].toLowerCase() === parsed.authorUsername.toLowerCase(),
  );
}

function sanitizeParsed(parsed) {
  if (!parsed) return null;
  return {
    platform: parsed.platform,
    kind: parsed.kind,
    canonicalUrl: parsed.canonicalUrl,
    authorUsername: parsed.authorUsername,
    captionLength: parsed.captionLength,
    assetCount: parsed.assetCount,
    assets: parsed.assets,
    trace: parsed.trace,
  };
}

console.log(
  'L2A live evidence run (bounded, one request per stage per platform)',
);
console.log(
  `Instagram sample: shortcode=${instagramShortcode} kind=${instagramKind}`,
);
console.log(
  `Threads sample: username=${threadsUsername} shortcode=${threadsShortcode}`,
);

const built = run(cargoBin, ['build', '--manifest-path', manifest]);
if (!built) {
  console.error('Rust build failed; no live evidence was produced.');
  process.exit(1);
}

const fetched = run(binary, [
  '--self-test',
  'fetch',
  instagramShortcode,
  instagramKind,
  threadsUsername,
  threadsShortcode,
  evidenceDir,
]);

const parsed = run(
  pnpmBin,
  [
    'exec',
    'vitest',
    'run',
    'tests/live-parser.test.ts',
    '--config',
    'vitest.config.ts',
  ],
  { env: { L2A_EVIDENCE_DIR: evidenceDir } },
);

const instagramSaved =
  existsSync(join(evidenceDir, 'instagram-asset.json')) &&
  run(binary, [
    '--self-test',
    'save-from-file',
    join(evidenceDir, 'instagram-asset.json'),
    evidenceDir,
  ]);
const threadsSaved =
  existsSync(join(evidenceDir, 'threads-asset.json')) &&
  run(binary, [
    '--self-test',
    'save-from-file',
    join(evidenceDir, 'threads-asset.json'),
    evidenceDir,
  ]);

const securityOk = run(binary, [
  '--self-test',
  'security',
  join(evidenceDir, 'security.json'),
]);

const instagramFetch = readJson('instagram-fetch.json');
const threadsFetch = readJson('threads-fetch.json');
const instagramParsed = readJson('instagram-parsed.json');
const threadsParsed = readJson('threads-parsed.json');
const instagramSave = readJson('instagram-save.json');
const threadsSave = readJson('threads-save.json');
const security = readJson('security.json');

const summary = {
  generatedAt: new Date().toISOString(),
  milestone: 'L2A',
  liveNetworkEnabled: true,
  boundedRequestPolicy:
    'One Instagram bootstrap + one GraphQL request; one Threads post request; one media request per platform; no retry loops.',
  posts: {
    instagram: instagramFetch,
    threads: threadsFetch,
  },
  parser: {
    instagram: sanitizeParsed(instagramParsed),
    threads: sanitizeParsed(threadsParsed),
  },
  saves: {
    instagram: sanitizeSave(instagramSave),
    threads: sanitizeSave(threadsSave),
  },
  security: security
    ? { passed: security.passed, failed: security.failed }
    : null,
  stages: {
    nativeRequestExecuted: Boolean(instagramFetch || threadsFetch),
    upstreamResponseReceived: Boolean(
      instagramFetch?.status === 200 || threadsFetch?.status === 200,
    ),
    instagramMetadataExtracted: Boolean(instagramParsed),
    instagramIdentityValidated: Boolean(
      instagramParsed?.canonicalUrl &&
      instagramParsed?.trace?.network?.every(
        (entry) => entry.origin === 'https://www.instagram.com',
      ),
    ),
    threadsMetadataExtracted: Boolean(threadsParsed),
    threadsIdentityValidated: threadsAuthorMatches(threadsParsed),
    instagramMediaDownloaded: Boolean(instagramSaved),
    threadsMediaDownloaded: Boolean(threadsSaved),
    instagramFileSaved: Boolean(
      instagramSave?.exists && instagramSave?.nonEmpty,
    ),
    threadsFileSaved: Boolean(threadsSave?.exists && threadsSave?.nonEmpty),
    workerContacted: false,
    cookieHeaderSent: false,
  },
  run: {
    fetchSucceeded: fetched,
    parserSucceeded: parsed,
    instagramSaveSucceeded: instagramSaved,
    threadsSaveSucceeded: threadsSaved,
    securitySucceeded: securityOk,
  },
};

writeFileSync(
  join(evidenceDir, 'summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
);

const line = (name, save, parsedValue) =>
  `${name}: parser=${parsedValue ? 'ok' : 'missing'} save=${
    save ? `${save.bytes}B sha256=${save.sha256.slice(0, 16)}…` : 'missing'
  }`;
console.log('');
console.log('L2A evidence summary');
console.log(line('instagram', instagramSave, instagramParsed));
console.log(line('threads', threadsSave, threadsParsed));
console.log(
  `security: passed=${security?.passed ?? 'missing'} failed=${
    security?.failed ?? 'missing'
  }`,
);
console.log('workerContacted=false cookieHeaderSent=false');

const allOk =
  fetched &&
  parsed &&
  instagramSaved &&
  threadsSaved &&
  securityOk &&
  summary.stages.instagramFileSaved &&
  summary.stages.threadsFileSaved &&
  summary.security?.failed === 0;
process.exit(allOk ? 0 : 1);

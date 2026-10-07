import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(dir, 'dist');

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const shared = {
  bundle: true,
  platform: 'browser',
  target: ['chrome120'],
  format: 'esm',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
};

await build({
  ...shared,
  entryPoints: [path.join(dir, 'src/background.ts')],
  outfile: path.join(outdir, 'background.js'),
});

await build({
  ...shared,
  entryPoints: [path.join(dir, 'src/popup.ts')],
  outfile: path.join(outdir, 'popup.js'),
});

await cp(path.join(dir, 'manifest.json'), path.join(outdir, 'manifest.json'));
await cp(path.join(dir, 'popup.html'), path.join(outdir, 'popup.html'));

process.stdout.write(
  `UniFetch M8A extension built to ${path.relative(process.cwd(), outdir)}\n`,
);

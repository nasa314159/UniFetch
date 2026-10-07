import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(srcDir).filter(
  (name) =>
    name.endsWith('.ts') &&
    !name.endsWith('.test.ts') &&
    !name.endsWith('.d.ts'),
);

// These tokens must never appear in shipped extension source. Test files are
// excluded because they intentionally use them as fixtures.
const forbidden = [
  'document.cookie',
  'chrome.cookies',
  'browser.cookies',
  'sessionid',
  '<all_urls>',
  'workers.dev',
  'chrome.storage',
  'localStorage',
  'indexedDB',
  '/api/resolve',
];

const joined = sources
  .map((name) => readFileSync(path.join(srcDir, name), 'utf8'))
  .join('\n');

describe('M8A privacy and boundary scan', () => {
  it('scans the shipped source modules', () => {
    expect(sources.length).toBeGreaterThanOrEqual(8);
  });
  it.each(forbidden)('never contains the forbidden token %s', (token) => {
    expect(joined).not.toContain(token);
  });
  it('does not add credential or session persistence', () => {
    for (const token of ['setItem', 'storage.local', 'storage.session'])
      expect(joined).not.toContain(token);
  });
});

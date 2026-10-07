import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Manifest {
  permissions?: string[];
  host_permissions?: string[];
  background?: { service_worker?: string; type?: string };
}

const manifest = JSON.parse(
  readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'),
) as Manifest;

describe('M8A extension manifest', () => {
  it('requests only the intended permissions', () => {
    expect([...(manifest.permissions ?? [])].sort()).toEqual([
      'activeTab',
      'scripting',
    ]);
  });
  it('does not request the cookies permission', () => {
    expect(manifest.permissions ?? []).not.toContain('cookies');
    expect(JSON.stringify(manifest)).not.toContain('cookies');
  });
  it('does not request <all_urls> or broad hosts', () => {
    expect(JSON.stringify(manifest)).not.toContain('<all_urls>');
    expect(manifest.host_permissions).toEqual(['https://www.instagram.com/*']);
  });
  it('does not request history, tabs or a webRequest permission', () => {
    const permissions = manifest.permissions ?? [];
    for (const name of ['history', 'tabs', 'webRequest', 'storage']) {
      expect(permissions).not.toContain(name);
    }
  });
  it('uses a module service worker built from background.js', () => {
    expect(manifest.background).toEqual({
      service_worker: 'background.js',
      type: 'module',
    });
  });
});

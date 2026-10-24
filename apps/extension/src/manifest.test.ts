import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Manifest {
  name?: string;
  version?: string;
  permissions?: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
  background?: { service_worker?: string; type?: string };
}

const manifest = JSON.parse(
  readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'),
) as Manifest;

describe('UniFetch extension manifest', () => {
  it('is versioned as the Threads release candidate', () => {
    expect(manifest.name).toBe('UniFetch');
    expect(manifest.version).toBe('0.3.0');
  });
  it('requests only the intended required permissions', () => {
    expect([...(manifest.permissions ?? [])].sort()).toEqual([
      'activeTab',
      'clipboardRead',
      'declarativeNetRequestWithHostAccess',
      'scripting',
    ]);
  });
  it('does not request the cookies permission', () => {
    expect(manifest.permissions ?? []).not.toContain('cookies');
    expect(JSON.stringify(manifest)).not.toContain('"cookies"');
  });
  it('keeps Instagram required and Threads optional', () => {
    expect(manifest.host_permissions).toEqual(['https://www.instagram.com/*']);
    expect(manifest.optional_host_permissions).toEqual([
      'https://www.threads.com/*',
    ]);
  });
  it('does not request <all_urls> or broad hosts', () => {
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain('<all_urls>');
    expect(serialized).not.toContain('https://*/*');
    expect(serialized).not.toContain('http://*/*');
    expect(serialized).not.toContain('threads.net');
  });
  it('does not request history, tabs or a webRequest permission', () => {
    const permissions = manifest.permissions ?? [];
    for (const name of ['history', 'tabs', 'webRequest', 'storage']) {
      expect(permissions).not.toContain(name);
    }
  });
  it('requests only the host-scoped header modification API', () => {
    const permissions = manifest.permissions ?? [];
    expect(permissions).toContain('declarativeNetRequestWithHostAccess');
    expect(permissions).not.toContain('declarativeNetRequest');
    expect(permissions).not.toContain('webRequest');
  });
  it('requests only the minimal clipboard capability for explicit paste', () => {
    const permissions = manifest.permissions ?? [];
    expect(permissions).toContain('clipboardRead');
    expect(permissions).not.toContain('clipboardWrite');
  });
  it('uses a module service worker built from background.js', () => {
    expect(manifest.background).toEqual({
      service_worker: 'background.js',
      type: 'module',
    });
  });
});

import { describe, expect, it } from 'vitest';
import config from '../vite.config.ts?raw';

describe('PWA update delivery', () => {
  it('auto-activates a new service worker instead of pinning an old shell', () => {
    expect(config).toContain("registerType: 'autoUpdate'");
    expect(config).not.toContain("registerType: 'prompt'");
  });
});

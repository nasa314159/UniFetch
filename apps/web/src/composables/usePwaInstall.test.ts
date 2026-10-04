import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import {
  createPwaInstall,
  isIosSafari,
  usePwaInstall,
  type InstallEnvironment,
} from './usePwaInstall';
const disposals: Array<() => void> = [];
afterEach(() => {
  disposals.splice(0).forEach((dispose) => dispose());
  vi.unstubAllGlobals();
});
function setup({ standalone = false, legacy = false, ios = false } = {}) {
  const events = new EventTarget();
  const media = new EventTarget() as EventTarget & { matches: boolean };
  media.matches = standalone;
  const env: InstallEnvironment = {
    events,
    displayMode: media as unknown as InstallEnvironment['displayMode'],
    legacyStandalone: () => legacy,
    iosSafari: ios,
  };
  const controller = createPwaInstall(env);
  disposals.push(controller.dispose);
  return { ...controller, events, media };
}
function promptEvent(outcome: 'accepted' | 'dismissed' = 'dismissed') {
  return Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome }),
  });
}
describe('Explicit PWA install states', () => {
  it('hides Install in standalone display mode', async () => {
    const c = setup({ standalone: true });
    expect(c.state.value).toBe('standalone');
    expect(c.showInstallAction.value).toBe(false);
    await c.install();
    expect(c.showInstructions.value).toBe(false);
  });
  it('hides Install for legacy iOS standalone', () => {
    const c = setup({ legacy: true, ios: true });
    expect(c.isStandalone.value).toBe(true);
    expect(c.showInstallAction.value).toBe(false);
  });
  it('captures a native prompt and exposes Install', () => {
    const c = setup();
    const event = promptEvent();
    c.events.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(c.state.value).toBe('native-prompt-available');
    expect(c.canNativePrompt.value).toBe(true);
    expect(c.showInstallAction.value).toBe(true);
    expect(event.prompt).not.toHaveBeenCalled();
  });
  it('invokes the native prompt only after explicit Install and consumes stale events', async () => {
    const c = setup();
    const event = promptEvent();
    c.events.dispatchEvent(event);
    await c.install();
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(c.canNativePrompt.value).toBe(false);
    expect(c.showInstructions.value).toBe(false);
    await c.install();
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(c.showInstructions.value).toBe(true);
  });
  it('does not equate prompt acceptance with confirmed installation', async () => {
    const c = setup();
    c.events.dispatchEvent(promptEvent('accepted'));
    await c.install();
    expect(c.showInstallAction.value).toBe(true);
    expect(c.isStandalone.value).toBe(false);
  });
  it('updates on appinstalled and suppresses redundant instructions', async () => {
    const c = setup();
    await c.install();
    c.events.dispatchEvent(new Event('appinstalled'));
    expect(c.state.value).toBe('installed');
    expect(c.showInstallAction.value).toBe(false);
    expect(c.showInstructions.value).toBe(false);
    await c.install();
    expect(c.showInstructions.value).toBe(false);
  });
  it('keeps Install visible in iOS Safari and opens manual instructions', async () => {
    const c = setup({ ios: true });
    expect(c.state.value).toBe('ios-manual');
    expect(c.requiresIosInstructions.value).toBe(true);
    expect(c.showInstallAction.value).toBe(true);
    await c.install();
    expect(c.showInstructions.value).toBe(true);
    c.dismissInstructions();
    expect(c.showInstructions.value).toBe(false);
  });
  it('offers generic guidance without beforeinstallprompt', async () => {
    const c = setup();
    expect(c.state.value).toBe('manual');
    expect(c.showInstallAction.value).toBe(true);
    await c.install();
    expect(c.showInstructions.value).toBe(true);
    expect(c.requiresIosInstructions.value).toBe(false);
  });
  it('updates on display-mode changes and closes manual guidance', async () => {
    const c = setup();
    await c.install();
    c.media.matches = true;
    c.media.dispatchEvent(new Event('change'));
    expect(c.state.value).toBe('standalone');
    expect(c.showInstructions.value).toBe(false);
    c.media.matches = false;
    c.media.dispatchEvent(new Event('change'));
    expect(c.showInstallAction.value).toBe(true);
  });
  it('ignores prompt events in installed mode', () => {
    const c = setup({ standalone: true });
    const event = promptEvent();
    c.events.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(c.canNativePrompt.value).toBe(false);
  });
  it('falls back truthfully when native prompting fails', async () => {
    const c = setup();
    const event = promptEvent();
    event.prompt.mockRejectedValue(new Error('Unavailable'));
    c.events.dispatchEvent(event);
    await c.install();
    expect(c.showInstructions.value).toBe(true);
    expect(c.showInstallAction.value).toBe(true);
    expect(c.prompting.value).toBe(false);
  });
  it('supports prompt events without userChoice', async () => {
    const c = setup();
    const event = Object.assign(new Event('beforeinstallprompt'), {
      prompt: vi.fn().mockResolvedValue(undefined),
    });
    c.events.dispatchEvent(event);
    await c.install();
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(c.canNativePrompt.value).toBe(false);
  });
  it('prevents concurrent native prompts', async () => {
    const c = setup();
    let finish!: () => void;
    const event = promptEvent();
    event.prompt.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    c.events.dispatchEvent(event);
    const pending = c.install();
    await c.install();
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(c.showInstructions.value).toBe(false);
    finish();
    await pending;
  });
  it('removes event listeners and transient events on disposal', () => {
    const c = setup();
    c.events.dispatchEvent(promptEvent());
    c.dispose();
    c.events.dispatchEvent(promptEvent());
    c.events.dispatchEvent(new Event('appinstalled'));
    expect(c.canNativePrompt.value).toBe(false);
    expect(c.showInstallAction.value).toBe(true);
  });
  it('keeps an entry point when capabilities are unknown', async () => {
    const c = createPwaInstall();
    expect(c.state.value).toBe('unknown');
    expect(c.showInstallAction.value).toBe(true);
    await c.install();
    expect(c.showInstructions.value).toBe(true);
  });
  it('detects iPad desktop Safari with touch capability without storing device data', () => {
    expect(
      isIosSafari({
        userAgent: 'Macintosh Version/17 Safari/605',
        maxTouchPoints: 5,
      }),
    ).toBe(true);
    expect(
      isIosSafari({
        userAgent: 'Macintosh Version/17 Safari/605',
        maxTouchPoints: 0,
      }),
    ).toBe(false);
    expect(
      isIosSafari({
        userAgent: 'iPhone CriOS/123 Safari/605',
        maxTouchPoints: 5,
      }),
    ).toBe(false);
  });
  it('cleans up composable listeners with its Vue scope', () => {
    const events = new EventTarget();
    const remove = vi.spyOn(events, 'removeEventListener');
    const media = new EventTarget() as EventTarget & { matches: boolean };
    media.matches = false;
    vi.stubGlobal(
      'window',
      Object.assign(events, { matchMedia: vi.fn(() => media) }),
    );
    vi.stubGlobal('navigator', {
      userAgent: 'iPhone Version/17 Safari/605',
      maxTouchPoints: 5,
      standalone: false,
    });
    const scope = effectScope();
    const c = scope.run(() => usePwaInstall())!;
    expect(window.matchMedia).toHaveBeenCalledWith(
      '(display-mode: standalone)',
    );
    expect(c.requiresIosInstructions.value).toBe(true);
    scope.stop();
    expect(remove).toHaveBeenCalledWith(
      'beforeinstallprompt',
      expect.any(Function),
    );
    expect(remove).toHaveBeenCalledWith('appinstalled', expect.any(Function));
  });
});

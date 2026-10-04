import { computed, onScopeDispose, ref, shallowRef } from 'vue';

export type InstallState =
  | 'standalone'
  | 'installed'
  | 'native-prompt-available'
  | 'ios-manual'
  | 'manual'
  | 'unknown';
interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
export interface InstallEnvironment {
  events: EventTarget;
  displayMode: Pick<
    MediaQueryList,
    'matches' | 'addEventListener' | 'removeEventListener'
  >;
  legacyStandalone(): boolean;
  iosSafari: boolean;
}

/** Local UI classification only: no platform/UA data is stored or transmitted. */
export function isIosDevice(
  navigator: Pick<Navigator, 'userAgent' | 'maxTouchPoints'>,
): boolean {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}
export function isIosSafari(
  navigator: Pick<Navigator, 'userAgent' | 'maxTouchPoints'>,
): boolean {
  const ua = navigator.userAgent;
  return (
    isIosDevice(navigator) &&
    /Safari/.test(ua) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua)
  );
}

export function createPwaInstall(environment?: InstallEnvironment) {
  const standalone = ref(
    environment?.displayMode.matches === true ||
      environment?.legacyStandalone() === true,
  );
  const installedThisSession = ref(false);
  const promptEvent = shallowRef<InstallPromptEvent | null>(null);
  const showInstructions = ref(false);
  const prompting = ref(false);
  const isStandalone = computed(() => standalone.value);
  const showInstallAction = computed(
    () => !standalone.value && !installedThisSession.value,
  );
  const canNativePrompt = computed(
    () => showInstallAction.value && promptEvent.value !== null,
  );
  const requiresIosInstructions = computed(
    () =>
      showInstallAction.value &&
      !!environment?.iosSafari &&
      !canNativePrompt.value,
  );
  const state = computed<InstallState>(() => {
    if (isStandalone.value) return 'standalone';
    if (installedThisSession.value) return 'installed';
    if (canNativePrompt.value) return 'native-prompt-available';
    if (requiresIosInstructions.value) return 'ios-manual';
    return environment ? 'manual' : 'unknown';
  });
  const dismissInstructions = () => {
    showInstructions.value = false;
  };
  const beforeInstall = (event: Event) => {
    if (
      !showInstallAction.value ||
      typeof (event as InstallPromptEvent).prompt !== 'function'
    )
      return;
    event.preventDefault();
    promptEvent.value = event as InstallPromptEvent;
  };
  const appInstalled = () => {
    installedThisSession.value = true;
    promptEvent.value = null;
    dismissInstructions();
  };
  const updateDisplayMode = () => {
    standalone.value =
      environment?.displayMode.matches === true ||
      environment?.legacyStandalone() === true;
    if (standalone.value) {
      promptEvent.value = null;
      dismissInstructions();
    }
  };
  environment?.events.addEventListener('beforeinstallprompt', beforeInstall);
  environment?.events.addEventListener('appinstalled', appInstalled);
  environment?.displayMode.addEventListener('change', updateDisplayMode);

  async function install() {
    if (!showInstallAction.value || prompting.value) return;
    const event = promptEvent.value;
    if (!event) {
      showInstructions.value = true;
      return;
    }
    promptEvent.value = null;
    prompting.value = true;
    try {
      await event.prompt();
      await event.userChoice;
      // Acceptance is not proof of installation. Only appinstalled/display-mode changes confirm it.
    } catch {
      if (showInstallAction.value) showInstructions.value = true;
    } finally {
      prompting.value = false;
    }
  }
  function dispose() {
    environment?.events.removeEventListener(
      'beforeinstallprompt',
      beforeInstall,
    );
    environment?.events.removeEventListener('appinstalled', appInstalled);
    environment?.displayMode.removeEventListener('change', updateDisplayMode);
    promptEvent.value = null;
  }
  return {
    state,
    isStandalone,
    canNativePrompt,
    requiresIosInstructions,
    showInstallAction,
    showInstructions,
    prompting,
    install,
    dismissInstructions,
    dispose,
  };
}

export function usePwaInstall() {
  const environment: InstallEnvironment | undefined =
    typeof window === 'undefined'
      ? undefined
      : {
          events: window,
          displayMode: window.matchMedia('(display-mode: standalone)'),
          legacyStandalone: () =>
            (navigator as Navigator & { standalone?: boolean }).standalone ===
            true,
          iosSafari: isIosSafari(navigator),
        };
  const install = createPwaInstall(environment);
  onScopeDispose(install.dispose);
  return install;
}

import { downloadLocalAsset } from '@unifetch/downloader';
import {
  createSingleFlight,
  downloadAllCurrentTarget,
  type ResolvedCache,
} from './download-flow';
import {
  isManualTarget,
  parseManualUrl,
  readClipboardText,
  type ManualTarget,
} from './popup-support';
import {
  applyResolveResponse,
  contentTypeLabel,
  runAssetDownloads,
  type ExtensionResolveResponse,
} from './resolve';
import {
  EXTENSION_PROTOCOL_VERSION,
  RELOAD_REQUIRED_MESSAGE,
  RUNTIME_INFO_REQUEST,
  checkRuntimeCompatibility,
  gatedActions,
  type RuntimeCompatibility,
  type RuntimeInfo,
} from './runtime-info';
import { parseExtensionTarget } from './target';
import { ensureThreadsPermission } from './threads/permission';

const resolveButton = document.querySelector<HTMLButtonElement>('#resolve');
const downloadButton = document.querySelector<HTMLButtonElement>('#download');
const pasteButton = document.querySelector<HTMLButtonElement>('#paste');
const urlInput = document.querySelector<HTMLInputElement>('#url-input');
const status = document.querySelector<HTMLParagraphElement>('#status');
const buildMarkerElement =
  document.querySelector<HTMLParagraphElement>('#build');
const list = document.querySelector<HTMLUListElement>('#results');

/** In-memory only: never persisted, never displayed as a URL. */
let resolvedCache: ResolvedCache | undefined;
const downloadGuard = createSingleFlight();

/**
 * Build/protocol handshake state. The popup starts closed (all actions
 * disabled) and only opens once the background reports the same protocol, so a
 * new popup can never send acquisition requests to an old service worker.
 */
let runtimeCompatibility: RuntimeCompatibility = {
  compatible: false,
  label: 'Checking build…',
};

function syncActionAvailability(): void {
  const actions = gatedActions(runtimeCompatibility);
  if (resolveButton) resolveButton.disabled = !actions.resolve;
  if (downloadButton) downloadButton.disabled = !actions.download;
}

function applyRuntimeInfo(info: RuntimeInfo | undefined): void {
  runtimeCompatibility = checkRuntimeCompatibility(
    EXTENSION_PROTOCOL_VERSION,
    info?.protocolVersion,
  );
  if (buildMarkerElement)
    buildMarkerElement.textContent = runtimeCompatibility.label;
  syncActionAvailability();
}

/** Requests the background's runtime identity on popup open. No user data sent. */
async function verifyRuntime(): Promise<void> {
  try {
    const info = (await chrome.runtime.sendMessage({
      type: RUNTIME_INFO_REQUEST,
    })) as RuntimeInfo | undefined;
    applyRuntimeInfo(info);
  } catch {
    applyRuntimeInfo(undefined);
  }
}

async function activeTabId(): Promise<
  { id: number; url?: string } | undefined
> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || typeof tab.id !== 'number') return undefined;
  return { id: tab.id, url: tab.url };
}

/** The validated manual target, or a sanitized rejection, or undefined. */
function manualTarget():
  | { ok: true; target: ManualTarget }
  | { ok: false; error: string }
  | undefined {
  const value = urlInput?.value.trim();
  if (!value) return undefined;
  const parsed = parseManualUrl(value);
  if (!parsed)
    return { ok: false, error: 'Not a supported Instagram or Threads URL.' };
  return { ok: true, target: parsed };
}

interface ActionTarget {
  id: number;
  url?: string;
  manual: boolean;
  platform?: 'instagram' | 'threads';
  /** In-memory identity of the current manual URL or active-tab target. */
  fingerprint: string;
}

async function resolveActionTarget(): Promise<
  ActionTarget | { error: string }
> {
  const target = manualTarget();
  if (target && !target.ok) return { error: target.error };
  const tab = await activeTabId();
  if (!tab) return { error: 'No active tab.' };
  const manual = Boolean(target?.ok) && isManualTarget(urlInput?.value);
  const url = target?.ok ? target.target.canonicalUrl : tab.url;
  const parsed = target?.ok
    ? target.target
    : url
      ? parseExtensionTarget(url)
      : undefined;
  return {
    id: tab.id,
    url,
    manual,
    ...(parsed?.platform ? { platform: parsed.platform } : {}),
    fingerprint: manual ? `manual:${url ?? ''}` : `tab:${tab.id}:${url ?? ''}`,
  };
}

/** Content label used only when a failure response has no contentType. */
function activeTargetLabel(): string {
  const value = urlInput?.value.trim();
  const parsed = value ? parseManualUrl(value) : undefined;
  if (!parsed) return 'Item';
  if (parsed.kind === 'share' || parsed.kind === 'post') return 'Post';
  if (parsed.kind === 'story' || parsed.kind === 'story-profile')
    return 'Story';
  return contentTypeLabel(parsed.kind);
}

/**
 * Starts the optional Threads permission request during the click's user
 * gesture when the manual URL is already known to be Threads. Active-tab
 * detection needs one short tabs.query, after which the caller reuses or
 * requests the same narrow origin.
 */
function earlyThreadsPermission():
  | Promise<{
      granted: boolean;
      requested: boolean;
    }>
  | undefined {
  const value = urlInput?.value.trim();
  const parsed = value ? parseManualUrl(value) : undefined;
  return parsed?.platform === 'threads'
    ? ensureThreadsPermission(chrome.permissions)
    : undefined;
}

/** Returns false only when a Threads target lacks its optional host grant. */
async function authorizeThreads(
  target: ActionTarget,
  early: ReturnType<typeof earlyThreadsPermission>,
): Promise<boolean> {
  if (target.platform !== 'threads') return true;
  const result = early
    ? await early
    : await ensureThreadsPermission(chrome.permissions);
  return result.granted;
}

// A changed manual input invalidates any cached assets for the old target.
urlInput?.addEventListener('input', () => {
  resolvedCache = undefined;
});

pasteButton?.addEventListener('click', async () => {
  if (!pasteButton || !status) return;
  pasteButton.disabled = true;
  try {
    const text = await readClipboardText(navigator.clipboard);
    if (!text || !urlInput) {
      status.textContent = 'Clipboard unavailable';
      return;
    }
    urlInput.value = text.trim();
    resolvedCache = undefined;
    status.textContent = 'URL pasted.';
  } catch {
    status.textContent = 'Clipboard unavailable';
  } finally {
    pasteButton.disabled = false;
  }
});

/** Optional diagnostic/preview: resolve the current target and cache its assets. */
resolveButton?.addEventListener('click', async () => {
  if (!resolveButton || !status || !list) return;
  if (!runtimeCompatibility.compatible) {
    status.textContent = RELOAD_REQUIRED_MESSAGE;
    return;
  }
  resolveButton.disabled = true;
  if (downloadButton) downloadButton.disabled = true;
  resolvedCache = undefined;
  list.replaceChildren();
  status.textContent = 'Resolving locally…';
  const fallbackLabel = activeTargetLabel();
  const earlyPermission = earlyThreadsPermission();
  try {
    const target = await resolveActionTarget();
    if ('error' in target) {
      status.textContent = `Rejected: ${target.error}`;
      return;
    }
    if (!(await authorizeThreads(target, earlyPermission))) {
      status.textContent = applyResolveResponse(
        {
          ok: false,
          platform: 'threads',
          contentType: 'post',
          error: 'PERMISSION_REQUIRED',
        },
        fallbackLabel,
      ).message;
      return;
    }
    const response = (await chrome.runtime.sendMessage({
      type: 'UNIFETCH_RESOLVE',
      tabId: target.id,
      url: target.url,
      manual: target.manual,
    })) as ExtensionResolveResponse | undefined;
    const next = applyResolveResponse(response, fallbackLabel);
    resolvedCache =
      next.downloadEnabled && next.contentType
        ? {
            fingerprint: target.fingerprint,
            contentType: next.contentType,
            ...(next.platform ? { platform: next.platform } : {}),
            assets: next.assets,
          }
        : undefined;
    status.textContent = next.message;
  } catch {
    resolvedCache = undefined;
    status.textContent = applyResolveResponse(undefined, fallbackLabel).message;
  } finally {
    syncActionAvailability();
  }
});

/**
 * Download all: reuse matching cached assets, otherwise resolve the current
 * target first and download immediately on success. A single-flight guard
 * prevents duplicate concurrent runs.
 */
downloadButton?.addEventListener('click', () => {
  void downloadGuard.run(async () => {
    if (!downloadButton || !status) return;
    if (!runtimeCompatibility.compatible) {
      status.textContent = RELOAD_REQUIRED_MESSAGE;
      return;
    }
    downloadButton.disabled = true;
    status.textContent = 'Resolving…';
    const earlyPermission = earlyThreadsPermission();
    try {
      const target = await resolveActionTarget();
      if ('error' in target) {
        status.textContent = `Rejected: ${target.error}`;
        return;
      }
      if (!(await authorizeThreads(target, earlyPermission))) {
        status.textContent = applyResolveResponse(
          {
            ok: false,
            platform: 'threads',
            contentType: 'post',
            error: 'PERMISSION_REQUIRED',
          },
          activeTargetLabel(),
        ).message;
        return;
      }
      const outcome = await downloadAllCurrentTarget({
        cache: resolvedCache,
        fingerprint: target.fingerprint,
        fallbackLabel: activeTargetLabel(),
        resolve: () =>
          chrome.runtime.sendMessage({
            type: 'UNIFETCH_RESOLVE',
            tabId: target.id,
            url: target.url,
            manual: target.manual,
          }),
        download: (assets) =>
          runAssetDownloads(assets, (asset) => downloadLocalAsset(asset)),
      });
      resolvedCache = outcome.cache;
      status.textContent = outcome.message;
    } catch {
      status.textContent = 'Item failed · UNKNOWN';
    } finally {
      syncActionAvailability();
    }
  });
});

// Start closed, then open only when the background confirms the same protocol.
syncActionAvailability();
void verifyRuntime();

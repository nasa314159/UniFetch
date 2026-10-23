import { asUniFetchError } from '@unifetch/core';
import { downloadLocalAsset } from '@unifetch/downloader';
import type { AuthenticatedStrategyResult } from './contracts';
import {
  createSingleFlight,
  downloadAllCurrentTarget,
  type ResolvedCache,
} from './download-flow';
import {
  isManualTarget,
  parseManualInstagramUrl,
  readClipboardText,
} from './popup-support';
import type { PreflightDiagnostic } from './preflight';
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
import type { StoryFeasibilityResult } from './story/contracts';
import { storyFeasibilityDiagnostic } from './story/diagnostic';

const runButton = document.querySelector<HTMLButtonElement>('#run');
const storyButton = document.querySelector<HTMLButtonElement>('#run-story');
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

function describeDiagnostic(diagnostic: PreflightDiagnostic): string {
  const parts = [
    `host=${diagnostic.hostname ?? 'n/a'}`,
    `path=${diagnostic.pathCategory}`,
    `urlObtained=${diagnostic.urlObtained}`,
    `source=${diagnostic.source}`,
  ];
  if (diagnostic.idSource) parts.push(`idSource=${diagnostic.idSource}`);
  return parts.join(' · ');
}

function describe(result: AuthenticatedStrategyResult): string {
  const parts: string[] = [result.status];
  if (result.httpStatus !== undefined) parts.push(`HTTP ${result.httpStatus}`);
  if (result.responseKind) parts.push(result.responseKind);
  if (result.assetCount !== undefined)
    parts.push(`${result.assetCount} asset(s)`);
  if (result.assetTypes?.length) parts.push(result.assetTypes.join('/'));
  return `${result.strategy}: ${parts.join(' · ')}`;
}

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
  if (runButton) runButton.disabled = !actions.run;
  if (storyButton) storyButton.disabled = !actions['run-story'];
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
  { ok: true; url: string } | { ok: false; error: string } | undefined {
  const value = urlInput?.value.trim();
  if (!value) return undefined;
  const parsed = parseManualInstagramUrl(value);
  if (!parsed) return { ok: false, error: 'Not a supported Instagram URL.' };
  return { ok: true, url: parsed.canonicalUrl };
}

interface ActionTarget {
  id: number;
  url?: string;
  manual: boolean;
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
  const url = target?.ok ? target.url : tab.url;
  return {
    id: tab.id,
    url,
    manual,
    fingerprint: manual ? `manual:${url ?? ''}` : `tab:${tab.id}:${url ?? ''}`,
  };
}

/** Content label used only when a failure response has no contentType. */
function activeTargetLabel(): string {
  const value = urlInput?.value.trim();
  const parsed = value ? parseManualInstagramUrl(value) : undefined;
  if (!parsed) return 'Item';
  return contentTypeLabel(
    parsed.kind === 'story-profile' ? 'story' : parsed.kind,
  );
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

/**
 * Optional diagnostic/preview: resolve the current target and cache its assets.
 * No longer a prerequisite for Download all.
 */
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
  try {
    const target = await resolveActionTarget();
    if ('error' in target) {
      status.textContent = `Rejected: ${target.error}`;
      return;
    }
    const response = (await chrome.runtime.sendMessage({
      type: 'UNIFETCH_M8D_RESOLVE',
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
            assets: next.assets,
          }
        : undefined;
    status.textContent = next.message;
  } catch {
    resolvedCache = undefined;
    status.textContent = applyResolveResponse(undefined, fallbackLabel).message;
  } finally {
    // Download all stays enabled by default and is never gated on Resolve.
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
    try {
      const target = await resolveActionTarget();
      if ('error' in target) {
        status.textContent = `Rejected: ${target.error}`;
        return;
      }
      const outcome = await downloadAllCurrentTarget({
        cache: resolvedCache,
        fingerprint: target.fingerprint,
        fallbackLabel: activeTargetLabel(),
        resolve: () =>
          chrome.runtime.sendMessage({
            type: 'UNIFETCH_M8D_RESOLVE',
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

runButton?.addEventListener('click', async () => {
  if (!runButton || !status || !list) return;
  if (!runtimeCompatibility.compatible) {
    status.textContent = RELOAD_REQUIRED_MESSAGE;
    return;
  }
  runButton.disabled = true;
  list.replaceChildren();
  status.textContent = 'Running the three strategies…';
  try {
    const target = await resolveActionTarget();
    if ('error' in target) {
      status.textContent = `Rejected: ${target.error}`;
      return;
    }
    const response = (await chrome.runtime.sendMessage({
      type: 'UNIFETCH_M8A_RUN',
      tabId: target.id,
      url: target.url,
      manual: target.manual,
    })) as
      | { ok: true; results: AuthenticatedStrategyResult[] }
      | { ok: false; error: string; diagnostic?: PreflightDiagnostic }
      | undefined;
    if (!response || !response.ok) {
      const detail =
        response && !response.ok && response.diagnostic
          ? ` · ${describeDiagnostic(response.diagnostic)}`
          : '';
      status.textContent = `Rejected: ${
        response && !response.ok && response.error
          ? response.error
          : 'not an Instagram post or Reel'
      }${detail}`;
      return;
    }
    status.textContent = 'Sanitized results only:';
    for (const result of response.results) {
      const item = document.createElement('li');
      item.textContent = describe(result);
      list.append(item);
    }
  } catch (error) {
    status.textContent = `Item failed · ${asUniFetchError(error).code}`;
  } finally {
    syncActionAvailability();
  }
});

storyButton?.addEventListener('click', async () => {
  if (!storyButton || !status || !list) return;
  if (!runtimeCompatibility.compatible) {
    status.textContent = RELOAD_REQUIRED_MESSAGE;
    return;
  }
  storyButton.disabled = true;
  list.replaceChildren();
  status.textContent = 'Running Story feasibility (background)…';
  try {
    const target = await resolveActionTarget();
    if ('error' in target) {
      status.textContent = `Rejected: ${target.error}`;
      return;
    }
    const response = (await chrome.runtime.sendMessage({
      type: 'UNIFETCH_M8B_STORY',
      tabId: target.id,
      url: target.url,
      manual: target.manual,
    })) as
      | { ok: true; result: StoryFeasibilityResult }
      | { ok: false; error: string; diagnostic?: PreflightDiagnostic }
      | undefined;
    if (!response || !response.ok) {
      const detail =
        response && !response.ok && response.diagnostic
          ? ` · ${describeDiagnostic(response.diagnostic)}`
          : '';
      status.textContent = `Rejected: ${
        response && !response.ok && response.error
          ? response.error
          : 'not an explicit Instagram Story'
      }${detail}`;
      return;
    }
    status.textContent = 'Sanitized Story result only:';
    const item = document.createElement('li');
    item.textContent = storyFeasibilityDiagnostic(response.result);
    list.append(item);
  } catch (error) {
    status.textContent = `Story failed · ${asUniFetchError(error).code}`;
  } finally {
    syncActionAvailability();
  }
});

// Start closed, then open only when the background confirms the same protocol.
syncActionAvailability();
void verifyRuntime();

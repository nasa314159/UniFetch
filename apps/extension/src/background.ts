import { parseSupportedUrl, type MediaAsset } from '@unifetch/core';
import type { InstagramContentRef } from '@unifetch/meta-resolver/instagram';
import { validateInjectedOutcome } from './bridge';
import { classifyStrategyOutcome, resolveStrategyOutcome } from './classify';
import type {
  AuthenticatedStrategy,
  AuthenticatedStrategyResult,
  AuthenticatedStrategyStatus,
  InjectedRequestInput,
} from './contracts';
import { authenticatedRequestFunction } from './injected';
import { runStrategyMatrix } from './orchestrate';
import type { PreflightDiagnostic, UrlCandidate } from './preflight';
import { describeUrl, resolveContentRef } from './preflight';
import { buildStrategyRequest } from './request';
import type {
  ExtensionContentType,
  ExtensionResolveResponse,
  ResolveErrorCode,
} from './resolve';
import { resolveErrorCodeFromStatus } from './resolve';
import { prepareCsrfContext, runBackgroundFetch } from './strategy';
import { resolveStoryOutcome, resolveStoryIdentity } from './story/classify';
import type { StoryFeasibilityResult, StorySource } from './story/contracts';
import {
  currentStoryIdScanFunction,
  matchOwner,
  resolveCurrentStoryId,
  type CurrentStoryIdScan,
  type StoryIdResolution,
} from './story/current-id';
import {
  storyIndexFromSegments,
  type StoryFilenameMetadata,
} from './story/filename';
import type { InstagramProfileStoryRef, InstagramStoryRef } from './story/ref';
import {
  parseInstagramProfileStoryRef,
  parseInstagramStoryRef,
} from './story/ref';
import { buildInstagramStoryRequest } from './story/request';
import {
  chooseStorySource,
  classifyVisibleMedia,
  collectStoryViewerContextFunction,
  selectVisibleStoryMedia,
  visibleStoryMediaToAsset,
  visibleStoryResult,
  type StoryViewerContext,
} from './story/visible-media';
import { isRuntimeInfoRequest, runtimeInfo } from './runtime-info';
import { firstInstagramTarget } from './target';

interface RunSuccess {
  ok: true;
  results: AuthenticatedStrategyResult[];
}

interface RunFailure {
  ok: false;
  error: string;
  diagnostic: PreflightDiagnostic;
}

interface StorySuccess {
  ok: true;
  result: StoryFeasibilityResult;
  /** Present only on SUCCESS with exactly one current item. */
  asset?: MediaAsset;
}

function firstStoryRef(
  urls: readonly (string | undefined)[],
): InstagramStoryRef | undefined {
  for (const url of urls) {
    if (!url) continue;
    try {
      return parseInstagramStoryRef(url);
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

function firstProfileStoryRef(
  urls: readonly (string | undefined)[],
): InstagramProfileStoryRef | undefined {
  for (const url of urls) {
    if (!url) continue;
    try {
      return parseInstagramProfileStoryRef(url);
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

/** Reads the current Story id scan from already-loaded page state. */
async function readCurrentStoryIdScan(
  tabId: number,
  routeUsername?: string,
): Promise<CurrentStoryIdScan | undefined> {
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      func: currentStoryIdScanFunction,
      args: [routeUsername],
      world: 'MAIN',
    });
    return injected[0]?.result;
  } catch {
    return undefined;
  }
}

/** Sanitized active-root diagnostics; never an id, username or URL. */
function scanDiagnostic(scan: CurrentStoryIdScan | undefined) {
  if (!scan) return {};
  return {
    ...(scan.activeRoot ? { activeRoot: scan.activeRoot } : {}),
    ...(scan.candidateInsideActiveRoot !== undefined
      ? { candidateInsideActiveRoot: scan.candidateInsideActiveRoot }
      : {}),
    ...(scan.routeOwnerMatch !== undefined
      ? { routeOwnerMatch: scan.routeOwnerMatch }
      : {}),
    ...(scan.sourceDiagnostics?.length
      ? { idEvidence: scan.sourceDiagnostics }
      : {}),
    ...(scan.identitySources && Object.keys(scan.identitySources).length
      ? { identitySources: scan.identitySources }
      : {}),
  };
}

/**
 * M8D Story resolution. An explicit Story id URL is unchanged. When Instagram
 * exposes only `/stories/<username>/`, the current item id is extracted from
 * already-loaded page state (URL query, history state, inline JSON, visible
 * element attributes) and fed into the EXISTING explicit-id API path. Only if
 * no id can be extracted does the emergency visible-media fallback run. Nothing
 * is enumerated and the id is in-memory only.
 */
async function resolveCurrentStory(
  tabId: number,
  tabUrl: string | undefined,
  manual = false,
): Promise<StorySuccess | RunFailure> {
  const candidates: UrlCandidate[] = [];
  let source: UrlCandidate['source'] = manual ? 'manual' : 'tab-url';
  if (manual) {
    if (tabUrl) candidates.push({ url: tabUrl, source: 'manual' });
  } else {
    const location = await readTabLocation(tabId);
    if (location)
      candidates.push({ url: location, source: 'scripting-location' });
    if (tabUrl) candidates.push({ url: tabUrl, source: 'tab-url' });
    source = location ? 'scripting-location' : 'tab-url';
  }
  let ref = firstStoryRef(candidates.map((candidate) => candidate.url));
  let storySource: StorySource = 'explicit-id-url';
  let idExtraction: StoryIdResolution | undefined;
  let idScan: CurrentStoryIdScan | undefined;
  let profile: InstagramProfileStoryRef | undefined;
  if (!ref && !manual) {
    const links = await readPageLinks(tabId);
    if (links.canonical)
      candidates.push({ url: links.canonical, source: 'canonical' });
    if (links.og) candidates.push({ url: links.og, source: 'og-url' });
    ref = firstStoryRef([links.canonical, links.og]);
    if (ref) source = links.canonical ? 'canonical' : 'og-url';
  }
  if (!ref) {
    profile = firstProfileStoryRef(
      candidates.map((candidate) => candidate.url),
    );
    if (profile) {
      idScan = await readCurrentStoryIdScan(tabId, profile.username);
      idExtraction = idScan
        ? resolveCurrentStoryId(idScan)
        : {
            idExtractionSource: 'none',
            candidateCount: 0,
            activeMarkerFound: false,
          };
      if (idExtraction.id) {
        // Owner consistency: never accept an id whose extracted owner is a
        // different account than the route publisher.
        if (idScan?.routeOwnerMatch === false) {
          return {
            ok: true,
            result: {
              status: 'UNSUPPORTED_CONTENT',
              acquisitionContext: 'background',
              storySource: 'current-id-page-state',
              ...idDiagnostic(idExtraction),
              ...scanDiagnostic(idScan),
              identityResult: 'mismatch',
            },
          };
        }
        ref = {
          kind: 'story',
          username: profile.username,
          storyId: idExtraction.id,
          canonicalUrl: profile.canonicalUrl,
        };
        storySource = 'current-id-page-state';
      } else if (
        idExtraction.candidateCount !== 0 ||
        idExtraction.activeMarkerFound
      ) {
        // Candidates exist but none is provably current: never pick arbitrarily.
        return {
          ok: true,
          result: {
            status: 'UNSUPPORTED_CONTENT',
            acquisitionContext: 'background',
            storySource: 'current-id-page-state',
            ...idDiagnostic(idExtraction),
            ...scanDiagnostic(idScan),
            identityResult: 'unproven',
          },
        };
      }
    }
  }
  if (ref) {
    const request = buildInstagramStoryRequest(ref);
    const outcome = await runBackgroundFetch(request, undefined);
    const viewer = await readStoryViewerContext(tabId);
    const resolved = resolveStoryOutcome(
      outcome,
      'background',
      ref.canonicalUrl,
      storyFilenameMetadata({ username: ref.username, viewer }),
    );
    const responseOwnerMatch = matchOwner(ref.username, resolved.ownerUsername);
    const identityResult = resolveStoryIdentity({
      storySource,
      ...(idScan?.activeRoot ? { activeRoot: idScan.activeRoot } : {}),
      ...(idScan?.routeOwnerMatch !== undefined
        ? { routeOwnerMatch: idScan.routeOwnerMatch }
        : {}),
      responseOwnerMatch,
    });
    // Never expose or download a Story whose identity is not proven, and never
    // one owned by another account than the route publisher.
    if (identityResult !== 'proven') {
      return {
        ok: true,
        result: {
          status: 'UNSUPPORTED_CONTENT',
          acquisitionContext: 'background',
          storySource,
          ...(idExtraction ? idDiagnostic(idExtraction) : {}),
          ...scanDiagnostic(idScan),
          responseOwnerMatch,
          identityResult,
        },
      };
    }
    return {
      ok: true,
      result: {
        ...resolved.result,
        storySource,
        ...(idExtraction ? idDiagnostic(idExtraction) : {}),
        ...scanDiagnostic(idScan),
        responseOwnerMatch,
        identityResult,
        ...(viewer ? { viewerShape: viewer.shape } : {}),
      },
      ...(resolved.asset ? { asset: resolved.asset } : {}),
    };
  }
  if (profile) {
    // Emergency fallback only: use the currently active visible Story media
    // element. The selector itself ignores hidden/offscreen/preloaded media.
    const viewer = await readStoryViewerContext(tabId);
    const selection = viewer
      ? selectVisibleStoryMedia(
          viewer.media,
          viewer.viewport,
          viewer.viewerFound,
        )
      : undefined;
    const diagnostic = classifyVisibleMedia(
      selection || { ok: false, reason: 'no-viewer' },
      viewer?.blobVideos ?? 0,
    );
    const mseDiagnostics = {
      ...(viewer?.mseSource ? { mseSource: viewer.mseSource } : {}),
      ...(viewer?.audioPresent !== undefined
        ? { audioPresent: viewer.audioPresent }
        : {}),
    };
    const chosen = chooseStorySource({
      hasExplicitId: false,
      hasProfileRef: true,
      hasCurrentId: false,
      hasVisibleMedia: Boolean(selection && selection.ok),
    });
    if (
      viewer &&
      selection &&
      selection.ok &&
      chosen === 'visible-current-media'
    )
      return {
        ok: true,
        result: {
          ...visibleStoryResult(selection.kind, {
            visibleMedia: diagnostic,
            viewerShape: viewer.shape,
            ...mseDiagnostics,
          }),
          ...(idExtraction ? idDiagnostic(idExtraction) : {}),
          ...scanDiagnostic(idScan),
          identityResult: 'proven',
        },
        asset: visibleStoryMediaToAsset(
          selection,
          storyFilenameMetadata({ username: profile.username, viewer }),
        ),
      };
    return {
      ok: true,
      result: {
        status: 'UNSUPPORTED_CONTENT',
        acquisitionContext: 'background',
        storySource: 'visible-current-media',
        ...(idExtraction ? idDiagnostic(idExtraction) : {}),
        ...scanDiagnostic(idScan),
        visibleMedia: diagnostic,
        ...mseDiagnostics,
        ...(diagnostic === 'video-blob'
          ? { mseReason: 'MSE_MEDIA_UNAVAILABLE' as const }
          : {}),
        viewerShape: viewer?.shape ?? 'other',
        identityResult: 'unproven',
      },
    };
  }
  return {
    ok: false,
    error: 'Only one explicit Instagram Story URL is supported.',
    diagnostic: describeUrl(candidates[0]?.url ?? tabUrl, source),
  };
}

/** Sanitized id-extraction diagnostic fields; never an id. */
function idDiagnostic(resolution: StoryIdResolution) {
  return {
    idExtractionSource: resolution.idExtractionSource,
    candidateCount: resolution.candidateCount,
    activeMarkerFound: resolution.activeMarkerFound,
  };
}

/** Reads the current viewer context; any failure simply omits the metadata. */
async function readStoryViewerContext(
  tabId: number,
): Promise<StoryViewerContext | undefined> {
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      func: collectStoryViewerContextFunction,
      world: 'MAIN',
    });
    return injected[0]?.result;
  } catch {
    return undefined;
  }
}

/** Viewer-derived filename metadata only; response metadata still wins. */
function storyFilenameMetadata(input: {
  username?: string;
  viewer?: StoryViewerContext;
}): StoryFilenameMetadata {
  const index = input.viewer
    ? storyIndexFromSegments(input.viewer.progress.segments)
    : undefined;
  return {
    ...(input.username ? { username: input.username } : {}),
    ...(input.viewer?.publishedAt
      ? { publishedAt: input.viewer.publishedAt }
      : {}),
    ...(index !== undefined ? { index } : {}),
  };
}

/** M8B button: sanitized feasibility result only, never the asset URL. */
async function runStoryFeasibility(
  tabId: number,
  tabUrl: string | undefined,
  manual = false,
): Promise<{ ok: true; result: StoryFeasibilityResult } | RunFailure> {
  const resolved = await resolveCurrentStory(tabId, tabUrl, manual);
  if (!resolved.ok) return resolved;
  return { ok: true, result: resolved.result };
}

function unexpectedFailure(error: unknown): RunFailure {
  return {
    ok: false,
    error: error instanceof Error ? error.message : 'The probe failed.',
    diagnostic: {
      urlObtained: false,
      source: 'none',
      pathCategory: 'unavailable',
    },
  };
}

/**
 * Ground truth: read the URL from the tab itself. This avoids a stale or
 * missing tabs.query URL and guarantees we inject into the tab we parsed.
 */
async function readTabLocation(tabId: number): Promise<string | undefined> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => location.href,
    });
    const value = results[0]?.result;
    return typeof value === 'string' && value ? value : undefined;
  } catch {
    return undefined;
  }
}

/** SPA/modal fallback: the page's own canonical or Open Graph URL. */
async function readPageLinks(
  tabId: number,
): Promise<{ canonical?: string; og?: string }> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        canonical:
          document
            .querySelector('link[rel="canonical"]')
            ?.getAttribute('href') ?? null,
        og:
          document
            .querySelector('meta[property="og:url"]')
            ?.getAttribute('content') ?? null,
      }),
    });
    const value = results[0]?.result as
      { canonical?: string | null; og?: string | null } | undefined;
    return {
      ...(value?.canonical ? { canonical: value.canonical } : {}),
      ...(value?.og ? { og: value.og } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * Runs the three authenticated acquisition contexts against one explicit tab.
 * Everything stays in the user's browser; no UniFetch server is contacted.
 */
async function runAuthenticatedMatrix(
  tabId: number,
  tabUrl: string | undefined,
  manual = false,
): Promise<RunSuccess | RunFailure> {
  const direct: UrlCandidate[] = [];
  if (manual) {
    // A manual URL is authoritative: never silently fall back to the tab URL.
    if (typeof tabUrl === 'string' && tabUrl)
      direct.push({ url: tabUrl, source: 'manual' });
  } else {
    const location = await readTabLocation(tabId);
    if (location) direct.push({ url: location, source: 'scripting-location' });
    if (typeof tabUrl === 'string' && tabUrl)
      direct.push({ url: tabUrl, source: 'tab-url' });
  }
  let preflight = resolveContentRef(direct);
  if (!preflight.ok && !manual) {
    const links = await readPageLinks(tabId);
    const extended = [...direct];
    if (links.canonical)
      extended.push({ url: links.canonical, source: 'canonical' });
    if (links.og) extended.push({ url: links.og, source: 'og-url' });
    if (extended.length > direct.length)
      preflight = resolveContentRef(extended);
  }
  if (!preflight.ok)
    return {
      ok: false,
      error: preflight.error,
      diagnostic: preflight.diagnostic,
    };
  const ref = preflight.ref;
  const request = buildStrategyRequest(ref);
  const origin = new URL(request.endpoint).origin;
  const csrfToken = await prepareCsrfContext(origin);
  const input: InjectedRequestInput = {
    endpoint: request.endpoint,
    body: request.body ?? '',
    headers: request.headers,
    csrfHeader: request.csrfHeader ?? 'X-CSRFToken',
    ...(csrfToken ? { csrfToken } : {}),
  };
  const results = await runStrategyMatrix(async (strategy) => {
    if (strategy === 'background-fetch')
      return classifyStrategyOutcome(
        strategy,
        await runBackgroundFetch(request, csrfToken),
        ref,
      );
    const world = strategy === 'main-world' ? 'MAIN' : 'ISOLATED';
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      func: authenticatedRequestFunction,
      args: [input],
      world,
    });
    const raw = validateInjectedOutcome(injected[0]?.result);
    if (!raw) return { strategy, status: 'UNKNOWN' as const };
    return classifyStrategyOutcome(strategy, raw, ref);
  });
  return { ok: true, results };
}

interface ContentResolution {
  status: AuthenticatedStrategyStatus;
  assets: MediaAsset[];
  assetTypes: ('image' | 'video')[];
}

/**
 * Authenticated Post/Reel/Carousel resolution inside the extension. Prefers the
 * background runtime, then falls back to an injected context. Assets stay local.
 */
async function resolveContent(
  tabId: number,
  ref: InstagramContentRef,
): Promise<ContentResolution> {
  const request = buildStrategyRequest(ref);
  const origin = new URL(request.endpoint).origin;
  const csrfToken = await prepareCsrfContext(origin);
  const input: InjectedRequestInput = {
    endpoint: request.endpoint,
    body: request.body ?? '',
    headers: request.headers,
    csrfHeader: request.csrfHeader ?? 'X-CSRFToken',
    ...(csrfToken ? { csrfToken } : {}),
  };
  const attempts: {
    strategy: AuthenticatedStrategy;
    world?: 'MAIN' | 'ISOLATED';
  }[] = [
    { strategy: 'background-fetch' },
    { strategy: 'isolated-content-script', world: 'ISOLATED' },
    { strategy: 'main-world', world: 'MAIN' },
  ];
  let status: AuthenticatedStrategyStatus = 'UNKNOWN';
  for (const attempt of attempts) {
    let resolved;
    if (attempt.strategy === 'background-fetch') {
      resolved = resolveStrategyOutcome(
        attempt.strategy,
        await runBackgroundFetch(request, csrfToken),
        ref,
      );
    } else {
      const injected = await chrome.scripting.executeScript({
        target: { tabId },
        func: authenticatedRequestFunction,
        args: [input],
        world: attempt.world,
      });
      const raw = validateInjectedOutcome(injected[0]?.result);
      if (!raw) {
        status = 'UNKNOWN';
        continue;
      }
      resolved = resolveStrategyOutcome(attempt.strategy, raw, ref);
    }
    if (resolved.result.status === 'SUCCESS' && resolved.assets?.length) {
      const assetTypes = Array.from(
        new Set(
          resolved.assets
            .map((asset) => asset.type)
            .filter(
              (type): type is 'image' | 'video' =>
                type === 'image' || type === 'video',
            ),
        ),
      );
      return { status: 'SUCCESS', assets: resolved.assets, assetTypes };
    }
    status = resolved.result.status;
  }
  return { status, assets: [], assetTypes: [] };
}

/** Maps a URL that parsed as Instagram but is not a supported target. */
function classifyTargetFailure(
  inputs: readonly (string | undefined)[],
): ResolveErrorCode {
  for (const input of inputs) {
    if (!input) continue;
    try {
      parseSupportedUrl(input);
      return 'UNSUPPORTED_CONTENT';
    } catch {
      // not a supported platform URL; keep checking
    }
  }
  return 'INVALID_URL';
}

/** Normalizes a Post/Carousel/Reel resolution into the unified contract. */
function contentResolveResponse(
  kind: 'post' | 'reel',
  content: ContentResolution,
): ExtensionResolveResponse {
  const contentType: ExtensionContentType =
    kind === 'reel' ? 'reel' : content.assets.length > 1 ? 'carousel' : 'post';
  if (content.status !== 'SUCCESS' || content.assets.length === 0)
    return {
      ok: false,
      error: resolveErrorCodeFromStatus(content.status),
      contentType,
    };
  return { ok: true, contentType, assets: content.assets };
}

/**
 * M8D single resolve entry point for a manual or tab URL. Dispatches Post/Reel
 * to the local authenticated content resolver and Story to the Story resolver,
 * always returning ONE unified response shape. Everything stays local; nothing
 * is redirected to Web/PWA.
 */
async function resolveRequest(
  tabId: number,
  tabUrl: string | undefined,
  manual = false,
): Promise<ExtensionResolveResponse> {
  const inputs: (string | undefined)[] = [];
  if (manual) {
    if (tabUrl) inputs.push(tabUrl);
  } else {
    const location = await readTabLocation(tabId);
    if (location) inputs.push(location);
    if (tabUrl) inputs.push(tabUrl);
  }
  let target = firstInstagramTarget(inputs);
  if (!target && !manual) {
    const links = await readPageLinks(tabId);
    inputs.push(links.canonical, links.og);
    target = firstInstagramTarget([links.canonical, links.og]);
  }
  if (!target) return { ok: false, error: classifyTargetFailure(inputs) };
  if (target.kind === 'post' || target.kind === 'reel')
    return contentResolveResponse(
      target.kind,
      await resolveContent(tabId, target.ref),
    );
  const story = await resolveCurrentStory(tabId, tabUrl, manual);
  if (!story.ok)
    return { ok: false, error: 'UNSUPPORTED_CONTENT', contentType: 'story' };
  if (story.result.status !== 'SUCCESS' || !story.asset)
    return {
      ok: false,
      error: resolveErrorCodeFromStatus(story.result.status),
      contentType: 'story',
    };
  return { ok: true, contentType: 'story', assets: [story.asset] };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;
  const request = message as {
    type?: unknown;
    tabId?: unknown;
    url?: unknown;
    manual?: unknown;
  };
  // Build/protocol handshake: opaque markers only, no tab or user data. Handled
  // before the tab check because it intentionally carries no tabId.
  if (isRuntimeInfoRequest(request)) {
    sendResponse(runtimeInfo());
    return false;
  }
  if (typeof request.tabId !== 'number') return false;
  const tabUrl = typeof request.url === 'string' ? request.url : undefined;
  const manual = request.manual === true;
  if (request.type === 'UNIFETCH_M8A_RUN') {
    runAuthenticatedMatrix(request.tabId, tabUrl, manual).then(
      sendResponse,
      (error: unknown) => sendResponse(unexpectedFailure(error)),
    );
    return true;
  }
  if (request.type === 'UNIFETCH_M8B_STORY') {
    runStoryFeasibility(request.tabId, tabUrl, manual).then(
      sendResponse,
      (error: unknown) => sendResponse(unexpectedFailure(error)),
    );
    return true;
  }
  if (request.type === 'UNIFETCH_M8C_STORY_DOWNLOAD') {
    resolveCurrentStory(request.tabId, tabUrl, manual).then(
      sendResponse,
      (error: unknown) => sendResponse(unexpectedFailure(error)),
    );
    return true;
  }
  if (request.type === 'UNIFETCH_M8D_RESOLVE') {
    resolveRequest(request.tabId, tabUrl, manual).then(
      sendResponse,
      (error: unknown) => sendResponse(unexpectedFailure(error)),
    );
    return true;
  }
  return false;
});

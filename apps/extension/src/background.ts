import type { MediaAsset } from '@unifetch/core';
import { parseSupportedUrl } from '@unifetch/core';
import type { InstagramContentRef } from '@unifetch/meta-resolver/instagram';
import { validateInjectedOutcome } from './bridge';
import { resolveStrategyOutcome } from './classify';
import type {
  AuthenticatedStrategy,
  AuthenticatedStrategyStatus,
  InjectedRequestInput,
} from './contracts';
import { authenticatedRequestFunction } from './injected';
import type { PreflightDiagnostic, UrlCandidate } from './preflight';
import { describeUrl } from './preflight';
import { buildStrategyRequest } from './request';
import type {
  ExtensionContentType,
  ExtensionResolveResponse,
  ResolveErrorCode,
} from './resolve';
import { resolveErrorCodeFromStatus } from './resolve';
import { isRuntimeInfoRequest, runtimeInfo } from './runtime-info';
import { prepareCsrfContext, runBackgroundFetch } from './strategy';
import {
  matchOwner,
  resolveStoryIdentity,
  resolveStoryOutcome,
} from './story/classify';
import type { StoryFeasibilityResult } from './story/contracts';
import { buildInstagramStoryRequest } from './story/request';
import { routeStoryUrls } from './story/route';
import { firstExtensionTarget, type ThreadsTarget } from './target';
import { createThreadsAcquisition } from './threads/acquisition';
import { createChromeThreadsHeaderRule } from './threads/header-rule';
import { hasThreadsPermission } from './threads/permission';
import { resolveThreadsTarget } from './threads/resolve';

/**
 * One shared rule lease for the whole service-worker lifetime. Every Threads
 * resolution must use this instance: creating one lease per request would let
 * two concurrent resolutions install and remove the same rule ID independently
 * and strip headers from each other's in-flight fetch.
 */
const threadsHeaderRule = createChromeThreadsHeaderRule();
// Clean up a rule left behind if the worker was terminated mid-acquisition.
// Serialized inside the lease, so it cannot remove a rule installed later.
void threadsHeaderRule.discardStale();

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

/**
 * Stable Story resolution. Only an explicit Story media id is accepted; the
 * existing `/api/v1/media/<id>/info/` path is reused. Username-only URLs are
 * refused before any network request or page-state inspection.
 */
async function resolveStory(
  tabId: number,
  tabUrl: string | undefined,
  manual = false,
): Promise<StorySuccess | RunFailure> {
  const urls: (string | undefined)[] = [];
  let source: UrlCandidate['source'] = manual ? 'manual' : 'tab-url';
  if (manual) {
    if (tabUrl) urls.push(tabUrl);
  } else {
    const location = await readTabLocation(tabId);
    if (location) urls.push(location);
    if (tabUrl) urls.push(tabUrl);
    source = location ? 'scripting-location' : 'tab-url';
  }
  let route = routeStoryUrls(urls);
  if (!manual && route.status === 'unsupported') {
    // SPA/modal fallback: the page's own canonical or Open Graph URL. This only
    // reads link metadata; it never inspects Story viewer state. An explicit id
    // in canonical/og is still authoritative; otherwise the URL fails closed.
    const links = await readPageLinks(tabId);
    urls.push(links.canonical, links.og);
    route = routeStoryUrls(urls);
    source = links.canonical ? 'canonical' : links.og ? 'og-url' : source;
  }
  if (route.status === 'unsupported') {
    if (route.reason === 'username-only')
      return { ok: true, result: route.result };
    return {
      ok: false,
      error: 'Only one explicit Instagram Story URL is supported.',
      diagnostic: describeUrl(urls[0] ?? tabUrl, source),
    };
  }
  const ref = route.ref;
  const request = buildInstagramStoryRequest(ref);
  const outcome = await runBackgroundFetch(request, undefined);
  const resolved = resolveStoryOutcome(
    outcome,
    'background',
    ref.canonicalUrl,
    { username: ref.username },
  );
  const responseOwnerMatch = matchOwner(ref.username, resolved.ownerUsername);
  const identityResult = resolveStoryIdentity({
    storySource: 'explicit-id-url',
    responseOwnerMatch,
  });
  // Never expose or download a Story whose publisher differs from the route.
  if (identityResult !== 'proven')
    return {
      ok: true,
      result: {
        status: 'UNSUPPORTED_CONTENT',
        acquisitionContext: 'background',
        storySource: 'explicit-id-url',
        responseOwnerMatch,
        identityResult,
      },
    };
  return {
    ok: true,
    result: {
      ...resolved.result,
      storySource: 'explicit-id-url',
      responseOwnerMatch,
      identityResult,
    },
    ...(resolved.asset ? { asset: resolved.asset } : {}),
  };
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
 * Public Threads resolution. The optional host permission is checked in the
 * background as well as requested by the popup from an explicit user gesture.
 * No Instagram transport or session is touched.
 */
async function resolveThreadsRequest(
  target: ThreadsTarget,
): Promise<ExtensionResolveResponse> {
  if (!(await hasThreadsPermission(chrome.permissions)))
    return {
      ok: false,
      platform: 'threads',
      contentType: 'post',
      error: 'PERMISSION_REQUIRED',
    };
  try {
    const acquisition = createThreadsAcquisition({
      headerRule: threadsHeaderRule,
    });
    return await resolveThreadsTarget(target, acquisition);
  } catch (error) {
    return {
      ok: false,
      platform: 'threads',
      contentType: 'post',
      error:
        error instanceof Error && /permission/i.test(error.message)
          ? 'PERMISSION_REQUIRED'
          : 'UNKNOWN',
    };
  }
}

/**
 * Single resolve entry point for a manual or tab URL. Dispatches Post/Reel to
 * the local authenticated content resolver and an explicit-id Story to the
 * Story resolver, always returning ONE unified response shape. Everything stays
 * local; nothing is redirected to Web/PWA.
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
  let target = firstExtensionTarget(inputs);
  if (!target && !manual) {
    const links = await readPageLinks(tabId);
    inputs.push(links.canonical, links.og);
    target = firstExtensionTarget([links.canonical, links.og]);
  }
  if (!target) return { ok: false, error: classifyTargetFailure(inputs) };
  if (target.platform === 'threads') return resolveThreadsRequest(target);
  if (target.kind === 'post' || target.kind === 'reel')
    return contentResolveResponse(
      target.kind,
      await resolveContent(tabId, target.ref),
    );
  const story = await resolveStory(tabId, tabUrl, manual);
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
  if (request.type === 'UNIFETCH_RESOLVE') {
    resolveRequest(request.tabId, tabUrl, manual).then(
      sendResponse,
      (error: unknown) => sendResponse(unexpectedFailure(error)),
    );
    return true;
  }
  return false;
});

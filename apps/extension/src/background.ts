import { validateInjectedOutcome } from './bridge';
import { classifyStrategyOutcome } from './classify';
import type {
  AuthenticatedStrategyResult,
  InjectedRequestInput,
} from './contracts';
import { authenticatedRequestFunction } from './injected';
import { runStrategyMatrix } from './orchestrate';
import type { PreflightDiagnostic, UrlCandidate } from './preflight';
import { resolveContentRef } from './preflight';
import { buildStrategyRequest } from './request';
import { prepareCsrfContext, runBackgroundFetch } from './strategy';

interface RunSuccess {
  ok: true;
  results: AuthenticatedStrategyResult[];
}

interface RunFailure {
  ok: false;
  error: string;
  diagnostic: PreflightDiagnostic;
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
): Promise<RunSuccess | RunFailure> {
  const direct: UrlCandidate[] = [];
  const location = await readTabLocation(tabId);
  if (location) direct.push({ url: location, source: 'scripting-location' });
  if (typeof tabUrl === 'string' && tabUrl)
    direct.push({ url: tabUrl, source: 'tab-url' });
  let preflight = resolveContentRef(direct);
  if (!preflight.ok) {
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
    body: request.body,
    headers: request.headers,
    csrfHeader: request.csrfHeader,
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;
  const request = message as {
    type?: unknown;
    tabId?: unknown;
    url?: unknown;
  };
  if (request.type !== 'UNIFETCH_M8A_RUN' || typeof request.tabId !== 'number')
    return false;
  const tabUrl = typeof request.url === 'string' ? request.url : undefined;
  runAuthenticatedMatrix(request.tabId, tabUrl).then(
    (response) => sendResponse(response),
    (error: unknown) =>
      sendResponse({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'This tab is not an Instagram post or Reel.',
        diagnostic: {
          urlObtained: false,
          source: 'none',
          pathCategory: 'unavailable',
        },
      }),
  );
  return true;
});

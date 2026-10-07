import type { AuthenticatedStrategyResult } from './contracts';
import type { PreflightDiagnostic } from './preflight';

const runButton = document.querySelector<HTMLButtonElement>('#run');
const status = document.querySelector<HTMLParagraphElement>('#status');
const list = document.querySelector<HTMLUListElement>('#results');

function describeDiagnostic(diagnostic: PreflightDiagnostic): string {
  return [
    `host=${diagnostic.hostname ?? 'n/a'}`,
    `path=${diagnostic.pathCategory}`,
    `urlObtained=${diagnostic.urlObtained}`,
    `source=${diagnostic.source}`,
  ].join(' · ');
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

runButton?.addEventListener('click', async () => {
  if (!runButton || !status || !list) return;
  runButton.disabled = true;
  list.replaceChildren();
  status.textContent = 'Running the three strategies…';
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab || typeof tab.id !== 'number') {
      status.textContent = 'No active tab.';
      return;
    }
    const response = (await chrome.runtime.sendMessage({
      type: 'UNIFETCH_M8A_RUN',
      tabId: tab.id,
      url: tab.url,
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
          : 'not an Instagram post or Reel tab'
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
    status.textContent =
      error instanceof Error ? error.message : 'The run failed.';
  } finally {
    runButton.disabled = false;
  }
});

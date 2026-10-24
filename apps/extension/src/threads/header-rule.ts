import { UniFetchError } from '@unifetch/core';

/**
 * Threads serves full post metadata only to navigation-like requests. A
 * browser fetch normally sends `Sec-Fetch-Mode: cors` / `Sec-Fetch-Dest: empty`
 * and receives the reduced JavaScript shell even with `credentials: 'omit'`.
 *
 * This narrowly scoped session rule rewrites only those navigation headers for
 * extension-initiated requests to threads.com. It does not remove or add
 * cookies; `credentials: 'omit'` is set independently on every request. The
 * rule is installed for the duration of one acquisition and removed afterwards.
 */
export const THREADS_HEADER_RULE_ID = 73001;

export const THREADS_NAVIGATION_HEADERS = [
  { header: 'sec-fetch-dest', operation: 'set', value: 'document' },
  { header: 'sec-fetch-mode', operation: 'set', value: 'navigate' },
  { header: 'sec-fetch-site', operation: 'set', value: 'none' },
  { header: 'sec-fetch-user', operation: 'set', value: '?1' },
  { header: 'upgrade-insecure-requests', operation: 'set', value: '1' },
] as const;

export interface SessionRule {
  id: number;
  priority: number;
  action: {
    type: 'modifyHeaders';
    requestHeaders: {
      header: string;
      operation: 'set' | 'remove';
      value?: string;
    }[];
  };
  condition: {
    requestDomains: string[];
    resourceTypes: string[];
  };
}

export interface SessionRulesApi {
  updateSessionRules(options: {
    removeRuleIds?: number[];
    addRules?: SessionRule[];
  }): Promise<void>;
}

export interface ThreadsHeaderRule {
  /** Runs `task` while the navigation-header rule is installed. */
  withHeaders<T>(task: () => Promise<T>): Promise<T>;
}

/**
 * Ref-counted rule lease. Concurrent acquisitions share one installed rule;
 * the last one removes it. Install/remove transitions are serialized so a
 * starting request cannot observe a half-removed rule.
 */
export function createThreadsHeaderRule(
  api: SessionRulesApi | undefined,
): ThreadsHeaderRule {
  let users = 0;
  let installed = false;
  let transition: Promise<void> = Promise.resolve();

  const serialize = (operation: () => Promise<void>): Promise<void> => {
    transition = transition.then(operation, operation);
    return transition;
  };

  const install = async (): Promise<void> => {
    if (!api)
      throw new UniFetchError(
        'BROWSER_RESTRICTION',
        'The extension cannot prepare the Threads request.',
      );
    try {
      await api.updateSessionRules({
        removeRuleIds: [THREADS_HEADER_RULE_ID],
        addRules: [
          {
            id: THREADS_HEADER_RULE_ID,
            priority: 1,
            action: {
              type: 'modifyHeaders',
              requestHeaders: THREADS_NAVIGATION_HEADERS.map((header) => ({
                ...header,
              })),
            },
            condition: {
              requestDomains: ['threads.com'],
              resourceTypes: ['xmlhttprequest', 'other'],
            },
          },
        ],
      });
    } catch {
      throw new UniFetchError(
        'BROWSER_RESTRICTION',
        'The extension could not prepare the Threads request headers.',
      );
    }
  };

  const remove = async (): Promise<void> => {
    if (!api) return;
    try {
      await api.updateSessionRules({
        removeRuleIds: [THREADS_HEADER_RULE_ID],
      });
    } catch {
      // A stale rule only scopes navigation headers to threads.com and is
      // harmless; the next acquisition replaces it.
    }
  };

  return {
    async withHeaders<T>(task: () => Promise<T>): Promise<T> {
      users += 1;
      try {
        await serialize(async () => {
          if (!installed) {
            await install();
            installed = true;
          }
        });
        return await task();
      } finally {
        users -= 1;
        if (users === 0) {
          await serialize(async () => {
            if (installed) {
              await remove();
              installed = false;
            }
          });
        }
      }
    },
  };
}

export function createChromeThreadsHeaderRule(
  api: SessionRulesApi | undefined = chrome.declarativeNetRequest,
): ThreadsHeaderRule {
  return createThreadsHeaderRule(api);
}

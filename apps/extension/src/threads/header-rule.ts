import { UniFetchError } from '@unifetch/core';

/**
 * Threads serves full post metadata only to navigation-like requests. A
 * browser fetch normally sends `Sec-Fetch-Mode: cors` / `Sec-Fetch-Dest: empty`
 * and receives the reduced JavaScript shell even with `credentials: 'omit'`.
 *
 * This narrowly scoped session rule rewrites only those navigation headers for
 * non-tab extension requests to the exact official Threads origin. It does not
 * remove or add cookies; `credentials: 'omit'` is set independently on every
 * request. The rule is installed for the duration of one acquisition, removed
 * afterwards, and cleared again when the worker starts after an interruption.
 */
export const THREADS_HEADER_RULE_ID = 73001;

/**
 * `tabIds: [-1]` (tabs.TAB_ID_NONE) is the critical isolation boundary: the
 * rule only matches requests that are not associated with any tab, i.e. the
 * extension service worker / popup. Ordinary Threads browsing tabs (tabId >= 0)
 * and every Instagram request (different request domain) are never matched.
 * The request domain and URL filter are both anchored to the exact official
 * metadata origin, so no other host or path is touched.
 */
export const THREADS_HEADER_RULE_CONDITION = {
  requestDomains: ['www.threads.com'],
  // Chrome classifies extension service-worker fetch() as `xmlhttprequest`.
  // `other` is not needed and would only widen the rule.
  resourceTypes: ['xmlhttprequest'],
  tabIds: [-1],
  urlFilter: '|https://www.threads.com/',
} as const;

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
    tabIds?: number[];
    urlFilter?: string;
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
  /**
   * Removes a rule left behind if the service worker was terminated during an
   * acquisition. Serialized with installs so it can never remove a rule that a
   * newer acquisition just installed. Called once when the worker starts.
   */
  discardStale(): Promise<void>;
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
              requestDomains: [...THREADS_HEADER_RULE_CONDITION.requestDomains],
              resourceTypes: [...THREADS_HEADER_RULE_CONDITION.resourceTypes],
              tabIds: [...THREADS_HEADER_RULE_CONDITION.tabIds],
              urlFilter: THREADS_HEADER_RULE_CONDITION.urlFilter,
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
      // A stale rule is inert for browsing tabs and Instagram, and the next
      // acquisition or worker start removes it.
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

    async discardStale(): Promise<void> {
      await serialize(async () => {
        if (users > 0) return;
        await remove();
        installed = false;
      });
    },
  };
}

export function createChromeThreadsHeaderRule(
  api: SessionRulesApi | undefined = chrome.declarativeNetRequest,
): ThreadsHeaderRule {
  return createThreadsHeaderRule(api);
}

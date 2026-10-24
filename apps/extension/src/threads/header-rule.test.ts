import { describe, expect, it, vi } from 'vitest';
import {
  THREADS_HEADER_RULE_ID,
  THREADS_NAVIGATION_HEADERS,
  createThreadsHeaderRule,
  type SessionRule,
  type SessionRulesApi,
} from './header-rule';

function api(options: { failInstall?: boolean; failRemove?: boolean } = {}) {
  const calls: { removeRuleIds?: number[]; addRules?: SessionRule[] }[] = [];
  const updateSessionRules = vi.fn(
    async (input: { removeRuleIds?: number[]; addRules?: SessionRule[] }) => {
      calls.push(input);
      if (input.addRules?.length && options.failInstall)
        throw new Error('install failed');
      if (!input.addRules?.length && options.failRemove)
        throw new Error('remove failed');
    },
  );
  return {
    api: { updateSessionRules } as SessionRulesApi,
    calls,
    updateSessionRules,
  };
}

describe('Threads navigation-header session rule', () => {
  it('installs one narrow rule, runs the task and removes it', async () => {
    const fake = api();
    const rule = createThreadsHeaderRule(fake.api);
    await expect(rule.withHeaders(async () => 'ok')).resolves.toBe('ok');
    expect(fake.updateSessionRules).toHaveBeenCalledTimes(2);
    const added = fake.calls[0].addRules?.[0];
    expect(added).toBeDefined();
    expect(added?.id).toBe(THREADS_HEADER_RULE_ID);
    expect(added?.condition).toEqual({
      requestDomains: ['www.threads.com'],
      resourceTypes: ['xmlhttprequest'],
      tabIds: [-1],
      urlFilter: '|https://www.threads.com/',
    });
    expect(added?.action.requestHeaders).toEqual(
      THREADS_NAVIGATION_HEADERS.map((header) => ({ ...header })),
    );
    expect(fake.calls[1]).toEqual({
      removeRuleIds: [THREADS_HEADER_RULE_ID],
    });
  });

  it('shares one rule across concurrent acquisitions and removes it once', async () => {
    const fake = api();
    const rule = createThreadsHeaderRule(fake.api);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = rule.withHeaders(async () => {
      await gate;
      return 'first';
    });
    const second = rule.withHeaders(async () => 'second');
    await expect(second).resolves.toBe('second');
    expect(fake.calls.filter((call) => call.addRules?.length)).toHaveLength(1);
    expect(
      fake.calls.filter((call) => !call.addRules && call.removeRuleIds?.length),
    ).toHaveLength(0);
    release();
    await expect(first).resolves.toBe('first');
    expect(
      fake.calls.filter((call) => !call.addRules && call.removeRuleIds?.length),
    ).toHaveLength(1);
  });

  it('removes the rule when the task throws', async () => {
    const fake = api();
    const rule = createThreadsHeaderRule(fake.api);
    await expect(
      rule.withHeaders(async () => {
        throw new Error('fetch failed');
      }),
    ).rejects.toThrow('fetch failed');
    expect(fake.calls.at(-1)).toEqual({
      removeRuleIds: [THREADS_HEADER_RULE_ID],
    });
  });

  it('fails closed when the session rule cannot be installed', async () => {
    const fake = api({ failInstall: true });
    const rule = createThreadsHeaderRule(fake.api);
    const task = vi.fn(async () => 'not run');
    await expect(rule.withHeaders(task)).rejects.toMatchObject({
      code: 'BROWSER_RESTRICTION',
    });
    expect(task).not.toHaveBeenCalled();
  });

  it('does not mask a successful task when rule removal fails', async () => {
    const fake = api({ failRemove: true });
    const rule = createThreadsHeaderRule(fake.api);
    await expect(rule.withHeaders(async () => 'ok')).resolves.toBe('ok');
  });

  it('fails closed without a rules API', async () => {
    const rule = createThreadsHeaderRule(undefined);
    await expect(rule.withHeaders(async () => 'ok')).rejects.toMatchObject({
      code: 'BROWSER_RESTRICTION',
    });
  });

  it('scopes header changes to non-tab requests on the exact Threads origin', async () => {
    const fake = api();
    const rule = createThreadsHeaderRule(fake.api);
    await rule.withHeaders(async () => 'ok');
    const condition = fake.calls[0].addRules?.[0]?.condition;
    // tabIds.TAB_ID_NONE: only the extension service worker/popup, never an
    // ordinary Threads browsing tab.
    expect(condition?.tabIds).toEqual([-1]);
    expect(condition?.resourceTypes).toEqual(['xmlhttprequest']);
    expect(condition?.requestDomains).toEqual(['www.threads.com']);
    expect(condition?.urlFilter).toBe('|https://www.threads.com/');
    // No header may remove or add cookies/authorization.
    const headers = fake.calls[0].addRules?.[0]?.action.requestHeaders ?? [];
    for (const entry of headers) {
      expect(entry.operation).toBe('set');
      expect(entry.header).not.toMatch(/cookie|authorization|auth/i);
    }
  });

  it('removes a stale rule on worker start without touching a live lease', async () => {
    const fake = api();
    const rule = createThreadsHeaderRule(fake.api);
    await rule.discardStale();
    expect(fake.calls).toEqual([{ removeRuleIds: [THREADS_HEADER_RULE_ID] }]);

    let started!: () => void;
    const taskStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const live = rule.withHeaders(async () => {
      started();
      await gate;
      return 'ok';
    });
    await taskStarted;
    await rule.discardStale();
    // The in-use rule must not be removed by the startup cleanup.
    expect(
      fake.calls.filter((call) => !call.addRules && call.removeRuleIds?.length),
    ).toHaveLength(1);
    release();
    await expect(live).resolves.toBe('ok');
    expect(
      fake.calls.filter((call) => !call.addRules && call.removeRuleIds?.length),
    ).toHaveLength(2);
  });
});

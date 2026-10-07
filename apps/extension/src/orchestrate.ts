import { UniFetchError } from '@unifetch/core';
import {
  parseInstagramContentRef,
  type InstagramContentRef,
} from '@unifetch/meta-resolver/instagram';
import type {
  AuthenticatedStrategy,
  AuthenticatedStrategyResult,
} from './contracts';

export const M8A_STRATEGIES: readonly AuthenticatedStrategy[] = [
  'background-fetch',
  'isolated-content-script',
  'main-world',
];

/** Accepts only an explicit HTTP(S) Instagram post or Reel tab URL. */
export function assertInstagramTabUrl(
  tabUrl: string | undefined,
): InstagramContentRef {
  if (typeof tabUrl !== 'string' || !/^https?:\/\//i.test(tabUrl))
    throw new UniFetchError(
      'UNSUPPORTED_CONTENT',
      'Open an Instagram post or Reel tab first.',
    );
  return parseInstagramContentRef(tabUrl);
}

export type StrategyRunner = (
  strategy: AuthenticatedStrategy,
) => Promise<AuthenticatedStrategyResult>;

/**
 * Runs every strategy independently. A failure in one strategy is recorded and
 * never prevents the remaining strategies from running.
 */
export async function runStrategyMatrix(
  run: StrategyRunner,
): Promise<AuthenticatedStrategyResult[]> {
  const results: AuthenticatedStrategyResult[] = [];
  for (const strategy of M8A_STRATEGIES) {
    try {
      results.push(await run(strategy));
    } catch {
      results.push({ strategy, status: 'UNKNOWN' });
    }
  }
  return results;
}

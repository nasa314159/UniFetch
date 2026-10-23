import type { MediaAsset } from '@unifetch/core';
import {
  applyResolveResponse,
  describeDownload,
  type AssetDownloadSummary,
  type ExtensionContentType,
} from './resolve';

/**
 * M8D "Download all" orchestration. Download all no longer requires a prior
 * Resolve: cached assets for the current target are reused, otherwise the
 * current target is resolved first and downloaded immediately on success.
 *
 * Cache identity is an in-memory target fingerprint only; nothing is persisted.
 */
export interface ResolvedCache {
  fingerprint: string;
  contentType: ExtensionContentType;
  assets: MediaAsset[];
}

export interface DownloadFlowOutcome {
  /** Cache to keep for the current target (undefined when resolution failed). */
  cache?: ResolvedCache;
  message: string;
  downloaded: boolean;
}

/** True when the cached assets belong to the current target fingerprint. */
export function cacheMatches(
  cache: ResolvedCache | undefined,
  fingerprint: string,
): boolean {
  return Boolean(
    cache && cache.fingerprint === fingerprint && cache.assets.length > 0,
  );
}

export interface DownloadAllOptions {
  cache?: ResolvedCache;
  /** Fingerprint of the current manual URL or active-tab target. */
  fingerprint: string;
  /** Resolves the current target; returns the unified resolve response. */
  resolve: () => Promise<unknown>;
  /** Downloads the resolved assets; may throw. */
  download: (assets: readonly MediaAsset[]) => Promise<AssetDownloadSummary>;
  /** Content label used when a failure response has no contentType. */
  fallbackLabel?: string;
}

/**
 * One shared path for Download all: reuse matching cached assets, else resolve
 * then download. A resolve failure downloads nothing and returns the typed
 * resolve message; a download failure is reported as DOWNLOAD_FAILED.
 */
export async function downloadAllCurrentTarget(
  options: DownloadAllOptions,
): Promise<DownloadFlowOutcome> {
  const { fingerprint, resolve, download, fallbackLabel = 'Item' } = options;
  let active = cacheMatches(options.cache, fingerprint)
    ? options.cache
    : undefined;
  if (!active) {
    const next = applyResolveResponse(await resolve(), fallbackLabel);
    if (!next.downloadEnabled || !next.contentType)
      return { cache: undefined, message: next.message, downloaded: false };
    active = {
      fingerprint,
      contentType: next.contentType,
      assets: next.assets,
    };
  }
  let summary: AssetDownloadSummary;
  try {
    summary = await download(active.assets);
  } catch {
    summary = { requested: 0, failed: active.assets.length };
  }
  return {
    cache: active,
    message: describeDownload(active.contentType, summary),
    downloaded: summary.requested > 0,
  };
}

export interface SingleFlight {
  readonly busy: boolean;
  /** Runs `task` unless another run is in flight; resolves to whether it ran. */
  run(task: () => Promise<void>): Promise<boolean>;
}

/** Prevents duplicate concurrent Download all runs (e.g. double clicks). */
export function createSingleFlight(): SingleFlight {
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    async run(task: () => Promise<void>): Promise<boolean> {
      if (busy) return false;
      busy = true;
      try {
        await task();
        return true;
      } finally {
        busy = false;
      }
    },
  };
}

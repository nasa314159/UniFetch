import type { MediaAsset } from '@unifetch/core';

/**
 * M8D unified local resolve contract. Exactly ONE response shape is consumed by
 * the popup Resolve action, for every supported content type. Diagnostic
 * details (matrix / Story feasibility) use their own messages and never gate the
 * download state.
 */
export type ExtensionContentType = 'post' | 'carousel' | 'reel' | 'story';

export type ResolvePlatform = 'instagram' | 'threads';

export type ResolveErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_CONTENT'
  | 'CONTENT_UNAVAILABLE'
  | 'LOGIN_REQUIRED'
  | 'GRAPHQL_EXECUTION_ERROR'
  | 'PARSER_OUTDATED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'BROWSER_RESTRICTION'
  | 'PERMISSION_REQUIRED'
  | 'HTTP_ERROR'
  | 'DOWNLOAD_FAILED'
  | 'UNKNOWN';

export interface ExtensionResolveSuccess {
  ok: true;
  contentType: ExtensionContentType;
  /** Present for Threads; Instagram responses keep their existing wording. */
  platform?: ResolvePlatform;
  /** In-memory only; never persisted and never displayed as a URL. */
  assets: MediaAsset[];
}

export interface ExtensionResolveFailure {
  ok: false;
  error: ResolveErrorCode;
  /** Present when the content type was known before the failure. */
  contentType?: ExtensionContentType;
  platform?: ResolvePlatform;
}

export type ExtensionResolveResponse =
  ExtensionResolveSuccess | ExtensionResolveFailure;

const contentTypes: readonly ExtensionContentType[] = [
  'post',
  'carousel',
  'reel',
  'story',
];

const resolveErrors: readonly ResolveErrorCode[] = [
  'INVALID_URL',
  'UNSUPPORTED_CONTENT',
  'CONTENT_UNAVAILABLE',
  'LOGIN_REQUIRED',
  'GRAPHQL_EXECUTION_ERROR',
  'PARSER_OUTDATED',
  'RATE_LIMITED',
  'NETWORK_ERROR',
  'BROWSER_RESTRICTION',
  'PERMISSION_REQUIRED',
  'HTTP_ERROR',
  'DOWNLOAD_FAILED',
  'UNKNOWN',
];

const platforms: readonly ResolvePlatform[] = ['instagram', 'threads'];

export function contentTypeLabel(
  contentType: ExtensionContentType | undefined,
): string {
  switch (contentType) {
    case 'post':
      return 'Post';
    case 'carousel':
      return 'Carousel';
    case 'reel':
      return 'Reel';
    case 'story':
      return 'Story';
    default:
      return 'Item';
  }
}

/** Maps acquisition/status strings onto the unified error enum. */
export function resolveErrorCodeFromStatus(status: string): ResolveErrorCode {
  return (resolveErrors as readonly string[]).includes(status)
    ? (status as ResolveErrorCode)
    : 'UNKNOWN';
}

function isSuccess(value: unknown): value is ExtensionResolveSuccess {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.ok === true &&
    typeof candidate.contentType === 'string' &&
    (contentTypes as readonly string[]).includes(candidate.contentType) &&
    Array.isArray(candidate.assets) &&
    (candidate.platform === undefined ||
      (typeof candidate.platform === 'string' &&
        (platforms as readonly string[]).includes(candidate.platform)))
  );
}

function isFailure(value: unknown): value is ExtensionResolveFailure {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.ok === false &&
    typeof candidate.error === 'string' &&
    (resolveErrors as readonly string[]).includes(candidate.error) &&
    (candidate.platform === undefined ||
      (typeof candidate.platform === 'string' &&
        (platforms as readonly string[]).includes(candidate.platform)))
  );
}

export interface ResolveUiState {
  /** Assets stored in popup-session memory only. */
  assets: MediaAsset[];
  downloadEnabled: boolean;
  message: string;
  contentType?: ExtensionContentType;
  platform?: ResolvePlatform;
}

function assetSummary(assets: readonly MediaAsset[]): string[] {
  const types = new Set<string>();
  for (const asset of assets) {
    if (
      asset.type === 'image' &&
      (asset.mimeType ?? '').toLowerCase() === 'image/gif'
    )
      types.add('gif');
    else types.add(asset.type);
  }
  return [...types];
}

function platformPrefix(platform: ResolvePlatform | undefined): string {
  return platform === 'threads' ? 'Threads ' : '';
}

/**
 * Pure popup Resolve state transition. A valid success always enables Download
 * all and is never formatted as UNKNOWN; a failure always clears stored assets
 * and disables Download all. Malformed responses are treated as UNKNOWN.
 */
export function applyResolveResponse(
  response: unknown,
  fallbackLabel = 'Item',
): ResolveUiState {
  if (isSuccess(response)) {
    const assets = response.assets;
    if (assets.length === 0)
      return {
        assets: [],
        downloadEnabled: false,
        message: `${platformPrefix(
          response.platform,
        )}${contentTypeLabel(response.contentType)} failed · UNKNOWN`,
      };
    const types = assetSummary(assets);
    return {
      assets,
      downloadEnabled: true,
      contentType: response.contentType,
      ...(response.platform ? { platform: response.platform } : {}),
      message: `${platformPrefix(
        response.platform,
      )}${contentTypeLabel(response.contentType)} resolved · ${
        assets.length
      } asset(s)${types.length ? ` · ${types.join('/')}` : ''}`,
    };
  }
  const error: ResolveErrorCode = isFailure(response)
    ? response.error
    : 'UNKNOWN';
  const label =
    isFailure(response) && response.contentType
      ? contentTypeLabel(response.contentType)
      : fallbackLabel;
  return {
    assets: [],
    downloadEnabled: false,
    ...(isFailure(response) && response.platform
      ? { platform: response.platform }
      : {}),
    message: `${platformPrefix(
      isFailure(response) ? response.platform : undefined,
    )}${label} failed · ${error}`,
  };
}

export type AssetDownloader = (asset: MediaAsset) => Promise<void>;

export interface AssetDownloadSummary {
  requested: number;
  failed: number;
}

/** Downloads assets sequentially through the reused downloader. */
export async function runAssetDownloads(
  assets: readonly MediaAsset[],
  download: AssetDownloader,
  pause: () => Promise<void> = () =>
    new Promise((resolve) => setTimeout(resolve, 350)),
): Promise<AssetDownloadSummary> {
  let requested = 0;
  let failed = 0;
  for (const [index, asset] of assets.entries()) {
    try {
      await download(asset);
      requested += 1;
    } catch {
      failed += 1;
    }
    if (assets.length > 1 && index < assets.length - 1) await pause();
  }
  return { requested, failed };
}

/** Distinguishes a download failure from a resolution/access failure. */
export function describeDownload(
  contentType: ExtensionContentType | undefined,
  summary: AssetDownloadSummary,
  platform?: ResolvePlatform,
): string {
  const label = `${platformPrefix(platform)}${contentTypeLabel(contentType)}`;
  if (summary.requested === 0)
    return `${label} not downloaded · DOWNLOAD_FAILED`;
  if (summary.failed === 0)
    return `${label} downloaded · ${summary.requested} asset(s)`;
  return `${label} partially downloaded · ${summary.requested}/${
    summary.requested + summary.failed
  } · DOWNLOAD_FAILED`;
}

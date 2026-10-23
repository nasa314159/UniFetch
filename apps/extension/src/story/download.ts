import { asUniFetchError, type MediaAsset } from '@unifetch/core';
import type { StoryFeasibilityStatus } from './contracts';

/**
 * M8C download status. Acquisition failures keep their typed Story status; a
 * download failure is DOWNLOAD_FAILED (or the downloader's typed
 * BROWSER_RESTRICTION) so it can never be mistaken for acquisition failure.
 */
export type StoryDownloadStatus =
  'DOWNLOADED' | 'DOWNLOAD_FAILED' | StoryFeasibilityStatus;

export interface StoryAcquisition {
  status: StoryFeasibilityStatus;
  asset?: MediaAsset;
  assetType?: 'image' | 'video';
}

export interface StoryDownloadOutcome {
  status: StoryDownloadStatus;
  assetType?: 'image' | 'video';
}

export type StoryAssetDownloader = (asset: MediaAsset) => Promise<void>;

/**
 * Resolves exactly one current Story, then feeds its single normalized asset
 * into the existing UniFetch downloader. `acquire` returns a typed outcome; an
 * acquisition failure is reported as-is and never triggers a download.
 */
export async function runStoryDownload(
  acquire: () => Promise<StoryAcquisition>,
  download: StoryAssetDownloader,
): Promise<StoryDownloadOutcome> {
  const acquisition = await acquire();
  const assetType = acquisition.assetType;
  if (acquisition.status !== 'SUCCESS' || !acquisition.asset)
    return {
      status:
        acquisition.status === 'SUCCESS'
          ? 'UNSUPPORTED_CONTENT'
          : acquisition.status,
      ...(assetType ? { assetType } : {}),
    };
  try {
    await download(acquisition.asset);
    return { status: 'DOWNLOADED', ...(assetType ? { assetType } : {}) };
  } catch (error) {
    return {
      status:
        asUniFetchError(error).code === 'BROWSER_RESTRICTION'
          ? 'BROWSER_RESTRICTION'
          : 'DOWNLOAD_FAILED',
      ...(assetType ? { assetType } : {}),
    };
  }
}

/**
 * Sanitized popup summary. Never contains a Story URL, Story id, username, CDN
 * host or any cookie/session value.
 */
export function describeStoryDownload(outcome: StoryDownloadOutcome): string {
  switch (outcome.status) {
    case 'DOWNLOADED':
      return outcome.assetType
        ? `Story downloaded · ${outcome.assetType}`
        : 'Story downloaded';
    case 'DOWNLOAD_FAILED':
      return 'Story not downloaded · DOWNLOAD_FAILED';
    case 'BROWSER_RESTRICTION':
      return 'Story not downloaded · BROWSER_RESTRICTION';
    default:
      return `Story not downloaded · ${outcome.status}`;
  }
}

import { invoke } from '@tauri-apps/api/core';
import {
  UniFetchError,
  parseSupportedUrl,
  type MediaAsset,
  type ResolveResult,
} from '@unifetch/core';
import {
  normalizeInstagramMedia,
  parseInstagramContentRef,
  parseInstagramMediaResponse,
} from '@unifetch/meta-resolver/instagram';
import {
  normalizeThreadsMedia,
  parseThreadsContentRef,
  parseThreadsSsrHtml,
} from '@unifetch/meta-resolver/threads';
import type {
  AppInfo,
  Diagnostic,
  InstagramFetch,
  PocErrorShape,
  SaveResult,
  SecurityReport,
  ThreadsFetch,
} from './contracts';

export type NativeSource = 'instagram-native' | 'threads-native';

export interface NativeResolution {
  source: NativeSource;
  kind: 'image';
  result: ResolveResult;
  diagnostics: Diagnostic[];
}

const INSTAGRAM_ORIGIN = 'https://www.instagram.com';
const THREADS_ORIGIN = 'https://www.threads.com';

function singleImageOnly(kind: string): void {
  if (kind !== 'image') {
    throw new UniFetchError(
      'UNSUPPORTED_CONTENT',
      'L2A validates one public single-image post only. Carousels, video, and GIF are out of scope.',
    );
  }
}

async function resolveInstagram(input: string): Promise<NativeResolution> {
  const ref = parseInstagramContentRef(input);
  const fetched = await invoke<InstagramFetch>('resolve_instagram', {
    shortcode: ref.shortcode,
    kind: ref.kind,
  });
  let raw: unknown;
  try {
    raw = JSON.parse(fetched.body);
  } catch {
    throw new UniFetchError(
      'PARSER_OUTDATED',
      'The native Instagram response was not valid JSON.',
    );
  }
  const media = parseInstagramMediaResponse(raw, ref.shortcode);
  singleImageOnly(media.kind);
  const normalized = normalizeInstagramMedia(media, ref.canonicalUrl);
  return {
    source: 'instagram-native',
    kind: 'image',
    result: {
      ...normalized,
      trace: {
        ...normalized.trace,
        processedLocally: true,
        remoteProxyUsed: false,
        metadataResolverUsed: false,
        mediaProxyUsed: false,
        credentialsExported: false,
        network: [{ origin: INSTAGRAM_ORIGIN, purpose: 'metadata' }],
      },
    },
    diagnostics: fetched.diagnostics,
  };
}

async function resolveThreads(input: string): Promise<NativeResolution> {
  const ref = parseThreadsContentRef(input);
  const fetched = await invoke<ThreadsFetch>('resolve_threads', {
    username: ref.username,
    shortcode: ref.shortcode,
  });
  if (
    fetched.finalShortcode !== ref.shortcode ||
    fetched.requestedShortcode !== ref.shortcode
  ) {
    throw new UniFetchError(
      'UNSUPPORTED_CONTENT',
      'The Threads response did not match the requested post.',
    );
  }
  // The final URL is the publisher Threads actually served. Re-parse it so the
  // existing parser checks the owner against the canonical served URL.
  const effectiveRef = parseThreadsContentRef(fetched.finalUrl);
  if (effectiveRef.shortcode !== ref.shortcode) {
    throw new UniFetchError(
      'UNSUPPORTED_CONTENT',
      'The Threads response did not match the requested post.',
    );
  }
  const media = parseThreadsSsrHtml(fetched.html, effectiveRef);
  singleImageOnly(media.kind);
  const normalized = normalizeThreadsMedia(media, effectiveRef.canonicalUrl);
  return {
    source: 'threads-native',
    kind: 'image',
    result: {
      ...normalized,
      trace: {
        ...normalized.trace,
        processedLocally: true,
        remoteProxyUsed: false,
        metadataResolverUsed: false,
        mediaProxyUsed: false,
        credentialsExported: false,
        network: [{ origin: THREADS_ORIGIN, purpose: 'metadata' }],
      },
    },
    diagnostics: fetched.diagnostics,
  };
}

/**
 * The local UI parses the user URL with the existing shared packages, calls a
 * typed native command with only the validated reference, and runs the existing
 * parser/normalizer over the bounded native response. No URL is sent to Rust and
 * no Worker origin is used.
 */
export async function resolveNative(input: string): Promise<NativeResolution> {
  const { url, platform } = parseSupportedUrl(input);
  if (url.protocol !== 'https:') {
    throw new UniFetchError(
      'INVALID_URL',
      'Use an HTTPS Instagram or Threads URL.',
    );
  }
  if (platform === 'instagram') return resolveInstagram(input);
  if (platform === 'threads') return resolveThreads(input);
  throw new UniFetchError(
    'UNSUPPORTED_PLATFORM',
    'This PoC supports Instagram and Threads only.',
  );
}

export async function saveNative(asset: MediaAsset): Promise<SaveResult> {
  if (asset.type !== 'image') {
    throw new UniFetchError(
      'UNSUPPORTED_CONTENT',
      'This PoC saves one image asset only.',
    );
  }
  return invoke<SaveResult>('save_media', {
    url: asset.url,
    suggestedFilename: asset.suggestedFilename,
  });
}

export function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>('app_info');
}

export function runSecuritySelfCheck(): Promise<SecurityReport> {
  return invoke<SecurityReport>('security_self_check');
}

export function toPocError(error: unknown): PocErrorShape {
  if (error instanceof UniFetchError) {
    return { code: error.code, message: error.message, stage: 'ui' };
  }
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error
  ) {
    const value = error as Record<string, unknown>;
    return {
      code: String(value.code),
      message: String(value.message),
      stage: String(value.stage ?? 'native'),
    };
  }
  return {
    code: 'UNKNOWN',
    message: 'Something went wrong. Please try again.',
    stage: 'ui',
  };
}

import { z } from 'zod';
export type Platform = 'instagram' | 'facebook' | 'threads';
export type MediaType = 'image' | 'video' | 'audio';
export interface Author {
  username?: string;
  displayName?: string;
  avatarUrl?: string;
}
export interface MediaAsset {
  id: string;
  type: MediaType;
  url: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  thumbnailUrl?: string;
  suggestedFilename: string;
}
export interface MetaPost {
  platform: Platform;
  id?: string;
  canonicalUrl: string;
  author?: Author;
  caption?: string;
  publishedAt?: string;
  assets: MediaAsset[];
}
export interface NetworkRecord {
  origin: string;
  purpose: 'source' | 'metadata' | 'media' | 'thumbnail';
}
export interface ResolutionTrace {
  processedLocally: boolean;
  remoteProxyUsed: boolean;
  credentialsExported: boolean;
  network: NetworkRecord[];
}
export interface ResolveResult {
  post: MetaPost;
  trace: ResolutionTrace;
}
export const errorCodes = [
  'INVALID_URL',
  'UNSUPPORTED_PLATFORM',
  'UNSUPPORTED_CONTENT',
  'CONTENT_UNAVAILABLE',
  'LOGIN_REQUIRED',
  'BROWSER_RESTRICTION',
  'RATE_LIMITED',
  'PARSER_OUTDATED',
  'NETWORK_ERROR',
  'UNKNOWN',
] as const;
export type ErrorCode = (typeof errorCodes)[number];
export class UniFetchError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'UniFetchError';
  }
}
export function asUniFetchError(error: unknown): UniFetchError {
  return error instanceof UniFetchError
    ? error
    : new UniFetchError('UNKNOWN', 'Something went wrong. Please try again.');
}
const hosts: Record<string, Platform> = {
  'instagram.com': 'instagram',
  'www.instagram.com': 'instagram',
  'm.instagram.com': 'instagram',
  'facebook.com': 'facebook',
  'www.facebook.com': 'facebook',
  'fb.watch': 'facebook',
  'threads.net': 'threads',
  'www.threads.net': 'threads',
  'threads.com': 'threads',
  'www.threads.com': 'threads',
};
const tracking = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'igsh',
];
const inputSchema = z.string().trim().min(1).max(8192);
export function parseSupportedUrl(input: string): {
  url: URL;
  platform: Platform;
} {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    throw new UniFetchError('INVALID_URL', 'Enter a valid Instagram URL.');
  let url: URL;
  try {
    url = new URL(parsed.data);
  } catch {
    throw new UniFetchError(
      'INVALID_URL',
      'Enter a complete URL starting with https:// or http://.',
    );
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new UniFetchError(
      'INVALID_URL',
      'Use an HTTP or HTTPS URL without credentials or a custom port.',
    );
  const platform = hosts[url.hostname];
  if (!platform)
    throw new UniFetchError(
      'UNSUPPORTED_PLATFORM',
      'This link is not from Instagram, Facebook, or Threads.',
    );
  url.hostname =
    platform === 'instagram'
      ? 'www.instagram.com'
      : platform === 'facebook' && url.hostname !== 'fb.watch'
        ? 'www.facebook.com'
        : platform === 'threads'
          ? url.hostname.endsWith('threads.net')
            ? 'www.threads.net'
            : 'www.threads.com'
          : url.hostname;
  url.hash = '';
  tracking.forEach((key) => url.searchParams.delete(key));
  return { url, platform };
}
export interface RuntimeRequest {
  url: string;
  method?: 'GET' | 'HEAD';
}
export interface RuntimeResponse {
  status: number;
  body: Uint8Array;
  contentType?: string;
}
export interface RuntimeCapabilities {
  downloads: boolean;
  crossOriginRequests: boolean;
}
export interface RuntimeAdapter {
  request(input: RuntimeRequest): Promise<RuntimeResponse>;
  download(asset: MediaAsset): Promise<void>;
  capabilities(): RuntimeCapabilities;
}
export interface ResolveContext {
  runtime: RuntimeAdapter;
}
export interface Resolver {
  readonly platform: Platform;
  match(url: URL): boolean;
  normalize(url: URL): URL;
  resolve(url: URL, context: ResolveContext): Promise<ResolveResult>;
}
export class ResolverRegistry {
  constructor(
    private readonly runtime: RuntimeAdapter,
    private readonly resolvers: readonly Resolver[],
  ) {}
  async resolve(input: string): Promise<ResolveResult> {
    const { url, platform } = parseSupportedUrl(input);
    const resolver = this.resolvers.find(
      (candidate) => candidate.platform === platform && candidate.match(url),
    );
    if (!resolver)
      throw new UniFetchError(
        'UNSUPPORTED_CONTENT',
        `${platform === 'facebook' ? 'Facebook' : 'Threads'} support is planned. Try an Instagram demo link.`,
      );
    return resolver.resolve(resolver.normalize(url), { runtime: this.runtime });
  }
}

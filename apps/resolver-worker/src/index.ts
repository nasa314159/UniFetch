import { z } from 'zod';
import {
  UniFetchError,
  asUniFetchError,
  type ResolverApiResponse,
  resolverApiResponseSchema,
} from '@unifetch/core';
import {
  parseInstagramContentRef,
  parseInstagramMediaResponse,
  normalizeInstagramMedia,
} from '@unifetch/meta-resolver/instagram';
import { CloudflareInstagramAcquisitionAdapter } from './acquisition';
import { CloudflareMetadataRuntime, type UpstreamFetch } from './runtime';
import { boundedBody } from './bounded-body';
import { type DiagnosticObserver } from './diagnostics';
export interface Env {
  ALLOWED_ORIGINS: string;
}
const requestSchema = z.object({ url: z.string().min(1).max(2048) }).strict();
function status(code: string): number {
  return code === 'RATE_LIMITED'
    ? 429
    : code === 'CONTENT_UNAVAILABLE'
      ? 404
      : code === 'LOGIN_REQUIRED'
        ? 403
        : [
              'INVALID_URL',
              'UNSUPPORTED_PLATFORM',
              'UNSUPPORTED_CONTENT',
            ].includes(code)
          ? 400
          : 502;
}
export function createWorker(
  fetcher: UpstreamFetch = fetch,
  observe?: DiagnosticObserver,
  inspect?: (raw: unknown) => void,
) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      const headers = new Headers({
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        Vary: 'Origin',
        'Content-Type': 'application/json',
      });
      const origin = request.headers.get('Origin');
      const allowed = (env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (origin && allowed.includes(origin)) {
        headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        headers.set('Access-Control-Allow-Headers', 'Content-Type');
      }
      const json = (
        body:
          | ResolverApiResponse
          | { ok: false; error: { code: string; message: string } },
        code = 200,
      ) => new Response(JSON.stringify(body), { status: code, headers });
      if (url.pathname !== '/api/resolve')
        return json(
          {
            ok: false,
            error: {
              code: 'UNSUPPORTED_CONTENT',
              message: 'Endpoint not found.',
            },
          },
          404,
        );
      if (origin && !allowed.includes(origin))
        return json(
          {
            ok: false,
            error: {
              code: 'UNSUPPORTED_CONTENT',
              message: 'This frontend origin is not allowed.',
            },
          },
          403,
        );
      if (request.method === 'OPTIONS') {
        if (
          request.headers.get('Access-Control-Request-Method') !== 'POST' ||
          (request.headers.get('Access-Control-Request-Headers') ?? '')
            .split(',')
            .some(
              (name) =>
                name.trim() && name.trim().toLowerCase() !== 'content-type',
            )
        )
          return json(
            {
              ok: false,
              error: {
                code: 'UNSUPPORTED_CONTENT',
                message: 'Unsupported preflight request.',
              },
            },
            400,
          );
        headers.delete('Content-Type');
        return new Response(null, { status: 204, headers });
      }
      if (request.method !== 'POST') {
        headers.set('Allow', 'POST, OPTIONS');
        return json(
          {
            ok: false,
            error: {
              code: 'UNSUPPORTED_CONTENT',
              message: 'Use POST /api/resolve.',
            },
          },
          405,
        );
      }
      try {
        if (
          url.search ||
          request.headers.has('Cookie') ||
          request.headers.has('Authorization')
        )
          throw new UniFetchError(
            'INVALID_URL',
            'Supply only one public URL in a JSON body, without credentials.',
          );
        if (
          request.headers
            .get('Content-Type')
            ?.split(';', 1)[0]
            .trim()
            .toLowerCase() !== 'application/json'
        )
          throw new UniFetchError(
            'INVALID_URL',
            'A JSON request body is required.',
          );
        const length = Number(request.headers.get('Content-Length') ?? 0);
        if (length > 4096)
          throw new UniFetchError(
            'INVALID_URL',
            'The request body is too large.',
          );
        const bytes = await boundedBody(request.body, 4096, 'INVALID_URL');
        let raw: unknown;
        try {
          raw = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          throw new UniFetchError(
            'INVALID_URL',
            'The JSON request body is invalid.',
          );
        }
        const parsed = requestSchema.safeParse(raw);
        if (!parsed.success)
          throw new UniFetchError(
            'INVALID_URL',
            'Supply exactly one public Instagram URL.',
          );
        const supplied = new URL(parsed.data.url);
        if (supplied.protocol !== 'https:')
          throw new UniFetchError('INVALID_URL', 'Use an HTTPS Instagram URL.');
        const ref = parseInstagramContentRef(parsed.data.url);
        if (supplied.hostname === 'm.instagram.com' && ref.kind !== 'post')
          throw new UniFetchError(
            'UNSUPPORTED_CONTENT',
            'Use the canonical Instagram host for Reels.',
          );
        const acquired =
          await new CloudflareInstagramAcquisitionAdapter().acquirePublicMedia(
            ref,
            { runtime: new CloudflareMetadataRuntime(fetcher, observe) },
          );
        inspect?.(acquired.raw);
        const parserStarted = Date.now();
        let media;
        try {
          media = parseInstagramMediaResponse(acquired.raw, ref.shortcode);
          observe?.({ stage: 'PARSER', elapsedMs: Date.now() - parserStarted });
        } catch (error) {
          observe?.({
            stage: 'PARSER',
            category: asUniFetchError(error).code,
            elapsedMs: Date.now() - parserStarted,
          });
          throw error;
        }
        const normalized = normalizeInstagramMedia(media, ref.canonicalUrl);
        const body = resolverApiResponseSchema.safeParse({
          ok: true,
          result: {
            post: normalized.post,
            trace: {
              processedLocally: false,
              remoteProxyUsed: true,
              metadataResolverUsed: true,
              mediaProxyUsed: false,
              credentialsExported: false,
              network: acquired.network,
            },
          },
          kind: media.kind,
          transport: {
            metadataResolver: 'unifetch-cloudflare-worker',
            mediaProxyUsed: false,
          },
        });
        if (!body.success)
          throw new UniFetchError(
            'PARSER_OUTDATED',
            'The metadata could not be normalized safely.',
          );
        return json(body.data);
      } catch (cause) {
        const error =
          cause instanceof TypeError
            ? new UniFetchError(
                'INVALID_URL',
                'The URL or request body is invalid.',
              )
            : asUniFetchError(cause);
        // Only safe typed diagnostics; never raw payloads, headers, cookies or stacks.
        return json(
          { ok: false, error: { code: error.code, message: error.message } },
          status(error.code),
        );
      }
    },
  };
}
export default createWorker();

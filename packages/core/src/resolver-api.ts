import { z } from 'zod';
const safeUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  });
const asset = z
  .object({
    id: z.string(),
    type: z.enum(['image', 'video']),
    url: safeUrl,
    mimeType: z.string().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    durationMs: z.number().nonnegative().optional(),
    thumbnailUrl: safeUrl.optional(),
    suggestedFilename: z.string(),
  })
  .strict();
export const resolverApiResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      result: z
        .object({
          post: z
            .object({
              platform: z.literal('instagram'),
              id: z.string().optional(),
              canonicalUrl: safeUrl,
              author: z
                .object({
                  username: z.string().optional(),
                  displayName: z.string().optional(),
                  avatarUrl: safeUrl.optional(),
                })
                .strict()
                .optional(),
              caption: z.string().optional(),
              publishedAt: z.string().optional(),
              assets: z.array(asset).min(1).max(100),
            })
            .strict(),
          trace: z
            .object({
              processedLocally: z.literal(false),
              remoteProxyUsed: z.literal(true),
              metadataResolverUsed: z.literal(true),
              mediaProxyUsed: z.literal(false),
              credentialsExported: z.literal(false),
              network: z.array(
                z
                  .object({
                    origin: safeUrl.refine(
                      (value) => new URL(value).origin === value,
                    ),
                    purpose: z.literal('metadata'),
                  })
                  .strict(),
              ),
            })
            .strict(),
        })
        .strict(),
      kind: z.enum(['image', 'video', 'carousel']),
      transport: z
        .object({
          metadataResolver: z.literal('unifetch-cloudflare-worker'),
          mediaProxyUsed: z.literal(false),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: z
        .object({
          code: z.enum([
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
          ]),
          message: z.string(),
        })
        .strict(),
    })
    .strict(),
]);
export type ResolverApiResponse = z.infer<typeof resolverApiResponseSchema>;

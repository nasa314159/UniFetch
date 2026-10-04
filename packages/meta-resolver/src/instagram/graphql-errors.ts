import type { ErrorCode } from '@unifetch/core';
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
const knownEnums = [
  'RATE_LIMITED',
  'LOGIN_REQUIRED',
  'AUTH_REQUIRED',
  'UNAUTHENTICATED',
  'CONTENT_UNAVAILABLE',
  'NOT_FOUND',
] as const;
type KnownEnum = (typeof knownEnums)[number];
type Failure = Extract<
  ErrorCode,
  | 'RATE_LIMITED'
  | 'LOGIN_REQUIRED'
  | 'CONTENT_UNAVAILABLE'
  | 'GRAPHQL_EXECUTION_ERROR'
  | 'UNKNOWN'
>;
/** No raw messages, arbitrary enums, identifiers or content escape this summary. */
export function inspectInstagramGraphql(raw: unknown): {
  dataPresent: boolean;
  dataNull: boolean;
  mediaRootExists: boolean;
  errorsPresent: boolean;
  errorCount: number;
  knownEnums: KnownEnum[];
  category?: Failure;
} {
  const root = object(raw);
  const media = object(root?.data)?.xdt_api__v1__media__shortcode__web_info;
  const mediaRootExists = media !== undefined && media !== null;
  const errors = Array.isArray(root?.errors) ? root.errors : [];
  const nodes = [root, ...errors.map(object)].filter(
    (node): node is Record<string, unknown> => !!node,
  );
  const enums = [
    ...new Set(
      nodes.flatMap((node) => {
        const extensions = object(node.extensions);
        return [
          node.code,
          node.type,
          extensions?.code,
          extensions?.type,
        ].filter((value): value is KnownEnum =>
          knownEnums.includes(value as KnownEnum),
        );
      }),
    ),
  ];
  const summary = {
    dataPresent: root?.data !== undefined && root?.data !== null,
    dataNull: root?.data === null,
    mediaRootExists,
    errorsPresent: !!root && Object.hasOwn(root, 'errors'),
    errorCount: errors.length,
    knownEnums: enums,
  };
  // Preserve usable partial media responses; the media parser owns their semantics.
  if (Array.isArray(object(media)?.items)) return summary;
  const messages = [
    ...nodes.map((node) => node.message),
    ...errors.filter((entry) => typeof entry === 'string'),
  ].filter((value): value is string => typeof value === 'string');
  let category: Failure | undefined;
  if (
    enums.includes('RATE_LIMITED') ||
    messages.some((message) =>
      /rate[\s_-]*limit|too many requests/i.test(message),
    )
  )
    category = 'RATE_LIMITED';
  else if (
    nodes.some(
      (node) => node.require_login === true || node.login_required === true,
    ) ||
    enums.some((value) =>
      ['LOGIN_REQUIRED', 'AUTH_REQUIRED', 'UNAUTHENTICATED'].includes(value),
    ) ||
    messages.some((message) =>
      /login[\s_-]*required|log[\s_-]*in (?:is )?required|authentication (?:is )?required|auth[\s_-]*required|must (?:log[\s_-]*in|authenticate|be logged in)|please log[\s_-]*in|not authenticated|requires authentication/i.test(
        message,
      ),
    )
  )
    category = 'LOGIN_REQUIRED';
  else if (
    enums.some((value) =>
      ['CONTENT_UNAVAILABLE', 'NOT_FOUND'].includes(value),
    ) ||
    messages.some((message) =>
      /(?:media|content|post) (?:is |was )?(?:not found|unavailable)/i.test(
        message,
      ),
    )
  )
    category = 'CONTENT_UNAVAILABLE';
  else if (
    errors.length ||
    (summary.errorsPresent && !Array.isArray(root?.errors))
  )
    category = 'GRAPHQL_EXECUTION_ERROR';
  else if (!mediaRootExists) category = 'UNKNOWN';
  return { ...summary, ...(category ? { category } : {}) };
}

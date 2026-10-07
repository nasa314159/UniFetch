/**
 * M8A sanitized result model. Every field is deliberately non-identifying:
 * no shortcode, username, caption, media URL, post URL, cookie or session data.
 */
export type AuthenticatedStrategy =
  'isolated-content-script' | 'main-world' | 'background-fetch';

export type AuthenticatedStrategyStatus =
  | 'SUCCESS'
  | 'HTTP_ERROR'
  | 'LOGIN_REQUIRED'
  | 'GRAPHQL_EXECUTION_ERROR'
  | 'PARSER_OUTDATED'
  | 'NETWORK_ERROR'
  | 'BROWSER_RESTRICTION'
  | 'UNKNOWN';

export type AuthenticatedResponseKind = 'JSON' | 'HTML' | 'EMPTY';

export interface AuthenticatedStrategyResult {
  strategy: AuthenticatedStrategy;
  status: AuthenticatedStrategyStatus;
  httpStatus?: number;
  responseKind?: AuthenticatedResponseKind;
  assetCount?: number;
  assetTypes?: ('image' | 'video')[];
}

/**
 * Request parameters handed to an injected acquisition context. Never contains
 * a Cookie named header; the ctx's own credentials are attached by the browser.
 */
export interface InjectedRequestInput {
  endpoint: string;
  body: string;
  headers: Record<string, string>;
  csrfHeader: string;
  csrfToken?: string;
}

export type StrategyFetchError = 'NETWORK_ERROR' | 'BROWSER_RESTRICTION';

/** Raw outcome produced by an injected context or the background service worker. */
export interface RawStrategyOutcome {
  reached: boolean;
  httpStatus: number;
  responseKind: AuthenticatedResponseKind;
  contentType?: string;
  jsonText?: string;
  redirected?: boolean;
  error?: StrategyFetchError;
  csrfUsed: boolean;
}

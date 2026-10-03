/** Internal opt-in observations. No messages, bodies, URLs or session values. */
export type DiagnosticStage =
  | 'BOOTSTRAP_REQUEST'
  | 'BOOTSTRAP_RESPONSE'
  | 'SESSION_EXTRACTION'
  | 'GRAPHQL_REQUEST'
  | 'GRAPHQL_RESPONSE'
  | 'RESPONSE_READ'
  | 'PARSER';
export interface DiagnosticRecord {
  stage: DiagnosticStage;
  fetchThrew?: boolean;
  exceptionName?: string;
  category?: string;
  status?: number;
  contentType?: string;
  redirected?: boolean;
  redirectHostname?: string;
  setCookiePresent?: boolean;
  csrfTokenFound?: boolean;
  bodyKind?: 'JSON' | 'HTML' | 'EMPTY' | 'OTHER';
  byteLength?: number;
  elapsedMs: number;
}
export type DiagnosticObserver = (record: DiagnosticRecord) => void;
export function exceptionDetails(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  // Inspect transiently, but return only closed categories, never the message.
  const category =
    /illegal invocation|incorrect this|incompatible receiver|called on an object that does not implement/i.test(
      message,
    )
      ? 'RUNTIME_BINDING_ERROR'
      : /(?:cache|credentials|requestinit|request initializer).*(?:not implemented|unsupported|not supported|invalid)|unsupported.*(?:cache|credentials)/i.test(
            message,
          )
        ? 'FETCH_CONFIGURATION_ERROR'
        : /abort|timed? ?out|timeout/i.test(name + ' ' + message)
          ? 'TIMEOUT'
          : /certificate|ssl|tls/i.test(message)
            ? 'TLS_FAILURE'
            : /dns|resolve host|ENOTFOUND/i.test(message)
              ? 'DNS_FAILURE'
              : /connect|socket|reset|ECONN|terminated/i.test(message)
                ? 'CONNECTION_FAILURE'
                : 'UNCLASSIFIED_EXCEPTION';
  return {
    exceptionName: [
      'Error',
      'TypeError',
      'AbortError',
      'TimeoutError',
      'RangeError',
      'SyntaxError',
      'DOMException',
    ].includes(name)
      ? name
      : 'Error',
    category,
  };
}
export function responseDetails(response: Response) {
  const rawType = response.headers.get('content-type') ?? '';
  const mime = rawType.split(';', 1)[0].trim().toLowerCase();
  // Do not copy arbitrary upstream header values into observations.
  const contentType = [
    'application/json',
    'text/json',
    'text/html',
    'text/plain',
    'application/octet-stream',
  ].includes(mime)
    ? mime
    : 'other';
  const location = response.headers.get('location');
  let redirectHostname: string | undefined;
  if (location) {
    try {
      redirectHostname = new URL(location, 'https://www.instagram.com/')
        .hostname;
    } catch {
      /* No raw location in diagnostics. */
    }
  }
  return {
    status: response.status,
    contentType,
    redirected:
      response.redirected || (response.status >= 300 && response.status < 400),
    ...(redirectHostname ? { redirectHostname } : {}),
    setCookiePresent: response.headers.has('set-cookie'),
  };
}
export function bodyDetails(body: Uint8Array) {
  const prefix = new TextDecoder().decode(body.subarray(0, 256)).trimStart();
  const bodyKind: DiagnosticRecord['bodyKind'] =
    body.length === 0
      ? 'EMPTY'
      : /^[{[]/.test(prefix)
        ? 'JSON'
        : prefix.startsWith('<')
          ? 'HTML'
          : 'OTHER';
  return { bodyKind, byteLength: body.length };
}

export function fetchErrorCode(error: unknown): 'UNKNOWN' | 'NETWORK_ERROR' {
  return ['RUNTIME_BINDING_ERROR', 'FETCH_CONFIGURATION_ERROR'].includes(
    exceptionDetails(error).category,
  )
    ? 'UNKNOWN'
    : 'NETWORK_ERROR';
}

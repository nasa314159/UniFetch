import { parseSupportedUrl } from '@unifetch/core';
export interface SharedPayload {
  title?: string;
  text?: string;
  url?: string;
}
function supported(candidate: string): string | null {
  try {
    return parseSupportedUrl(candidate).url.href;
  } catch {
    return null;
  }
}
function embedded(text?: string): string | null {
  for (const match of (text ?? '').matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    // Avoid extracting an HTTP URL nested inside an unsafe scheme.
    const prefix = (text ?? '').slice(0, match.index);
    if (/[^\s]*:.*$/.test(prefix.split(/\s/).pop() ?? '')) continue;
    const url = supported(match[0].replace(/[.,!?;:)\]}]+$/, ''));
    if (url) return url;
  }
  return null;
}
export function parseSharedPayload(payload: SharedPayload): string | null {
  return (
    (payload.url ? supported(payload.url) : null) ??
    embedded(payload.text) ??
    embedded(payload.title)
  );
}

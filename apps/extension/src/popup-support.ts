import { parseExtensionTarget, parseInstagramTarget } from './target';

/**
 * M8C/M8D/E1 popup support. Pure, DOM-free helpers for the manual URL input and
 * the explicit-click clipboard paste. No value is persisted or logged.
 */
export type ManualContentKind =
  'post' | 'reel' | 'story' | 'story-profile' | 'share';

export interface ManualTarget {
  platform: 'instagram' | 'threads';
  kind: ManualContentKind;
  canonicalUrl: string;
}

/** @deprecated Instagram-only shape kept for the existing Instagram tests. */
export interface ManualInstagramTarget {
  kind: ManualContentKind;
  canonicalUrl: string;
}

function parseManual(input: string | undefined): ManualTarget | undefined {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value) return undefined;
  const target = parseExtensionTarget(value);
  if (!target) return undefined;
  return {
    platform: target.platform,
    kind: target.kind,
    canonicalUrl: target.canonicalUrl,
  };
}

/**
 * Validates a manually typed/pasted URL with the shared UniFetch parsers.
 * Instagram Post/Reel/Story and Threads post/share shapes are accepted;
 * anything else is rejected before any request.
 */
export function parseManualUrl(
  input: string | undefined,
): ManualTarget | undefined {
  return parseManual(input);
}

/**
 * Instagram-only manual parser retained for existing callers/tests. It never
 * changes the Instagram acceptance rules.
 */
export function parseManualInstagramUrl(
  input: string | undefined,
): ManualInstagramTarget | undefined {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value) return undefined;
  const target = parseInstagramTarget(value);
  if (!target) return undefined;
  return { kind: target.kind, canonicalUrl: target.canonicalUrl };
}

/** Manual input wins; otherwise fall back to the active-tab URL. */
export function resolveTargetUrl(
  manual: string | undefined,
  tabUrl: string | undefined,
): string | undefined {
  const value = typeof manual === 'string' ? manual.trim() : '';
  if (value) return value;
  return typeof tabUrl === 'string' && tabUrl ? tabUrl : undefined;
}

export function isManualTarget(manual: string | undefined): boolean {
  return typeof manual === 'string' && manual.trim().length > 0;
}

/** Minimal structural clipboard surface so tests need no real clipboard. */
export interface ClipboardReader {
  readText(): Promise<string>;
}

/**
 * Reads the first text item, only when called from an explicit user gesture.
 * Any failure returns undefined so the caller can show a sanitized error.
 */
export async function readClipboardText(
  clipboard: ClipboardReader | undefined,
): Promise<string | undefined> {
  if (!clipboard) return undefined;
  try {
    const text = await clipboard.readText();
    return typeof text === 'string' && text.trim() ? text : undefined;
  } catch {
    return undefined;
  }
}

import {
  parseInstagramContentRef,
  type InstagramContentRef,
} from '@unifetch/meta-resolver/instagram';
import {
  parseThreadsContentRef,
  parseThreadsShareRef,
  type ThreadsContentRef,
  type ThreadsShareRef,
} from '@unifetch/meta-resolver/threads';
import {
  parseInstagramProfileStoryRef,
  parseInstagramStoryRef,
  type InstagramProfileStoryRef,
  type InstagramStoryRef,
} from './story/ref';

/**
 * Single dispatch point for a manual or tab URL. Instagram Post/Reel/Story
 * parsing is unchanged; Threads reuses the shared content-ref and share-ref
 * parsers. Facebook is intentionally not accepted here.
 */
export type InstagramTarget =
  | {
      platform: 'instagram';
      kind: 'post' | 'reel';
      ref: InstagramContentRef;
      canonicalUrl: string;
    }
  | {
      platform: 'instagram';
      kind: 'story';
      ref: InstagramStoryRef;
      canonicalUrl: string;
    }
  | {
      platform: 'instagram';
      kind: 'story-profile';
      ref: InstagramProfileStoryRef;
      canonicalUrl: string;
    };

export type ThreadsTarget =
  | {
      platform: 'threads';
      kind: 'post';
      ref: ThreadsContentRef;
      canonicalUrl: string;
    }
  | {
      platform: 'threads';
      kind: 'share';
      ref: ThreadsShareRef;
      canonicalUrl: string;
    };

export type ExtensionTarget = InstagramTarget | ThreadsTarget;

export function parseInstagramTarget(
  input: string,
): InstagramTarget | undefined {
  try {
    const ref = parseInstagramContentRef(input);
    return {
      platform: 'instagram',
      kind: ref.kind,
      ref,
      canonicalUrl: ref.canonicalUrl,
    };
  } catch {
    // not a post/reel; try Story shapes
  }
  try {
    const ref = parseInstagramStoryRef(input);
    return {
      platform: 'instagram',
      kind: 'story',
      ref,
      canonicalUrl: ref.canonicalUrl,
    };
  } catch {
    // not an explicit Story URL; try a username-level Story URL
  }
  try {
    const ref = parseInstagramProfileStoryRef(input);
    return {
      platform: 'instagram',
      kind: 'story-profile',
      ref,
      canonicalUrl: ref.canonicalUrl,
    };
  } catch {
    return undefined;
  }
}

/**
 * Accepts one canonical public Threads permalink or one official share link.
 * Unsupported Threads paths (profiles, search, `/t/`) remain unparsed so the
 * caller can classify them as unsupported content rather than a foreign URL.
 */
export function parseThreadsTarget(input: string): ThreadsTarget | undefined {
  try {
    const ref = parseThreadsContentRef(input);
    return {
      platform: 'threads',
      kind: 'post',
      ref,
      canonicalUrl: ref.canonicalUrl,
    };
  } catch {
    // not a canonical post; try the official share-link shape
  }
  try {
    const ref = parseThreadsShareRef(input);
    return {
      platform: 'threads',
      kind: 'share',
      ref,
      canonicalUrl: ref.canonicalShareUrl,
    };
  } catch {
    return undefined;
  }
}

export function parseExtensionTarget(
  input: string,
): ExtensionTarget | undefined {
  return parseInstagramTarget(input) ?? parseThreadsTarget(input);
}

export function firstInstagramTarget(
  inputs: readonly (string | undefined)[],
): InstagramTarget | undefined {
  for (const input of inputs) {
    if (!input) continue;
    const target = parseInstagramTarget(input);
    if (target) return target;
  }
  return undefined;
}

/** Ordered platform-aware dispatch for a manual URL or active-tab candidates. */
export function firstExtensionTarget(
  inputs: readonly (string | undefined)[],
): ExtensionTarget | undefined {
  for (const input of inputs) {
    if (!input) continue;
    const target = parseExtensionTarget(input);
    if (target) return target;
  }
  return undefined;
}

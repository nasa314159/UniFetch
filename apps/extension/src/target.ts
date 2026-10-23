import {
  parseInstagramContentRef,
  type InstagramContentRef,
} from '@unifetch/meta-resolver/instagram';
import {
  parseInstagramProfileStoryRef,
  parseInstagramStoryRef,
  type InstagramProfileStoryRef,
  type InstagramStoryRef,
} from './story/ref';

/**
 * M8D single dispatch point for a manual or tab Instagram URL. Reuses the
 * existing Post/Reel content-ref parser and the Story ref parsers; no parsing
 * logic is duplicated. Facebook/Threads are intentionally not accepted here.
 */
export type InstagramTarget =
  | { kind: 'post' | 'reel'; ref: InstagramContentRef; canonicalUrl: string }
  | { kind: 'story'; ref: InstagramStoryRef; canonicalUrl: string }
  | {
      kind: 'story-profile';
      ref: InstagramProfileStoryRef;
      canonicalUrl: string;
    };

export function parseInstagramTarget(
  input: string,
): InstagramTarget | undefined {
  try {
    const ref = parseInstagramContentRef(input);
    return { kind: ref.kind, ref, canonicalUrl: ref.canonicalUrl };
  } catch {
    // not a post/reel; try Story shapes
  }
  try {
    const ref = parseInstagramStoryRef(input);
    return { kind: 'story', ref, canonicalUrl: ref.canonicalUrl };
  } catch {
    // not an explicit Story URL; try a username-level Story URL
  }
  try {
    const ref = parseInstagramProfileStoryRef(input);
    return { kind: 'story-profile', ref, canonicalUrl: ref.canonicalUrl };
  } catch {
    return undefined;
  }
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

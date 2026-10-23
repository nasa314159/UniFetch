import type { MediaAsset } from '@unifetch/core';
import type {
  MseSource,
  StoryFeasibilityResult,
  StorySource,
  ViewerShape,
  VisibleMediaDiagnostic,
} from './contracts';
import {
  createStoryFilename,
  type StoryFilenameMetadata,
  type StoryProgressSegment,
} from './filename';

/**
 * M8C first-load fallback. When `/stories/<username>/` does not yet expose a
 * Story id, only the currently visible Story viewer is inspected to derive at
 * most ONE media asset. No sibling/hidden Story media, tray, enumeration,
 * cookies, storage or persistence are involved.
 */
export type StoryMediaKind = 'image' | 'video';

export interface StoryMediaRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

/** One candidate media element as observed in the live Story viewer. */
export interface StoryMediaDescriptor {
  kind: StoryMediaKind;
  url: string;
  width: number;
  height: number;
  rect: StoryMediaRect;
  /** False when display/visibility/opacity hides the element. */
  styleVisible: boolean;
  /** False when the element is outside the active Story viewer subtree. */
  inViewer: boolean;
}

export interface StoryViewport {
  width: number;
  height: number;
}

export interface StoryViewerContext {
  viewerFound: boolean;
  /** Sanitized viewer-shape diagnostic. */
  shape: ViewerShape;
  viewport: StoryViewport;
  media: StoryMediaDescriptor[];
  /**
   * Count of currently visible Story videos whose only sources are `blob:`
   * (e.g. MSE). Reported as a typed limitation; never downloaded.
   */
  blobVideos: number;
  /** Sanitized MSE/source classification for the current video, if any. */
  mseSource?: MseSource;
  /** Best-effort audio presence for the current video. */
  audioPresent?: boolean | 'unknown';
  /** Observed progress segments; index is derived only if unambiguous. */
  progress: { segments: StoryProgressSegment[] };
  /** A reliable DOM `datetime` value for the current Story, if present. */
  publishedAt?: string;
}

export type StoryMediaSelection =
  | {
      ok: true;
      kind: StoryMediaKind;
      url: string;
      width?: number;
      height?: number;
    }
  | {
      ok: false;
      reason:
        'no-viewer' | 'no-visible-media' | 'ambiguous-media' | 'video-blob';
    };

const MIN_DIMENSION = 160;
const MIN_VISIBLE_FRACTION = 0.6;
// A centered Story media element; edge previews/avatars fall outside this band.
const CENTER_BAND = [0.25, 0.75] as const;

function isHttpUrl(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function visibleFraction(
  rect: StoryMediaRect,
  viewport: StoryViewport,
): number {
  const area = (rect.right - rect.left) * (rect.bottom - rect.top);
  if (area <= 0) return 0;
  const intersectX = Math.max(
    0,
    Math.min(rect.right, viewport.width) - Math.max(rect.left, 0),
  );
  const intersectY = Math.max(
    0,
    Math.min(rect.bottom, viewport.height) - Math.max(rect.top, 0),
  );
  return (intersectX * intersectY) / area;
}

/**
 * Geometry/visibility accept/reject for one observed element, independent of
 * its URL scheme. This is the active-Viewer gate: only a media element that is
 * visible, inside the active viewer, sufficiently large and centered counts.
 * A hidden, offscreen, preloaded or sibling element fails here and can never
 * influence the selection.
 */
export function isActiveStoryMedia(
  descriptor: StoryMediaDescriptor,
  viewport: StoryViewport,
): boolean {
  if (!descriptor.styleVisible || !descriptor.inViewer) return false;
  if (descriptor.width < MIN_DIMENSION || descriptor.height < MIN_DIMENSION)
    return false;
  if (visibleFraction(descriptor.rect, viewport) < MIN_VISIBLE_FRACTION)
    return false;
  const centerX = (descriptor.rect.left + descriptor.rect.right) / 2;
  if (
    centerX < viewport.width * CENTER_BAND[0] ||
    centerX > viewport.width * CENTER_BAND[1]
  )
    return false;
  return true;
}

/** Active AND directly downloadable (http/https). */
export function isViableStoryMedia(
  descriptor: StoryMediaDescriptor,
  viewport: StoryViewport,
): boolean {
  return isActiveStoryMedia(descriptor, viewport) && isHttpUrl(descriptor.url);
}

function dedupeByUrl(
  descriptors: readonly StoryMediaDescriptor[],
): StoryMediaDescriptor[] {
  const seen = new Set<string>();
  return descriptors.filter((descriptor) => {
    if (seen.has(descriptor.url)) return false;
    seen.add(descriptor.url);
    return true;
  });
}

/**
 * Selects exactly one currently visible Story media element.
 *
 * Only ACTIVE media participates: hidden, offscreen, preloaded, tray and
 * adjacent/sibling Story elements fail the active gate and are ignored.
 *
 * Classification:
 * - exactly one active direct-http video → video (preferred over any cover).
 * - no active direct-http video but an active blob-only/MSE video → the current
 *   Story is an image+music video composite; never downgrade it to its still
 *   cover image, report the typed `video-blob` limitation instead.
 * - otherwise exactly one active http image → image.
 * - zero → no visible media; many active images/videos → ambiguous.
 */
export function selectVisibleStoryMedia(
  descriptors: readonly StoryMediaDescriptor[],
  viewport: StoryViewport,
  viewerFound: boolean,
): StoryMediaSelection {
  if (!viewerFound) return { ok: false, reason: 'no-viewer' };
  const active = descriptors.filter((descriptor) =>
    isActiveStoryMedia(descriptor, viewport),
  );
  const videos = dedupeByUrl(active.filter((item) => item.kind === 'video'));
  const httpVideos = videos.filter((video) => isHttpUrl(video.url));
  const images = dedupeByUrl(
    active.filter((item) => item.kind === 'image' && isHttpUrl(item.url)),
  );
  if (httpVideos.length > 1) return { ok: false, reason: 'ambiguous-media' };
  if (httpVideos.length === 1) {
    const [video] = httpVideos;
    return {
      ok: true,
      kind: 'video',
      url: video.url,
      width: video.width,
      height: video.height,
    };
  }
  // An ACTIVE video whose only source is blob:/MSE represents the current Story
  // (image + music composite). Never downgrade it to the still cover image. A
  // hidden/offscreen/preloaded blob video fails the active gate above and is not
  // counted here, so it can never suppress a genuinely active image.
  if (videos.length > 0) return { ok: false, reason: 'video-blob' };
  if (images.length === 0) return { ok: false, reason: 'no-visible-media' };
  if (images.length > 1) return { ok: false, reason: 'ambiguous-media' };
  const [image] = images;
  return {
    ok: true,
    kind: 'image',
    url: image.url,
    width: image.width,
    height: image.height,
  };
}

/**
 * Sanitized diagnostic of the currently visible Story media, distinguishing a
 * usable http(s) image/video from a `blob:`-only video. Never a URL.
 */
export function classifyVisibleMedia(
  selection: StoryMediaSelection,
  blobVideos: number,
): VisibleMediaDiagnostic {
  if (selection.ok)
    return selection.kind === 'video' ? 'video-http' : 'image-http';
  if (selection.reason === 'video-blob') return 'video-blob';
  if (selection.reason === 'ambiguous-media') return 'ambiguous';
  if (blobVideos > 0) return 'video-blob';
  return 'none';
}

/**
 * Classifies the current video's loaded source without exposing URLs:
 * - `direct-http-video`: a complete http(s) video source is available.
 * - `segmented-media`: only MSE/segmented resources (e.g. `.m4s`/`.ts`) appear.
 * - `blob-only`: a `blob:` source with no complete/segmented resource evidence.
 * - `unknown`: no usable signal.
 */
export function classifyMseSource(input: {
  videoSources: readonly string[];
  resourceNames: readonly string[];
}): MseSource {
  const isHttp = (value: string): boolean => /^https?:\/\//i.test(value);
  const isComplete = (value: string): boolean =>
    /\.(mp4|m4v|webm|mov)(?:[?#]|$)/i.test(value);
  const isSegment = (value: string): boolean =>
    /\.(m4s|ts)(?:[?#]|$)/i.test(value) ||
    /[?&]bytestart=|[?&]byteend=|\/segment/i.test(value);
  if (input.videoSources.some(isHttp)) return 'direct-http-video';
  if (input.resourceNames.some(isSegment)) return 'segmented-media';
  if (input.videoSources.some((value) => value.startsWith('blob:')))
    return input.resourceNames.some(isComplete)
      ? 'direct-http-video'
      : 'blob-only';
  if (input.resourceNames.some(isComplete)) return 'direct-http-video';
  return 'unknown';
}

/** Pure decision mirror of the resolver flow, for trace and tests. */
export function chooseStorySource(input: {
  hasExplicitId: boolean;
  hasProfileRef: boolean;
  hasCurrentId: boolean;
  hasVisibleMedia: boolean;
}): StorySource | 'unsupported' {
  if (input.hasExplicitId) return 'explicit-id-url';
  if (input.hasProfileRef && input.hasCurrentId) return 'explicit-id-url';
  if (input.hasProfileRef && input.hasVisibleMedia)
    return 'visible-current-media';
  return 'unsupported';
}

/** Minimal existing MediaAsset shape fed to the reused downloader. */
export function visibleStoryMediaToAsset(
  selection: Extract<StoryMediaSelection, { ok: true }>,
  metadata: StoryFilenameMetadata = {},
): MediaAsset {
  return {
    id: 'story_visible',
    type: selection.kind,
    url: selection.url,
    ...(selection.width !== undefined ? { width: selection.width } : {}),
    ...(selection.height !== undefined ? { height: selection.height } : {}),
    suggestedFilename: createStoryFilename(metadata, selection.kind),
  };
}

/** Sanitized result for the visible-current-media path; carries no URL. */
export function visibleStoryResult(
  kind: StoryMediaKind,
  diagnostics: {
    visibleMedia?: VisibleMediaDiagnostic;
    viewerShape?: ViewerShape;
    mseSource?: MseSource;
    audioPresent?: boolean | 'unknown';
    mseReason?: 'MSE_MEDIA_UNAVAILABLE';
  } = {},
): StoryFeasibilityResult {
  return {
    status: 'SUCCESS',
    itemCount: 1,
    assetTypes: [kind],
    acquisitionContext: 'background',
    storySource: 'visible-current-media',
    ...diagnostics,
  };
}

/**
 * Injected into the page (MAIN world) as `func`. Self-contained: it must not
 * close over module scope and never touches cookies, storage or other origins.
 * It only reads the currently rendered Story viewer and returns at most one
 * descriptor per visible media element for the pure selector above. A visible
 * video also exposes its http(s) `src`/`<source>` if MSE shadows `currentSrc`
 * with a `blob:`.
 */
export function collectStoryViewerContextFunction(): StoryViewerContext {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const dialog = document.querySelector('[role="dialog"]');
  const pathIsStory = /^\/stories\//.test(location.pathname);
  let root: ParentNode | null = null;
  let shape: ViewerShape = 'other';
  if (dialog) {
    root = dialog;
    shape = 'dialog';
  } else if (pathIsStory && document.body) {
    root = document.body;
    shape = 'document-story-viewer';
  }
  if (!root || !(root as Element).isConnected)
    return {
      viewerFound: false,
      shape: 'other',
      viewport,
      media: [],
      blobVideos: 0,
      progress: { segments: [] },
    };
  const httpUrl = (value: string | null | undefined): value is string => {
    if (!value) return false;
    try {
      const url = new URL(value, location.href);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  };
  const styleVisible = (element: Element): boolean => {
    // `checkVisibility` accounts for the element AND its ancestors (display,
    // visibility and, with checkOpacity, transparent subtree containers). This
    // is what excludes a preloaded/adjacent Story video hidden by an ancestor
    // while still returning a full-size bounding rect.
    try {
      const check = (
        element as Element & {
          checkVisibility?: (options?: {
            checkOpacity?: boolean;
            checkVisibilityCSS?: boolean;
          }) => boolean;
        }
      ).checkVisibility;
      if (typeof check === 'function')
        return element.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
        });
    } catch {
      // fall through to the manual ancestor walk
    }
    for (let node: Element | null = element; node; node = node.parentElement) {
      try {
        const style = getComputedStyle(node);
        if (style.display === 'none') return false;
        if (style.visibility === 'hidden' || style.visibility === 'collapse')
          return false;
        if (Number(style.opacity) === 0) return false;
        if (style.contentVisibility === 'hidden') return false;
      } catch {
        return false;
      }
    }
    return true;
  };
  const withinViewer = (element: Element): boolean => {
    if (dialog && !dialog.contains(element)) return false;
    if (
      element.closest(
        'header, nav, [role="banner"], [role="navigation"], [role="toolbar"]',
      )
    )
      return false;
    return true;
  };
  const fraction = (rect: DOMRect): number => {
    const area = rect.width * rect.height;
    if (area <= 0) return 0;
    const ix = Math.max(
      0,
      Math.min(rect.right, viewport.width) - Math.max(rect.left, 0),
    );
    const iy = Math.max(
      0,
      Math.min(rect.bottom, viewport.height) - Math.max(rect.top, 0),
    );
    return (ix * iy) / area;
  };
  const passesGate = (rect: DOMRect): boolean => {
    if (fraction(rect) < 0.6) return false;
    const centerX = (rect.left + rect.right) / 2;
    return centerX >= viewport.width * 0.25 && centerX <= viewport.width * 0.75;
  };
  const candidateUrls = (
    element: Element,
    kind: 'video' | 'image',
  ): string[] => {
    const node = element as HTMLVideoElement & HTMLImageElement;
    const urls: string[] = [];
    if (node.currentSrc) urls.push(node.currentSrc);
    const src = element.getAttribute('src');
    if (src) urls.push(src);
    if (kind === 'video')
      for (const source of Array.from(element.querySelectorAll('source'))) {
        const value = source.getAttribute('src');
        if (value) urls.push(value);
      }
    else {
      const srcset = element.getAttribute('srcset') ?? '';
      for (const part of srcset.split(',')) {
        const token = part.trim().split(/\s+/)[0];
        if (token) urls.push(token);
      }
    }
    return urls;
  };
  const isHttpSource = (value: string): boolean => /^https?:\/\//i.test(value);
  const isCompleteSource = (value: string): boolean =>
    /\.(mp4|m4v|webm|mov)(?:[?#]|$)/i.test(value);
  const isSegmentSource = (value: string): boolean =>
    /\.(m4s|ts)(?:[?#]|$)/i.test(value) ||
    /[?&]bytestart=|[?&]byteend=|\/segment/i.test(value);
  const classifySource = (
    sources: readonly string[],
    resources: readonly string[],
  ): MseSource => {
    if (sources.some(isHttpSource)) return 'direct-http-video';
    if (resources.some(isSegmentSource)) return 'segmented-media';
    if (sources.some((value) => value.startsWith('blob:')))
      return resources.some(isCompleteSource)
        ? 'direct-http-video'
        : 'blob-only';
    if (resources.some(isCompleteSource)) return 'direct-http-video';
    return 'unknown';
  };
  const audioOf = (video: HTMLVideoElement): boolean | 'unknown' => {
    try {
      const extended = video as HTMLVideoElement & {
        mozHasAudio?: boolean;
        webkitAudioDecodedByteCount?: number;
        audioTracks?: { length: number };
        captureStream?: () => MediaStream;
      };
      if (typeof extended.mozHasAudio === 'boolean')
        return extended.mozHasAudio;
      if (typeof extended.webkitAudioDecodedByteCount === 'number')
        return extended.webkitAudioDecodedByteCount > 0;
      if (
        extended.audioTracks &&
        typeof extended.audioTracks.length === 'number'
      )
        return extended.audioTracks.length > 0;
      if (typeof extended.captureStream === 'function') {
        const stream = extended.captureStream();
        const hasAudio = stream.getAudioTracks().length > 0;
        for (const track of stream.getTracks()) track.stop();
        return hasAudio;
      }
    } catch {
      // ignore
    }
    return 'unknown';
  };
  const media: StoryMediaDescriptor[] = [];
  let blobVideos = 0;
  let firstVideo: HTMLVideoElement | undefined;
  let firstVideoSources: string[] = [];
  for (const element of Array.from(root.querySelectorAll('video, img'))) {
    const kind = element.tagName.toLowerCase() === 'video' ? 'video' : 'image';
    if (!styleVisible(element) || !withinViewer(element)) continue;
    const rect = element.getBoundingClientRect();
    if (!passesGate(rect)) continue;
    const urls = candidateUrls(element, kind);
    if (kind === 'video' && !firstVideo) {
      firstVideo = element as HTMLVideoElement;
      firstVideoSources = urls;
    }
    const url = urls.find((value) => httpUrl(value));
    if (!url && kind === 'image') continue;
    const node = element as HTMLVideoElement & HTMLImageElement;
    const width = Math.round(
      kind === 'video'
        ? node.videoWidth || rect.width
        : node.naturalWidth || rect.width,
    );
    const height = Math.round(
      kind === 'video'
        ? node.videoHeight || rect.height
        : node.naturalHeight || rect.height,
    );
    if (!url) {
      // An ACTIVE video with no direct http(s) source is a blob:/MSE current
      // Story (e.g. an image + music composite). Expose it as a descriptor so
      // the pure selector can refuse to downgrade it to the still cover image;
      // it is never downloadable. Hidden/offscreen preloads never reach here.
      const blobUrl = urls.find((value) => value.startsWith('blob:'));
      if (!blobUrl) continue;
      blobVideos += 1;
      media.push({
        kind,
        url: blobUrl,
        width,
        height,
        rect: {
          top: rect.top,
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
        },
        styleVisible: true,
        inViewer: true,
      });
      continue;
    }
    media.push({
      kind,
      url,
      width,
      height,
      rect: {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
      },
      styleVisible: true,
      inViewer: true,
    });
  }
  const resourceNames: string[] = [];
  try {
    if (typeof performance !== 'undefined' && performance.getEntriesByType) {
      for (const entry of performance
        .getEntriesByType('resource')
        .slice(-200)) {
        const name = (entry as PerformanceResourceTiming).name;
        if (/\.(mp4|m4v|m4s|ts|webm|mov)(?:[?#]|$)|\/media\//i.test(name))
          resourceNames.push(name);
        if (resourceNames.length >= 40) break;
      }
    }
  } catch {
    // ignore
  }
  const mseSource = firstVideo
    ? classifySource(firstVideoSources, resourceNames)
    : undefined;
  const audioPresent = firstVideo ? audioOf(firstVideo) : undefined;
  const segmentFrom = (element: Element): StoryProgressSegment => {
    const now = element.getAttribute('aria-valuenow');
    let value: number | undefined;
    if (now !== null) {
      const parsed = Number(now);
      if (Number.isFinite(parsed)) value = parsed > 1 ? parsed / 100 : parsed;
    }
    let width: number | undefined;
    const candidates = [element, ...Array.from(element.querySelectorAll('div'))]
      .slice(0, 5)
      .map((node) => (node as HTMLElement).style);
    for (const style of candidates) {
      if (!style) continue;
      if (style.width && style.width.endsWith('%')) {
        const parsed = parseFloat(style.width);
        if (Number.isFinite(parsed)) {
          width = parsed / 100;
          break;
        }
      }
      const match = style.transform
        ? /scaleX?\(([0-9.]+)\)/.exec(style.transform)
        : null;
      if (match) {
        const parsed = parseFloat(match[1]);
        if (Number.isFinite(parsed)) {
          width = parsed;
          break;
        }
      }
    }
    return {
      ...(value !== undefined ? { value } : {}),
      ...(width !== undefined ? { width } : {}),
      current: element.getAttribute('aria-current') === 'true',
    };
  };
  const segments: StoryProgressSegment[] = [];
  const bars = Array.from(root.querySelectorAll('[role="progressbar"]'));
  if (bars.length) {
    for (const bar of bars) segments.push(segmentFrom(bar));
  } else {
    const labelled = Array.from(
      root.querySelectorAll('[aria-label], [role="group"]'),
    ).find((element) =>
      /progress/i.test(element.getAttribute('aria-label') ?? ''),
    );
    const segmentRoot = labelled ?? root.querySelector('[role="group"]');
    if (segmentRoot && segmentRoot.children.length > 1)
      for (const child of Array.from(segmentRoot.children))
        segments.push(segmentFrom(child));
  }
  const publishedAt =
    root.querySelector('time[datetime]')?.getAttribute('datetime') ?? undefined;
  return {
    viewerFound: true,
    shape,
    viewport,
    media,
    blobVideos,
    ...(mseSource ? { mseSource } : {}),
    ...(audioPresent !== undefined ? { audioPresent } : {}),
    progress: { segments },
    ...(publishedAt ? { publishedAt } : {}),
  };
}

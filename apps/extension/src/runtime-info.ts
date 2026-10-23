/**
 * Extension runtime build/protocol handshake. The popup and the background
 * service worker both import this ONE marker, so a freshly-built popup can
 * detect an old, still-running service worker (or an old extension bundle
 * loaded by Chrome) before any acquisition request is sent.
 *
 * No persistence, no storage permission, no network request and no
 * user/session/URL data: the handshake carries two opaque build markers only.
 */
export const EXTENSION_PROTOCOL_VERSION = 'm8d-identity-v1';

/** Short marker shown in the popup; tied to the shared protocol version. */
export const EXTENSION_BUILD_MARKER = EXTENSION_PROTOCOL_VERSION;

/** Message type the popup sends to ask the background for its runtime identity. */
export const RUNTIME_INFO_REQUEST = 'UNIFETCH_RUNTIME_INFO';

/** Shown whenever the popup and background are not the same build. */
export const RELOAD_REQUIRED_MESSAGE = 'Extension reload required';

export interface RuntimeInfo {
  protocolVersion: string;
  buildMarker: string;
}

/** The only payload the background returns: two opaque build markers. */
export function runtimeInfo(): RuntimeInfo {
  return {
    protocolVersion: EXTENSION_PROTOCOL_VERSION,
    buildMarker: EXTENSION_BUILD_MARKER,
  };
}

/** True only when a message is the runtime-info handshake request. */
export function isRuntimeInfoRequest(message: { type?: unknown }): boolean {
  return message.type === RUNTIME_INFO_REQUEST;
}

export interface RuntimeCompatibility {
  /** True only when the popup and background report the same protocol. */
  compatible: boolean;
  /** Short, non-identifying marker shown in the popup. */
  label: string;
}

/**
 * Compares the popup's expected protocol against the background's advertised
 * one. A missing (undefined) background protocol is a mismatch, so a rebuilt
 * popup fails closed against an old service worker.
 */
export function checkRuntimeCompatibility(
  expected: string,
  actual: string | undefined,
): RuntimeCompatibility {
  const compatible = actual === expected;
  return {
    compatible,
    label: compatible ? `build ${expected}` : RELOAD_REQUIRED_MESSAGE,
  };
}

/** Acquisition/download controls that must be gated on the handshake. */
export const ACQUISITION_ACTIONS = [
  'resolve',
  'download',
  'run',
  'run-story',
] as const;

export type AcquisitionAction = (typeof ACQUISITION_ACTIONS)[number];

/** Every acquisition/download action stays disabled unless the protocols match. */
export function gatedActions(
  compatibility: RuntimeCompatibility,
): Record<AcquisitionAction, boolean> {
  const enabled = compatibility.compatible;
  return {
    resolve: enabled,
    download: enabled,
    run: enabled,
    'run-story': enabled,
  };
}

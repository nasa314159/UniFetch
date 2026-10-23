import { describe, expect, it } from 'vitest';
import {
  ACQUISITION_ACTIONS,
  EXTENSION_BUILD_MARKER,
  EXTENSION_PROTOCOL_VERSION,
  RELOAD_REQUIRED_MESSAGE,
  RUNTIME_INFO_REQUEST,
  checkRuntimeCompatibility,
  gatedActions,
  isRuntimeInfoRequest,
  runtimeInfo,
} from './runtime-info';

describe('extension runtime build/protocol handshake', () => {
  it('enables every action when popup and background protocols match', () => {
    const compatibility = checkRuntimeCompatibility(
      EXTENSION_PROTOCOL_VERSION,
      runtimeInfo().protocolVersion,
    );
    expect(compatibility.compatible).toBe(true);
    expect(compatibility.label).toBe(`build ${EXTENSION_PROTOCOL_VERSION}`);
    const actions = gatedActions(compatibility);
    for (const action of ACQUISITION_ACTIONS)
      expect(actions[action]).toBe(true);
  });

  it('refuses every acquisition/download action on a protocol mismatch', () => {
    const compatibility = checkRuntimeCompatibility(
      EXTENSION_PROTOCOL_VERSION,
      'm8c-legacy-v0',
    );
    expect(compatibility.compatible).toBe(false);
    expect(compatibility.label).toBe(RELOAD_REQUIRED_MESSAGE);
    expect(gatedActions(compatibility)).toEqual({
      resolve: false,
      download: false,
      run: false,
      'run-story': false,
    });
  });

  it('refuses every action when an old service worker never answers', () => {
    const compatibility = checkRuntimeCompatibility(
      EXTENSION_PROTOCOL_VERSION,
      undefined,
    );
    expect(compatibility.compatible).toBe(false);
    for (const action of ACQUISITION_ACTIONS)
      expect(gatedActions(compatibility)[action]).toBe(false);
  });

  it('returns only two opaque build markers with no URL/user/session data', () => {
    const info = runtimeInfo();
    expect(Object.keys(info).sort()).toEqual([
      'buildMarker',
      'protocolVersion',
    ]);
    expect(info.protocolVersion).toBe(EXTENSION_PROTOCOL_VERSION);
    expect(info.buildMarker).toBe(EXTENSION_BUILD_MARKER);
    const serialized = JSON.stringify(info).toLowerCase();
    for (const token of [
      'http',
      'url',
      'username',
      'user',
      'session',
      'cookie',
      'tab',
      'token',
    ])
      expect(serialized).not.toContain(token);
  });

  it('recognizes only the shared runtime-info request type', () => {
    expect(RUNTIME_INFO_REQUEST).toBe('UNIFETCH_RUNTIME_INFO');
    expect(isRuntimeInfoRequest({ type: RUNTIME_INFO_REQUEST })).toBe(true);
    expect(isRuntimeInfoRequest({ type: 'UNIFETCH_M8D_RESOLVE' })).toBe(false);
    expect(isRuntimeInfoRequest({})).toBe(false);
  });
});

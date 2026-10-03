export interface InstagramEndpointProfile {
  readonly name: string;
  readonly endpoint: string;
  readonly method: 'POST';
  readonly appId: string;
  readonly docId: string;
  readonly version: number;
  readonly csrfCookieName: string;
  readonly csrfHeader: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly variables: Readonly<Record<string, boolean>>;
}

// This profile represents unstable Instagram web implementation details and may
// need replacement without changing the parser, normalizer, or UI.
export const POLARIS_POST_ROOT_PROFILE_V1: InstagramEndpointProfile =
  Object.freeze({
    name: 'PolarisPostRootQueryProfileV1',
    endpoint: 'https://www.instagram.com/graphql/query',
    method: 'POST',
    appId: '936619743392459',
    docId: '27128499623469141',
    version: 1,
    csrfCookieName: 'csrftoken',
    csrfHeader: 'X-CSRFToken',
    headers: Object.freeze({
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.8',
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    variables: Object.freeze({
      __relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider: false,
    }),
  });

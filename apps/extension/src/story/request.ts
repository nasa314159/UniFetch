import { POLARIS_POST_ROOT_PROFILE_V1 } from '@unifetch/meta-resolver/instagram';
import type { StrategyRequest } from '../request';
import type { InstagramStoryRef } from './ref';

/**
 * M8B request builder. The Post/Reel Polaris post-root GraphQL profile does not
 * apply to Story, so this is a separate, minimal authenticated GET for the one
 * explicit Story media id. It carries no Cookie header, no CSRF token and no
 * session value; the background runtime attaches credentials itself.
 */
export function buildInstagramStoryRequest(
  ref: InstagramStoryRef,
): StrategyRequest {
  return {
    endpoint: `https://www.instagram.com/api/v1/media/${ref.storyId}/info/`,
    method: 'GET',
    headers: {
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.8',
      'X-IG-App-ID': POLARIS_POST_ROOT_PROFILE_V1.appId,
    },
  };
}

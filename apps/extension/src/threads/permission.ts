/**
 * Threads uses an optional host permission rather than a required one, so an
 * ordinary Instagram session never sees a Threads prompt. The popup requests it
 * only from a user gesture on a Threads target; the background only checks it.
 */
export const THREADS_ORIGIN = 'https://www.threads.com';
export const THREADS_HOST_PERMISSION = 'https://www.threads.com/*';

export interface PermissionsApi {
  contains(permissions: { origins: string[] }): Promise<boolean>;
  request(permissions: { origins: string[] }): Promise<boolean>;
}

export interface PermissionStatus {
  granted: boolean;
  /** True when this call had to ask the user rather than reuse a grant. */
  requested: boolean;
}

export async function hasThreadsPermission(
  permissions: PermissionsApi | undefined,
): Promise<boolean> {
  if (!permissions) return false;
  try {
    return await permissions.contains({ origins: [THREADS_HOST_PERMISSION] });
  } catch {
    return false;
  }
}

/**
 * Requests the narrow Threads host permission. Must be called from a user
 * gesture (the popup Resolve/Download click). A denial is a typed failure, not
 * a silent retry and never a broader origin fallback.
 */
export async function ensureThreadsPermission(
  permissions: PermissionsApi | undefined,
): Promise<PermissionStatus> {
  if (!permissions) return { granted: false, requested: false };
  let existing: boolean;
  try {
    existing = await permissions.contains({
      origins: [THREADS_HOST_PERMISSION],
    });
  } catch {
    return { granted: false, requested: false };
  }
  if (existing) return { granted: true, requested: false };
  try {
    const granted = await permissions.request({
      origins: [THREADS_HOST_PERMISSION],
    });
    return { granted: Boolean(granted), requested: true };
  } catch {
    return { granted: false, requested: true };
  }
}

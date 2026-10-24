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
  /** True when the native prompt was not answered within the bound. */
  timedOut?: boolean;
}

/** A human may need time to read the prompt, but the popup must never hang. */
export const THREADS_PERMISSION_TIMEOUT_MS = 60_000;

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
 * Requests the narrow Threads host permission. This function calls
 * `permissions.request` synchronously before returning, so the click's user
 * gesture is still active; awaiting `permissions.contains` first can lose the
 * gesture in some Chrome builds. When the grant already exists Chrome resolves
 * `true` without showing a prompt.
 */
export function requestThreadsPermissionNow(
  permissions: PermissionsApi | undefined,
  timeoutMs: number = THREADS_PERMISSION_TIMEOUT_MS,
): Promise<PermissionStatus> {
  if (!permissions)
    return Promise.resolve({ granted: false, requested: false });
  let pending: Promise<boolean>;
  try {
    pending = permissions.request({ origins: [THREADS_HOST_PERMISSION] });
  } catch {
    return Promise.resolve({ granted: false, requested: true });
  }
  const settled: Promise<PermissionStatus> = pending.then(
    (granted) => ({ granted: Boolean(granted), requested: true }),
    () => ({ granted: false, requested: true }),
  );
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return settled;
  return new Promise<PermissionStatus>((resolve) => {
    const timer = setTimeout(() => {
      resolve({ granted: false, requested: true, timedOut: true });
    }, timeoutMs);
    void settled.then((status) => {
      clearTimeout(timer);
      resolve(status);
    });
  });
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
  return requestThreadsPermissionNow(permissions);
}

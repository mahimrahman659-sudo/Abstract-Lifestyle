export type RefreshResult<T> =
  | { status: 'ok'; user: T }
  | { status: 'expired' }
  | { status: 'error'; error: unknown };

/** A readback failure is not evidence that an authenticated session expired. */
export async function refreshSession<T>(
  load: () => Promise<{ user: T }>,
  accept: (user: T | null) => void,
): Promise<RefreshResult<T>> {
  try {
    const { user } = await load();
    accept(user);
    return { status: 'ok', user };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'status' in error &&
        (error.status === 401 || error.status === 403)) {
      accept(null);
      return { status: 'expired' };
    }
    return { status: 'error', error };
  }
}

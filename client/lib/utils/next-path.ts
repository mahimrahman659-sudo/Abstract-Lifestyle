/**
 * Only same-site relative paths are ever used as a post-login redirect.
 * Anything else (`https://…`, `//host`, `/\host`, …) falls back — prevents
 * open redirects via `?next=`.
 */
export const sanitizeNextPath = (value: string | null | undefined, fallback = '/'): string => {
  if (!value) {
    return fallback;
  }
  const trimmed = value.trim();
  const isRelative =
    trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\');
  if (!isRelative || /[\u0000-\u001F]/.test(trimmed)) {
    return fallback;
  }
  return trimmed;
};

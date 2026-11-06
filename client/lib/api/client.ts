import type { ApiErrorDetail, ApiErrorPayload } from '../types';

/** Typed error thrown by the API client for any non-2xx response. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetail[];

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload.code;
    this.details = payload.details ?? [];
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Same-origin fetch wrapper for the Express API (`/api/*` via Next.js
 * rewrites). Cookies travel automatically (`credentials: 'include'`) — the
 * auth token lives in an httpOnly cookie and is never touched by JS.
 */
export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers:
      body !== undefined && !isFormData ? { 'Content-Type': 'application/json' } : undefined,
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
    signal,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const envelope = (data as { error?: ApiErrorPayload } | null)?.error;
    throw new ApiError(
      response.status,
      envelope ?? {
        code: 'SERVER_ERROR',
        message: `Request failed with status ${response.status}`,
      },
    );
  }

  return data as T;
}

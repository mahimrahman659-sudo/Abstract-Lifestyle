/** Error envelope: `{ error: { code, message, details? } }` (API_DOCUMENTATION.md). */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR';

export interface ApiErrorDetail {
  path: string;
  message: string;
}

export interface ApiErrorPayload {
  code: ApiErrorCode;
  message: string;
  details?: ApiErrorDetail[];
}

/** Standard list envelope returned by collection endpoints. */
export interface ListEnvelope<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

import { ApiError } from '@/lib/api/client';

/**
 * Maps `VALIDATION_ERROR` details (`{ path, message }`) to per-field messages.
 * Nested paths like `shippingAddress.city` collapse to their last segment.
 */
export const fieldErrorsFromApi = (error: unknown): Record<string, string> => {
  if (!(error instanceof ApiError)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const detail of error.details) {
    const key = detail.path.split('.').pop() ?? detail.path;
    if (key) {
      result[key] = detail.message;
    }
  }
  return result;
};

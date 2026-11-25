/**
 * Wall-clock time budget for security-critical operations (Phase 2B M-1).
 *
 * Bounds TOTAL elapsed time across every phase of an operation — server
 * selection, connection acquisition, write execution and acknowledgment —
 * without depending on driver-specific per-operation options (verified
 * against mongoose 9.13.0 / mongodb driver 7.9.1, where `timeoutMS` exists
 * but is not guaranteed to pass through `Model.create`).
 *
 * Guarantees:
 * - the timer is always cleared (no leaked handles keep the process alive);
 * - the operation promise stays subscribed by the race, so a late rejection
 *   can never surface as an unhandled rejection;
 * - the operation is NEVER retried;
 * - if the budget wins first, the operation may still settle afterwards —
 *   callers may attach their own handler to observe that late outcome (the
 *   documented "a record may exist although the response was denied" case).
 */
export class TimeBudgetExceededError extends Error {
  constructor(ms: number) {
    super(`operation exceeded its ${ms}ms time budget`);
    this.name = 'TimeBudgetExceededError';
  }
}

export const withTimeBudget = async <T>(
  operation: Promise<T>,
  ms: number,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeBudgetExceededError(ms)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

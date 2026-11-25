/** Error envelope: `{ error: { code, message, details? } }` (API_DOCUMENTATION.md). */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  /** Checkout: one or more cart lines can no longer be ordered (details[]). */
  | 'CART_NOT_ORDERABLE'
  /** Checkout/cart: another checkout currently holds the cart claim. */
  | 'CHECKOUT_IN_PROGRESS'
  /** Checkout: the cart changed while the order was being placed. */
  | 'CHECKOUT_CONFLICT'
  /** Cancellation: the inventory could not be restored, so nothing changed. */
  | 'STOCK_RESTORE_FAILED'
  /** Payment: the selected provider is disabled or not configured. */
  | 'PAYMENT_METHOD_UNAVAILABLE'
  /** Payment: method/state does not accept a manual claim. */
  | 'NOT_MANUAL_PAYMENT'
  | 'PAYMENT_STATE_INVALID'
  /** Payment: a claim is already under verification and cannot be overwritten. */
  | 'PAYMENT_CLAIM_LOCKED'
  /** Payment: another submission/review won the race. */
  | 'PAYMENT_CLAIM_CONFLICT'
  | 'PAYMENT_CLAIM_NOT_PENDING'
  /** Payment: the normalized TrxID is already used by another order. */
  | 'PAYMENT_TRX_ID_USED'
  /** Payment: a submitted claim must be reconciled before cancelling. */
  | 'PAYMENT_REVIEW_IN_PROGRESS'
  /** Fulfilment: a prepaid order cannot be delivered before payment is verified. */
  | 'PAYMENT_NOT_CONFIRMED'
  /** Refund: no manual refund is awaiting completion. */
  | 'REFUND_NOT_PENDING'
  | 'REFUND_RECIPIENT_INVALID'
  | 'REFUND_RECIPIENT_MISMATCH'
  | 'REFUND_AMOUNT_MISMATCH'
  | 'REFUND_CONFIRMATION_REQUIRED'
  | 'REFUND_ALREADY_COMPLETED'
  /** Manual payments are blocked because the payment index is not ready. */
  | 'PAYMENT_INDEX_UNAVAILABLE'
  /** Activity: identifiable timeline disabled while tracking is off (H-1 gate). */
  | 'ACTIVITY_DISABLED';

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

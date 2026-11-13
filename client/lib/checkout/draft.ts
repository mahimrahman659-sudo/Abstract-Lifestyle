/**
 * Session-only checkout draft (name / phone / address).
 *
 * Kept in sessionStorage so a reload does not lose a half-typed address, and
 * cleared by CheckoutDraftGuard when the shopper logs out or the logged-in
 * user changes. Never stores anything but these delivery fields.
 */
export const CHECKOUT_DRAFT_KEY = 'al_checkout_draft';

export interface CheckoutDraft {
  fullName: string;
  phone: string;
  line1: string;
  saveAddress?: boolean;
}

export const readCheckoutDraft = (): CheckoutDraft | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(CHECKOUT_DRAFT_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    const text = (value: unknown): string => (typeof value === 'string' ? value : '');
    return {
      fullName: text(candidate.fullName),
      phone: text(candidate.phone),
      line1: text(candidate.line1),
      saveAddress: candidate.saveAddress === true,
    };
  } catch {
    return null;
  }
};

export const saveCheckoutDraft = (draft: CheckoutDraft): void => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.sessionStorage.setItem(CHECKOUT_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage unavailable — the form still works for this page view.
  }
};

export const clearCheckoutDraft = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.sessionStorage.removeItem(CHECKOUT_DRAFT_KEY);
  } catch {
    // Storage unavailable — there is nothing to clear.
  }
};

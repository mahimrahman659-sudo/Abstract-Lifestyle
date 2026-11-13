'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { clearCheckoutDraft } from '@/lib/checkout/draft';

/**
 * Clears the session-scoped checkout draft (name / phone / address) whenever the
 * shopper logs out or the logged-in user id changes, so the next person on the
 * device never inherits someone else's delivery details.
 *
 * The identity resolved on first load is not a change — only a later transition
 * counts, otherwise every page reload would wipe a half-typed address.
 */
export function CheckoutDraftGuard(): null {
  const { user, loading } = useAuth();
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (loading) {
      return;
    }

    const userId = user?.id ?? null;

    if (previousUserId.current === undefined) {
      previousUserId.current = userId;
      return;
    }

    if (previousUserId.current !== userId) {
      clearCheckoutDraft();
      previousUserId.current = userId;
    }
  }, [user?.id, loading]);

  return null;
}

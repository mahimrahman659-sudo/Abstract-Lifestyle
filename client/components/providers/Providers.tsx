'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { CartProvider } from '@/components/cart/CartProvider';
import { CheckoutDraftGuard } from '@/components/checkout/CheckoutDraftGuard';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <CartProvider>
        <CheckoutDraftGuard />
        {children}
      </CartProvider>
    </AuthProvider>
  );
}

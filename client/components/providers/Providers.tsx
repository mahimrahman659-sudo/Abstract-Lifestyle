'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { CartProvider } from '@/components/cart/CartProvider';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <CartProvider>{children}</CartProvider>
    </AuthProvider>
  );
}

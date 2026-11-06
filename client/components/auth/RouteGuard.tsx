'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { Spinner } from '@/components/ui/Spinner';

/**
 * Client-side convenience guard only — the Express API is the real authority
 * and rejects unauthorized requests regardless of what the UI shows.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && user === null) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, user, router, pathname]);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner label="Checking your session" />
      </div>
    );
  }

  return user ? <>{children}</> : null;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) {
      return;
    }
    if (user === null) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (user.role !== 'admin') {
      router.replace('/');
    }
  }, [loading, user, router, pathname]);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner label="Checking permissions" />
      </div>
    );
  }

  return user?.role === 'admin' ? <>{children}</> : null;
}

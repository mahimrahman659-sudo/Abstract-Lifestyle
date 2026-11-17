'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';

/**
 * Client-side convenience guard only — the Express API is the real authority
 * and rejects unauthorized requests regardless of what the UI shows.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, refreshError, refresh } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && user === null && !refreshError) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, user, router, pathname, refreshError]);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner label="Checking your session" />
      </div>
    );
  }

  if (!user && refreshError) return <ErrorState title="Could not load your account" description={refreshError} onRetry={() => { void refresh(); }} />;
  return user ? <>{children}</> : null;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading, refreshError, refresh } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) {
      return;
    }
    if (user === null && !refreshError) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (user && user.role !== 'admin') {
      router.replace('/');
    }
  }, [loading, user, router, pathname, refreshError]);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner label="Checking permissions" />
      </div>
    );
  }

  if (!user && refreshError) return <ErrorState title="Could not load your account" description={refreshError} onRetry={() => { void refresh(); }} />;
  return user?.role === 'admin' ? <>{children}</> : null;
}

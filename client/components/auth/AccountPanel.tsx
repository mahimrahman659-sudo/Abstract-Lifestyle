'use client';

import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';
import { Skeleton } from '@/components/ui/Skeleton';
import { AccountEditor } from './AccountEditor';

export function AccountPanel() {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">My account</h1>

      <section aria-labelledby="profile-heading" className="rounded-2xl border border-line bg-surface p-5">
        <h2 id="profile-heading" className="text-base font-semibold text-ink">
          Profile and delivery addresses
        </h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <dt className="w-24 text-muted">Name</dt>
            <dd className="font-medium text-ink">{user.name}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="w-24 text-muted">Email</dt>
            <dd className="text-ink">{user.email}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="w-24 text-muted">Role</dt>
            <dd className="text-ink capitalize">{user.role}</dd>
          </div>
        </dl>
        <AccountEditor />
      </section>

      <section aria-labelledby="shortcuts-heading" className="rounded-2xl border border-line bg-surface p-5">
        <h2 id="shortcuts-heading" className="text-base font-semibold text-ink">
          Shortcuts
        </h2>
        <ul className="mt-3 flex flex-wrap gap-3 text-sm">
          <li>
            <Link href="/orders" className="text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              Your orders
            </Link>
          </li>
          <li>
            <Link href="/cart" className="text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              Your cart
            </Link>
          </li>
          <li>
            <Link href="/products" className="text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              Continue shopping
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}

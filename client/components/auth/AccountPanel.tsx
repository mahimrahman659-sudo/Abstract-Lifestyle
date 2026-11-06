'use client';

import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';

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
          Profile
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
        <p className="mt-4 text-xs text-muted">
          Profile editing and address management ship in a later release — your addresses added at
          checkout are saved to this account.
        </p>
      </section>

      <section aria-labelledby="addresses-heading" className="rounded-2xl border border-line bg-surface p-5">
        <h2 id="addresses-heading" className="text-base font-semibold text-ink">
          Saved addresses
        </h2>
        {user.addresses.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No saved addresses yet"
              description="Addresses you save during checkout will appear here."
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-3 text-sm">
            {user.addresses.map((address) => (
              <li key={address._id} className="rounded-xl border border-line px-3 py-2">
                <p className="font-medium text-ink">
                  {address.label ? `${address.label} — ` : ''}
                  {address.fullName}
                </p>
                <p className="text-muted">
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ''}, {address.city}, {address.country}
                  {address.isDefault ? ' · Default' : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
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

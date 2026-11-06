'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { RequireAdmin } from '@/components/auth/RouteGuard';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils/cn';

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', exact: true },
  { href: '/admin/orders', label: 'Orders' },
  { href: '/admin/products', label: 'Products' },
  { href: '/admin/categories', label: 'Categories' },
];

function AdminNav({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Admin" className="space-y-1">
      {NAV_ITEMS.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'block rounded-xl px-3 py-2 text-sm font-medium transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              active ? 'bg-accent text-white' : 'text-muted hover:bg-paper hover:text-ink',
            )}
          >
            {item.label}
          </Link>
        );
      })}
      <Link
        href="/"
        className="mt-4 block rounded-xl px-3 py-2 text-xs text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
      >
        ← Back to storefront
      </Link>
    </nav>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <RequireAdmin>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        <div className="mb-4 flex items-center justify-between md:hidden">
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">Admin</p>
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={mobileOpen}
            aria-controls="admin-nav"
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? 'Close menu' : 'Menu'}
          </Button>
        </div>

        <div className="grid gap-6 md:grid-cols-[200px_1fr]">
          <aside id="admin-nav" className={cn('md:block', mobileOpen ? 'block' : 'hidden')}>
            <div className="rounded-2xl border border-line bg-surface p-3">
              <p className="hidden px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-muted md:block">
                Admin
              </p>
              <AdminNav pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            </div>
          </aside>

          <section aria-label="Admin content">{children}</section>
        </div>
      </div>
    </RequireAdmin>
  );
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useCart } from '@/components/cart/CartProvider';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { catalogApi } from '@/lib/api/catalog';
import type { CategoryTreeItem } from '@/lib/types';
import { cn } from '@/lib/utils/cn';

export function Header() {
  const { user, loading, logout } = useAuth();
  const { itemCount } = useCart();
  const router = useRouter();
  const [categories, setCategories] = useState<CategoryTreeItem[]>([]);
  const [search, setSearch] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    catalogApi
      .getCategories()
      .then((res) => {
        if (!cancelled) {
          setCategories(res.items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCategories([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!accountOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAccountOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [accountOpen]);

  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = search.trim();
    router.push(query ? `/products?search=${encodeURIComponent(query)}` : '/products');
    setMobileOpen(false);
  };

  const handleLogout = async () => {
    setAccountOpen(false);
    await logout();
    router.push('/');
  };

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-4">
        <button
          type="button"
          className="rounded-full p-2 hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:hidden"
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMobileOpen((open) => !open)}
        >
          <span aria-hidden="true" className="block h-0.5 w-5 bg-ink" />
          <span aria-hidden="true" className="mt-1 block h-0.5 w-5 bg-ink" />
          <span aria-hidden="true" className="mt-1 block h-0.5 w-5 bg-ink" />
        </button>

        <Link href="/" className="text-lg font-semibold tracking-tight text-ink">
          Abstract Lifestyle
        </Link>

        <nav aria-label="Categories" className="ml-4 hidden items-center gap-4 md:flex">
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/products?category=${category.slug}`}
              className="text-sm text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {category.name}
            </Link>
          ))}
        </nav>

        <form role="search" onSubmit={onSearch} className="ml-auto hidden w-64 sm:block">
          <label htmlFor="header-search" className="sr-only">
            Search products
          </label>
          <input
            id="header-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search products…"
            className="h-10 w-full rounded-full border border-line bg-paper px-4 text-sm text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
        </form>

        <Link
          href="/cart"
          aria-label={`Cart, ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`}
          className="relative rounded-full p-2 hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-6 fill-none stroke-ink"
            strokeWidth="1.5"
          >
            <path
              d="M3 5h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="10" cy="20" r="1.2" />
            <circle cx="17" cy="20" r="1.2" />
          </svg>
          {itemCount > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-xs font-semibold text-white">
              {itemCount > 99 ? '99+' : itemCount}
            </span>
          ) : null}
        </Link>

        <div ref={accountRef} className="relative">
          {loading ? (
            <span className="p-2">
              <Spinner className="size-5" label="Loading account" />
            </span>
          ) : user ? (
            <>
              <button
                type="button"
                className="rounded-full px-3 py-2 text-sm font-medium text-ink hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                aria-expanded={accountOpen}
                aria-haspopup="menu"
                onClick={() => setAccountOpen((open) => !open)}
              >
                {user.name.split(' ')[0]}
              </button>
              {accountOpen ? (
                <div
                  role="menu"
                  aria-label="Account"
                  className="absolute right-0 top-full mt-2 w-52 rounded-2xl border border-line bg-surface p-2 shadow-lg"
                >
                  <p className="truncate px-3 py-2 text-xs text-muted">{user.email}</p>
                  <Link
                    role="menuitem"
                    href="/account"
                    onClick={() => setAccountOpen(false)}
                    className="block rounded-xl px-3 py-2 text-sm text-ink hover:bg-paper focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    Profile
                  </Link>
                  <Link
                    role="menuitem"
                    href="/orders"
                    onClick={() => setAccountOpen(false)}
                    className="block rounded-xl px-3 py-2 text-sm text-ink hover:bg-paper focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    Orders
                  </Link>
                  {user.role === 'admin' ? (
                    <Link
                      role="menuitem"
                      href="/admin"
                      onClick={() => setAccountOpen(false)}
                      className="block rounded-xl px-3 py-2 text-sm text-ink hover:bg-paper focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      Admin dashboard
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void handleLogout()}
                    className="block w-full rounded-xl px-3 py-2 text-left text-sm text-danger hover:bg-paper focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    Log out
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="rounded-full px-3 py-2 text-sm font-medium text-ink hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Sign in
              </Link>
              <Link href="/register" className="hidden sm:block">
                <Button size="sm">Create account</Button>
              </Link>
            </div>
          )}
        </div>
      </div>

      <div
        className={cn('border-t border-line md:hidden', mobileOpen ? 'block' : 'hidden')}
        id="mobile-nav"
      >
        <nav aria-label="Mobile navigation" className="flex flex-col gap-1 px-4 py-3">
          <form role="search" onSubmit={onSearch} className="mb-2 sm:hidden">
            <label htmlFor="mobile-search" className="sr-only">
              Search products
            </label>
            <input
              id="mobile-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search products…"
              className="h-10 w-full rounded-full border border-line bg-paper px-4 text-sm text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          </form>
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/products?category=${category.slug}`}
              onClick={() => setMobileOpen(false)}
              className="rounded-xl px-3 py-2 text-sm text-ink hover:bg-paper focus-visible:outline-2 focus-visible:outline-accent"
            >
              {category.name}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}



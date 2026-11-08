'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useCart } from '@/components/cart/CartProvider';
import { Spinner } from '@/components/ui/Spinner';
import {
  BagIcon,
  CartIcon,
  MenuIcon,
  SearchIcon,
  UserIcon,
} from '@/components/ui/icons';
import { site } from '@/config/site';
import { cn } from '@/lib/utils/cn';

const rowClass = 'mx-auto flex h-[72px] max-w-[1280px] items-center gap-3 px-4 sm:px-10';
const focusClass =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export function Header() {
  const { user, loading, logout } = useAuth();
  const { itemCount } = useCart();
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [queryString, setQueryString] = useState('');
  const accountRef = useRef<HTMLDivElement>(null);

  // Query string after mount — active states need it, and useSearchParams would
  // force dynamic rendering of every page.
  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      setQueryString(window.location.search);
    })();
  }, [pathname]);

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
    setSearchOpen(false);
    setMobileOpen(false);
  };

  const handleLogout = async () => {
    setAccountOpen(false);
    setMobileOpen(false);
    await logout();
    router.push('/');
  };

  const isActive = (href: string): boolean => {
    const [path, query] = href.split('?');
    if (path !== pathname) {
      return false;
    }
    return query ? queryString.includes(query) : true;
  };

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface">
      <div className={rowClass}>
        {/* Mobile: hamburger (menu below). */}
        <button
          type="button"
          className={cn('rounded-full p-2 hover:bg-tile md:hidden', focusClass)}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMobileOpen((open) => !open)}
        >
          <MenuIcon className="size-5 text-ink" />
        </button>

        {/* Left: logo mark + wordmark + tagline. */}
        <Link href="/" className={cn('flex items-center gap-2.5', focusClass)}>
          <span className="flex size-7 items-center justify-center rounded-lg bg-brand text-white">
            <BagIcon className="size-4" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-xl font-bold tracking-tight text-ink">{site.name}</span>
            <span className="mt-1 text-[10px] font-medium text-muted">{site.tagline}</span>
          </span>
        </Link>
        {/* Center (desktop): main navigation. */}
        <nav aria-label="Main" className="ml-8 hidden items-center gap-8 lg:flex">
          {site.nav.map((link) => {
            const active = isActive(link.href);
            return (
              <Link
                key={link.label}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative py-1 text-sm font-medium transition-colors',
                  focusClass,
                  active ? 'text-brand' : 'text-ink hover:text-brand',
                )}
              >
                {link.label}
                {active ? (
                  <span aria-hidden="true" className="absolute inset-x-0 -bottom-1 h-0.5 bg-brand" />
                ) : null}
              </Link>
            );
          })}
        </nav>

        {/* Right: search, account, cart. */}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className={cn('rounded-full p-2 hover:bg-tile', focusClass)}
            aria-expanded={searchOpen}
            aria-controls="header-search-panel"
            aria-label={searchOpen ? 'Close search' : 'Search products'}
            onClick={() => setSearchOpen((open) => !open)}
          >
            <SearchIcon className="size-5 text-ink" />
          </button>

          {loading ? (
            <span className="flex size-9 items-center justify-center">
              <Spinner className="size-5" label="Loading account" />
            </span>
          ) : user ? (
            <div ref={accountRef} className="relative">
              <button
                type="button"
                className={cn('rounded-full p-2 hover:bg-tile', focusClass)}
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                aria-label="Account menu"
                onClick={() => setAccountOpen((open) => !open)}
              >
                <UserIcon className="size-5 text-ink" />
              </button>
              {accountOpen ? (
                <div
                  role="menu"
                  aria-label="Account"
                  className="absolute right-0 top-full z-50 mt-2 w-52 rounded-2xl border border-line bg-surface p-1.5"
                >
                  <Link
                    role="menuitem"
                    href="/account"
                    onClick={() => setAccountOpen(false)}
                    className={cn('block rounded-xl px-3 py-2 text-sm text-ink hover:bg-tile', focusClass)}
                  >
                    Profile
                  </Link>
                  <Link
                    role="menuitem"
                    href="/orders"
                    onClick={() => setAccountOpen(false)}
                    className={cn('block rounded-xl px-3 py-2 text-sm text-ink hover:bg-tile', focusClass)}
                  >
                    Orders
                  </Link>
                  {user.role === 'admin' ? (
                    <Link
                      role="menuitem"
                      href="/admin"
                      onClick={() => setAccountOpen(false)}
                      className={cn('block rounded-xl px-3 py-2 text-sm text-ink hover:bg-tile', focusClass)}
                    >
                      Admin dashboard
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void handleLogout()}
                    className={cn('block w-full rounded-xl px-3 py-2 text-left text-sm text-danger hover:bg-tile', focusClass)}
                  >
                    Log out
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <Link
              href="/login"
              aria-label="Sign in"
              className={cn('rounded-full p-2 hover:bg-tile', focusClass)}
            >
              <UserIcon className="size-5 text-ink" />
            </Link>
          )}

          <Link
            href="/cart"
            aria-label={itemCount > 0 ? `Cart, ${itemCount} items` : 'Cart'}
            className={cn('relative rounded-full p-2 hover:bg-tile', focusClass)}
          >
            <CartIcon className="size-5 text-ink" />
            {itemCount > 0 ? (
              <span
                aria-hidden="true"
                className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-[3px] text-[10px] font-medium leading-none text-white"
              >
                {itemCount > 99 ? '99+' : itemCount}
              </span>
            ) : null}
          </Link>
        </div>
      </div>

      {/* Desktop search panel (toggled by the search icon). */}
      <div
        id="header-search-panel"
        className={cn('border-t border-line bg-surface', searchOpen ? 'block' : 'hidden')}
      >
        <div className="mx-auto max-w-[1280px] px-4 py-3 sm:px-10">
          <form role="search" onSubmit={onSearch}>
            <label htmlFor="header-search" className="sr-only">
              Search products
            </label>
            <input
              id="header-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search products…"
              className={cn(
                'h-10 w-full rounded-full border border-line bg-tile px-4 text-sm text-ink placeholder:text-muted',
                focusClass,
              )}
            />
          </form>
        </div>
      </div>

      {/* Mobile menu: same links, search and account. */}
      <div
        className={cn('border-t border-line bg-surface md:hidden', mobileOpen ? 'block' : 'hidden')}
        id="mobile-nav"
      >
        <nav aria-label="Mobile navigation" className="flex flex-col gap-1 px-4 py-3">
          <form role="search" onSubmit={onSearch} className="mb-2">
            <label htmlFor="mobile-search" className="sr-only">
              Search products
            </label>
            <input
              id="mobile-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search products…"
              className={cn(
                'h-10 w-full rounded-full border border-line bg-tile px-4 text-sm text-ink placeholder:text-muted',
                focusClass,
              )}
            />
          </form>

          {site.nav.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              aria-current={isActive(link.href) ? 'page' : undefined}
              className={cn(
                'rounded-xl px-3 py-2 text-sm hover:bg-tile',
                focusClass,
                isActive(link.href) ? 'font-medium text-brand' : 'text-ink',
              )}
            >
              {link.label}
            </Link>
          ))}

          <div className="mt-2 border-t border-line pt-2">
            {loading ? null : user ? (
              <>
                <Link
                  href="/account"
                  onClick={() => setMobileOpen(false)}
                  className={cn('block rounded-xl px-3 py-2 text-sm text-ink hover:bg-tile', focusClass)}
                >
                  My account
                </Link>
                <Link
                  href="/orders"
                  onClick={() => setMobileOpen(false)}
                  className={cn('block rounded-xl px-3 py-2 text-sm text-ink hover:bg-tile', focusClass)}
                >
                  Orders
                </Link>
                {user.role === 'admin' ? (
                  <Link
                    href="/admin"
                    onClick={() => setMobileOpen(false)}
                    className={cn('block rounded-xl px-3 py-2 text-sm text-ink hover:bg-tile', focusClass)}
                  >
                    Admin dashboard
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className={cn('block w-full rounded-xl px-3 py-2 text-left text-sm text-danger hover:bg-tile', focusClass)}
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  onClick={() => setMobileOpen(false)}
                  className={cn('block rounded-xl px-3 py-2 text-sm font-medium text-ink hover:bg-tile', focusClass)}
                >
                  Sign in
                </Link>
                <Link
                  href="/register"
                  onClick={() => setMobileOpen(false)}
                  className={cn('block rounded-xl px-3 py-2 text-sm text-muted hover:bg-tile hover:text-ink', focusClass)}
                >
                  Create account
                </Link>
              </>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}


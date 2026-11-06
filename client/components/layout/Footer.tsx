import { CopyrightYear } from '@/components/layout/CopyrightYear';

export function Footer() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-3">
        <div>
          <p className="text-base font-semibold text-ink">Abstract Lifestyle</p>
          <p className="mt-2 max-w-xs text-sm text-muted">
            Clothing and everyday lifestyle products, designed simply and made to last.
          </p>
        </div>
        <nav aria-label="Shop">
          <p className="text-sm font-semibold text-ink">Shop</p>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li>
              <a className="hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" href="/products">
                All products
              </a>
            </li>
            <li>
              <a className="hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" href="/products?category=clothing">
                Clothing
              </a>
            </li>
            <li>
              <a className="hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" href="/products?category=lifestyle">
                Lifestyle
              </a>
            </li>
          </ul>
        </nav>
        <nav aria-label="Help">
          <p className="text-sm font-semibold text-ink">Help</p>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li>
              <a className="hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" href="/account">
                My account
              </a>
            </li>
            <li>
              <a className="hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" href="/orders">
                Orders
              </a>
            </li>
            <li>
              <a className="hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" href="/cart">
                Cart
              </a>
            </li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-line px-4 py-5 text-center text-xs text-muted">
        © <CopyrightYear /> Abstract Lifestyle. All rights reserved.
      </div>
    </footer>
  );
}

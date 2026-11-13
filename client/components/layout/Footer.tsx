import Link from 'next/link';
import { CopyrightYear } from '@/components/layout/CopyrightYear';
import { BagIcon, FacebookIcon, InstagramIcon, XIcon } from '@/components/ui/icons';
import { site } from '@/config/site';

const socialIcons = {
  Facebook: FacebookIcon,
  Instagram: InstagramIcon,
  X: XIcon,
} as const;

const focusClass =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * Footer: brand block (logo, blurb, socials) + Shop / Collections /
 * Customer Service / Company / Payment columns. All copy comes from
 * `config/site.ts`; every link targets an existing route.
 */
export function Footer() {
  return (
    <footer className="border-t border-line bg-tile">
      <div className="mx-auto grid max-w-[1280px] grid-cols-2 gap-x-6 gap-y-7 px-4 pb-8 pt-8 sm:grid-cols-3 sm:gap-10 sm:px-10 sm:pb-10 sm:pt-10 lg:grid-cols-6">
        {/* Brand block */}
        <div className="col-span-2 sm:col-span-1">
          <Link href="/" className={`inline-flex items-center gap-2 ${focusClass}`}>
            <span className="flex size-7 items-center justify-center rounded-lg bg-brand text-white">
              <BagIcon className="size-4" />
            </span>
            <span className="text-xl font-bold tracking-tight text-ink">{site.name}</span>
          </Link>
          <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-muted">
            {site.footer.description}
          </p>
          <ul className="mt-3 flex items-center gap-2">
            {site.socials.map((social) => {
              const Icon = socialIcons[social.label];
              return (
                <li key={social.label}>
                  <a
                    href={social.href}
                    aria-label={social.label}
                    className={`flex size-9 items-center justify-center rounded-full border border-line bg-surface text-muted transition-colors hover:text-ink ${focusClass}`}
                  >
                    <Icon className="size-4" />
                  </a>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Link columns — two per row on phones so the footer stays short. */}
        {site.footer.columns.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h2 className="text-[13px] font-semibold text-ink">{column.title}</h2>
            <ul className="mt-2 space-y-1">
              {column.links.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className={`text-[13px] leading-6 text-muted hover:text-ink ${focusClass}`}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}

        {/* Payment column — text only, no card logos. */}
        <div className="col-span-2 sm:col-span-1">
          <h2 className="text-[13px] font-semibold text-ink">Payment</h2>
          <p className="mt-2 text-[13px] leading-6 text-muted">{site.footer.payment}</p>
        </div>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto flex max-w-[1280px] items-center px-4 py-4 text-xs text-muted sm:px-10">
          <p>
            © <CopyrightYear /> {site.name}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

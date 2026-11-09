import Image from 'next/image';
import Link from 'next/link';
import { BrandPanel } from '@/components/ui/BrandPanel';
import { hasPublicImage } from '@/components/home/local-image';
import { trustIcons } from '@/components/home/trust-icons';
import { ArrowRightIcon, StarIcon } from '@/components/ui/icons';
import { site } from '@/config/site';
import type { AdminImageAsset } from '@/lib/types';

const focusClass =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * Home hero: light background, copy column (pill, two-line h1, subtitle, CTAs,
 * trust features) and a large image panel. Image resolution order: admin-managed
 * slot → legacy /public/hero.jpg → brand placeholder.
 */
export function Hero({ heroImage }: { heroImage?: AdminImageAsset | null }) {
  const heroSrc = heroImage?.url ?? (hasPublicImage('hero.jpg') ? '/hero.jpg' : null);

  return (
    <section className="w-full border-b border-line bg-paper">
      <div className="mx-auto grid max-w-[1280px] items-stretch gap-10 px-4 py-10 sm:px-10 lg:grid-cols-[1fr_1.1fr] lg:gap-14 lg:py-14">
        <div className="flex flex-col justify-center">
          <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-tile px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink">
            <StarIcon className="size-3 text-brand" />
            {site.hero.pill}
          </p>

          <h1 className="mt-5 text-[32px] font-bold leading-[1.08] tracking-[-0.02em] text-ink lg:text-[46px]">
            {site.hero.titleLine1}
            <span className="block text-brand">{site.hero.titleLine2}</span>
          </h1>

          <p className="mt-4 max-w-md text-[14px] leading-relaxed text-muted sm:text-[15px]">
            {site.hero.subtitle}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href={site.hero.primaryCta.href}
              className={`inline-flex h-11 items-center gap-2 rounded-md bg-brand px-6 text-sm font-medium text-white transition-colors hover:bg-brand-dark ${focusClass}`}
            >
              {site.hero.primaryCta.label}
              <ArrowRightIcon className="size-4" />
            </Link>
            <Link
              href={site.hero.secondaryCta.href}
              className={`inline-flex h-11 items-center rounded-md border border-line bg-white px-6 text-sm font-medium text-ink transition-colors hover:bg-tile ${focusClass}`}
            >
              {site.hero.secondaryCta.label}
            </Link>
          </div>

          <ul className="mt-9 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-7 sm:grid-cols-4">
            {site.trust.map((item) => {
              const Icon = trustIcons[item.icon];
              return (
                <li key={item.title} className="flex items-start gap-2.5">
                  <Icon className="mt-0.5 size-5 shrink-0 text-ink" />
                  <div>
                    <p className="text-[12px] font-semibold text-ink">{item.title}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{item.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Image panel */}
        <div className="relative min-h-[320px] w-full overflow-hidden rounded-2xl bg-cream-deep lg:min-h-[480px]">
          {heroSrc ? (
            <Image
              src={heroSrc}
              alt="Model wearing pieces from the new Abstract Lifestyle collection"
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
          ) : (
            <BrandPanel label="Abstract Lifestyle new collection" caption="New Collection" />
          )}
        </div>
      </div>
    </section>
  );
}

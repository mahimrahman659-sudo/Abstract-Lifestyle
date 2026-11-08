import Image from 'next/image';
import Link from 'next/link';
import { ProductImage } from '@/components/catalog/ProductCard';
import { hasPublicImage } from '@/components/home/local-image';
import { trustIcons } from '@/components/home/trust-icons';
import { ArrowRightIcon, StarIcon } from '@/components/ui/icons';
import { site } from '@/config/site';

const focusClass =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * Home hero: full-bleed cream gradient, copy column (pill, two-line h1,
 * subtitle, CTAs, trust features) and an arch-shaped image panel. Renders a
 * neutral placeholder when /public/hero.jpg is not present.
 */
export function Hero() {
  const hasHeroImage = hasPublicImage('hero.jpg');

  return (
    <section className="w-full bg-gradient-to-b from-cream to-cream-deep">
      <div className="mx-auto grid max-w-[1280px] items-center gap-10 px-4 py-12 sm:px-10 lg:min-h-[440px] lg:grid-cols-2 lg:gap-16 lg:py-16">
        <div>
          <p className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink">
            <StarIcon className="size-3 text-brand" />
            {site.hero.pill}
          </p>

          <h1 className="mt-5 text-[34px] font-bold leading-[1.1] tracking-[-0.02em] text-ink lg:text-[50px]">
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

          <ul className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            {site.trust.map((item) => {
              const Icon = trustIcons[item.icon];
              return (
                <li key={item.title} className="flex items-start gap-2.5">
                  <Icon className="mt-0.5 size-5 shrink-0 text-brand" />
                  <div>
                    <p className="text-[12px] font-semibold text-ink">{item.title}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{item.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Arch-shaped image panel */}
        <div className="relative mx-auto w-full max-w-[380px] lg:max-w-none">
          <div className="relative aspect-[4/5] w-full overflow-hidden rounded-t-[200px] rounded-b-3xl bg-cream-deep">
            {hasHeroImage ? (
              <Image
                src="/hero.jpg"
                alt="Model wearing pieces from the new Abstract Lifestyle collection"
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 40vw"
                className="object-cover"
              />
            ) : (
              <ProductImage src={null} name="the new collection" />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

import Image from 'next/image';
import Link from 'next/link';
import { BrandPanel } from '@/components/ui/BrandPanel';
import { hasPublicImage } from '@/components/home/local-image';
import { ArrowRightIcon } from '@/components/ui/icons';
import { site } from '@/config/site';

const focusClass =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * Wide promo card: "JUST ARRIVED" pill, heading, one sentence and a green CTA
 * on the left; two fixed-ratio images (/public/promo-1.jpg wide,
 * /public/promo-2.jpg portrait) on the right. Neutral placeholders when the
 * marketing images are not present. No countdowns, timers or percentages.
 */
export function PromoBanner() {
  const hasWide = hasPublicImage('promo-1.jpg');
  const hasPortrait = hasPublicImage('promo-2.jpg');

  return (
    <section aria-labelledby="promo-heading" className="rounded-[10px] bg-[#efeee6] px-6 py-8 sm:px-10">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
        <div className="max-w-xl">
          <p className="inline-flex rounded-full bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink">
            {site.promo.pill}
          </p>
          <h3
            id="promo-heading"
            className="mt-3 text-[20px] font-bold tracking-[-0.02em] text-ink sm:text-[22px]"
          >
            {site.promo.title}
          </h3>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">{site.promo.text}</p>
          <Link
            href={site.promo.cta.href}
            className={`mt-5 inline-flex h-11 items-center gap-2 rounded-md bg-brand px-6 text-sm font-medium text-white transition-colors hover:bg-brand-dark ${focusClass}`}
          >
            {site.promo.cta.label}
            <ArrowRightIcon className="size-4" />
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative h-28 w-44 shrink-0 overflow-hidden rounded-lg bg-white/50 sm:h-32 sm:w-52 lg:h-36 lg:w-56">
            {hasWide ? (
              <Image
                src="/promo-1.jpg"
                alt="A wide look from the latest arrivals"
                fill
                sizes="(max-width: 1024px) 208px, 224px"
                className="object-cover"
              />
            ) : (
              <BrandPanel compact label="A wide look from the latest arrivals" />
            )}
          </div>
          <div className="relative h-28 w-24 shrink-0 overflow-hidden rounded-lg bg-white/50 sm:h-32 sm:w-28 lg:h-36 lg:w-32">
            {hasPortrait ? (
              <Image
                src="/promo-2.jpg"
                alt="A portrait look from the latest arrivals"
                fill
                sizes="(max-width: 1024px) 112px, 128px"
                className="object-cover"
              />
            ) : (
              <BrandPanel compact label="A portrait look from the latest arrivals" />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

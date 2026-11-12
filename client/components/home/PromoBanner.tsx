import Image from 'next/image';
import Link from 'next/link';
import { hasPublicImage } from '@/components/home/local-image';
import { ArrowRightIcon } from '@/components/ui/icons';
import { site } from '@/config/site';
import { cn } from '@/lib/utils/cn';
import type { AdminImageAsset } from '@/lib/types';

const focusClass =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

interface PromoImages {
  wide?: AdminImageAsset | null;
  portrait?: AdminImageAsset | null;
}

/**
 * Wide promo card: "JUST ARRIVED" pill, heading, one sentence and a green CTA
 * on the left. Image resolution order per block: admin-managed slot → legacy
 * /public/promo-*.jpg → nothing.
 *
 * Layout follows the images that actually exist: two images → the compact pair;
 * one image → a single full-width photo (never a brand chip beside a real
 * photo); no images → no image area, the text fills the banner.
 */
export function PromoBanner({ images }: { images?: PromoImages }) {
  const wideSrc = images?.wide?.url ?? (hasPublicImage('promo-1.jpg') ? '/promo-1.jpg' : null);
  const portraitSrc = images?.portrait?.url ?? (hasPublicImage('promo-2.jpg') ? '/promo-2.jpg' : null);
  const hasBoth = Boolean(wideSrc && portraitSrc);
  const singleSrc = hasBoth ? null : (wideSrc ?? portraitSrc);

  return (
    <section aria-labelledby="promo-heading" className="rounded-[10px] bg-[#efeee6] px-6 py-8 sm:px-10">
      <div
        className={cn(
          'flex flex-col gap-8',
          hasBoth && 'lg:flex-row lg:items-center lg:justify-between lg:gap-12',
        )}
      >
        <div className={hasBoth ? 'max-w-xl' : 'max-w-2xl'}>
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

        {hasBoth ? (
          <div className="flex items-center gap-3">
            <div className="relative h-28 w-44 shrink-0 overflow-hidden rounded-lg bg-white/50 sm:h-32 sm:w-52 lg:h-36 lg:w-56">
              <Image
                src={wideSrc as string}
                alt="A wide look from the latest arrivals"
                fill
                sizes="(max-width: 1024px) 208px, 224px"
                className="object-cover"
              />
            </div>
            <div className="relative h-28 w-24 shrink-0 overflow-hidden rounded-lg bg-white/50 sm:h-32 sm:w-28 lg:h-36 lg:w-32">
              <Image
                src={portraitSrc as string}
                alt="A portrait look from the latest arrivals"
                fill
                sizes="(max-width: 1024px) 112px, 128px"
                className="object-cover"
              />
            </div>
          </div>
        ) : singleSrc ? (
          <div className="relative aspect-[16/10] w-full overflow-hidden rounded-lg bg-white/50 sm:aspect-[21/9]">
            <Image
              src={singleSrc}
              alt="A look from the latest arrivals"
              fill
              sizes="(max-width: 1024px) 100vw, 1152px"
              className="object-cover"
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}


import { cn } from '@/lib/utils/cn';

interface BrandPanelProps {
  /** Accessible description of the panel. */
  label: string;
  /** Optional short caption under the brand mark. */
  caption?: string;
  /** Smaller mark for compact panels (promo thumbnails). */
  compact?: boolean;
  className?: string;
}

/**
 * Decorative brand panel used where a marketing/product photo is missing, so an
 * empty image slot reads as intentional design instead of a broken image.
 * Pure markup (no hooks) — safe in server and client components.
 */
export function BrandPanel({ label, caption, compact = false, className }: BrandPanelProps) {
  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        'relative flex h-full w-full flex-col items-center justify-center gap-2.5 overflow-hidden bg-gradient-to-br from-[#eef2e9] via-cream to-cream-deep',
        className,
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 200 200"
        preserveAspectRatio="xMidYMid slice"
        className="pointer-events-none absolute inset-0 h-full w-full text-brand"
      >
        <circle cx="168" cy="26" r="86" fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1.5" />
        <circle cx="150" cy="186" r="72" fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="1.5" />
        <circle cx="150" cy="186" r="44" fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1.5" />
      </svg>
      <span
        className={cn(
          'relative grid place-items-center rounded-xl bg-brand font-bold tracking-tight text-white shadow-sm',
          compact ? 'size-7 text-[11px]' : 'size-12 text-lg',
        )}
      >
        AL
      </span>
      {caption && !compact ? (
        <span className="relative text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-dark/70">
          {caption}
        </span>
      ) : null}
    </div>
  );
}
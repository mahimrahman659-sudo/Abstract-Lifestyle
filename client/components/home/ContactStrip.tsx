import Link from 'next/link';
import { SupportIcon } from '@/components/ui/icons';
import { site } from '@/config/site';

const focusClass =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** Contact strip — replaces any newsletter row. */
export function ContactStrip() {
  return (
    <section className="flex flex-col items-start gap-4 rounded-[10px] bg-tile px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#e9e9e5] text-ink">
          <SupportIcon className="size-5" />
        </span>
        <p className="text-[14px] font-medium text-ink">{site.contactStrip.text}</p>
      </div>
      <Link
        href={site.contactStrip.cta.href}
        className={`inline-flex h-10 shrink-0 items-center rounded-md bg-brand px-5 text-[13px] font-medium text-white transition-colors hover:bg-brand-dark ${focusClass}`}
      >
        {site.contactStrip.cta.label}
      </Link>
    </section>
  );
}

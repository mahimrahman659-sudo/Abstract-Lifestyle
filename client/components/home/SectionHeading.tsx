import Link from 'next/link';
import { ArrowRightIcon } from '@/components/ui/icons';

const focusClass =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** Section heading with an optional right-aligned "View all" link. */
export function SectionHeading({
  title,
  linkLabel,
  href,
  id,
}: {
  title: string;
  linkLabel: string;
  href: string;
  id: string;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <h2 id={id} className="text-[22px] font-bold tracking-[-0.02em] text-ink sm:text-[24px]">
        {title}
      </h2>
      <Link
        href={href}
        className={`inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-accent hover:underline ${focusClass}`}
      >
        {linkLabel}
        <ArrowRightIcon className="size-3.5" />
      </Link>
    </div>
  );
}

'use client';

interface NewArrivalBadgeProps {
  /**
   * "New Arrival" flag (product created within the last 14 days). Computed on
   * the server from the cached cutoff snapshot and passed down as a prop —
   * this component never reads the clock, so it cannot cause a hydration
   * mismatch. Placeholder styling; the redesign restyles it later.
   */
  isNew: boolean;
}

export function NewArrivalBadge({ isNew }: NewArrivalBadgeProps) {
  if (!isNew) {
    return null;
  }

  return (
    <span className="inline-flex w-fit items-center gap-1.5 self-start rounded-full bg-brand px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-white/80" />
      New Arrival
    </span>
  );
}
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
    <span className="inline-flex w-fit items-center self-start rounded-md bg-[#f1f1ef] px-2.5 py-1 text-[11px] font-medium text-ink">
      New Arrival
    </span>
  );
}
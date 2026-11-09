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
    <span className="inline-block rounded-[4px] bg-brand px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
      New Arrival
    </span>
  );
}
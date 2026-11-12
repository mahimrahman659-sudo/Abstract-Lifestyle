import { cn } from '@/lib/utils/cn';

const STEPS = ['Cart', 'Checkout', 'Done'] as const;
export type CheckoutStep = (typeof STEPS)[number];

/**
 * Small cart → checkout → done progress indicator. The current step carries
 * aria-current="step"; completed steps are linked so the shopper can go back.
 */
export function CheckoutSteps({ current }: { current: CheckoutStep }) {
  const currentIndex = STEPS.indexOf(current);

  return (
    <nav aria-label="Checkout progress" className="mb-6">
      <ol className="flex flex-wrap items-center gap-y-2 text-sm">
        {STEPS.map((step, index) => {
          const state =
            index === currentIndex ? 'current' : index < currentIndex ? 'done' : 'upcoming';
          return (
            <li key={step} className="flex items-center">
              {index > 0 ? (
                <span aria-hidden="true" className="mx-2 h-px w-6 bg-line sm:w-10" />
              ) : null}
              {state === 'done' && index === 0 ? (
                <a
                  href="/cart"
                  className={cn(
                    'inline-flex min-h-11 items-center gap-2 rounded-full px-2 text-muted hover:text-ink',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  )}
                >
                  <span className="grid size-6 place-items-center rounded-full bg-success/15 text-xs font-semibold text-success">
                    ✓
                  </span>
                  {step}
                </a>
              ) : (
                <span
                  aria-current={state === 'current' ? 'step' : undefined}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-2 rounded-full px-2',
                    state === 'current' ? 'font-semibold text-ink' : 'text-muted',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'grid size-6 place-items-center rounded-full text-xs font-semibold',
                      state === 'current'
                        ? 'bg-brand text-white'
                        : state === 'done'
                          ? 'bg-success/15 text-success'
                          : 'border border-line text-muted',
                    )}
                  >
                    {state === 'done' ? '✓' : index + 1}
                  </span>
                  {step}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

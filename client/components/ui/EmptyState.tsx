import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Heading level for the title (default h2; the 404 page uses h1). */
  headingLevel?: 'h1' | 'h2';
}

export function EmptyState({ title, description, action, headingLevel = 'h2' }: EmptyStateProps) {
  const Heading = headingLevel;
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      <Heading className="text-lg font-semibold text-ink">{title}</Heading>
      {description ? <p className="max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

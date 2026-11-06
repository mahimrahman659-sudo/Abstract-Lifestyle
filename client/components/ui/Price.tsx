import { cn } from '@/lib/utils/cn';
import { formatPoisha } from '@/lib/utils/money';

export interface PriceProps {
  poisha: number;
  className?: string;
}

/** Renders an integer poisha amount as a BDT display string. */
export function Price({ poisha, className }: PriceProps) {
  return <span className={cn('tabular-nums', className)}>{formatPoisha(poisha)}</span>;
}

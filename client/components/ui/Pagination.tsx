import { Button } from './Button';
import { cn } from '@/lib/utils/cn';

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({ page, totalPages, onPageChange, className }: PaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <nav aria-label="Pagination" className={cn('flex items-center justify-center gap-4', className)}>
      <Button
        variant="secondary"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </Button>
      <p aria-live="polite" className="text-sm text-muted">
        Page {page} of {totalPages}
      </p>
      <Button
        variant="secondary"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}

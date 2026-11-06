import type { OrderStatus } from '@/lib/types';
import { cn } from '@/lib/utils/cn';

const statusClasses: Record<OrderStatus, string> = {
  pending: 'border-line bg-paper text-ink',
  processing: 'border-accent/40 bg-accent/10 text-accent',
  shipped: 'border-accent/40 bg-accent/10 text-accent',
  delivered: 'border-success/40 bg-success/10 text-success',
  cancelled: 'border-danger/40 bg-danger/10 text-danger',
};

const statusLabels: Record<OrderStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        statusClasses[status],
      )}
    >
      {statusLabels[status]}
    </span>
  );
}

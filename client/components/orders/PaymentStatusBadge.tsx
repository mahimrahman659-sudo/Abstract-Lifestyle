import type { PaymentStatus } from '@/lib/types';
import { cn } from '@/lib/utils/cn';

const statusClasses: Record<PaymentStatus, string> = {
  unpaid: 'border-line bg-tile text-muted',
  awaiting_payment: 'border-accent/40 bg-accent/10 text-accent',
  pending_verification: 'border-warning/40 bg-warning/10 text-ink',
  paid: 'border-success/40 bg-success/10 text-success',
  rejected: 'border-danger/40 bg-danger/10 text-danger',
  refund_pending: 'border-warning/40 bg-warning/10 text-ink',
  refunded: 'border-success/40 bg-success/10 text-success',
  cancelled: 'border-line bg-tile text-muted',
};

const statusLabels: Record<PaymentStatus, string> = {
  unpaid: 'Payment due',
  awaiting_payment: 'Awaiting payment',
  pending_verification: 'Verification pending',
  paid: 'Paid',
  rejected: 'Payment rejected',
  refund_pending: 'Refund pending',
  refunded: 'Refunded',
  cancelled: 'Payment cancelled',
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
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

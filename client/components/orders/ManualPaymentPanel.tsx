'use client';

import { useRef, useState, type FormEvent } from 'react';
import { PaymentStatusBadge } from '@/components/orders/PaymentStatusBadge';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { Price } from '@/components/ui/Price';
import { Skeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api/client';
import { orderApi } from '@/lib/api/order';
import type { OrderDto, PublicPaymentMethod } from '@/lib/types';
import {
  normalizeSenderNumber,
  normalizeTrxId,
  validateManualPayment,
  type ManualPaymentErrors,
} from '@/lib/validation/payment';

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function ManualPaymentPanel({
  order,
  method,
  loading,
  loadError,
  onOrderChange,
}: {
  order: OrderDto;
  method: PublicPaymentMethod | null;
  loading: boolean;
  loadError: string | null;
  onOrderChange: (order: OrderDto) => void;
}) {
  const [senderNumber, setSenderNumber] = useState('');
  const [trxId, setTrxId] = useState('');
  const [errors, setErrors] = useState<ManualPaymentErrors>({});
  const [notice, setNotice] = useState<{ tone: 'info' | 'success' | 'error'; message: string } | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const inFlightRef = useRef(false);

  const canSubmit =
    order.paymentStatus === 'awaiting_payment' || order.paymentStatus === 'rejected';
  const bounds = {
    min: method?.trxIdMinLength ?? 6,
    max: method?.trxIdMaxLength ?? 32,
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (inFlightRef.current || !canSubmit) {
      return;
    }
    const validation = validateManualPayment({ senderNumber, trxId }, bounds);
    setErrors(validation);
    setNotice(null);
    if (Object.keys(validation).length > 0) {
      return;
    }

    inFlightRef.current = true;
    setSubmitting(true);
    void (async () => {
      try {
        const { order: updated } = await orderApi.submitPayment(order.id, {
          senderNumber: normalizeSenderNumber(senderNumber),
          trxId: normalizeTrxId(trxId),
        });
        onOrderChange(updated);
        setSenderNumber('');
        setTrxId('');
        setNotice({
          tone: 'success',
          message: 'Payment details submitted. We will verify them before dispatch.',
        });
      } catch (error) {
        if (error instanceof ApiError && error.code === 'PAYMENT_TRX_ID_USED') {
          setErrors({ trxId: error.message });
        } else if (
          error instanceof ApiError &&
          (error.code === 'PAYMENT_CLAIM_LOCKED' || error.code === 'PAYMENT_CLAIM_CONFLICT')
        ) {
          setNotice({ tone: 'info', message: error.message });
          try {
            const { order: fresh } = await orderApi.get(order.id);
            onOrderChange(fresh);
          } catch {
            // Keep the current view; the user can refresh the page.
          }
        } else if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
          const next: ManualPaymentErrors = {};
          for (const detail of error.details) {
            if (detail.path === 'senderNumber') next.senderNumber = detail.message;
            if (detail.path === 'trxId') next.trxId = detail.message;
          }
          setErrors(next);
          if (Object.keys(next).length === 0) {
            setNotice({ tone: 'error', message: error.message });
          }
        } else {
          setNotice({
            tone: 'error',
            message:
              error instanceof ApiError
                ? error.message
                : 'Could not submit your payment details. Please try again.',
          });
        }
      } finally {
        inFlightRef.current = false;
        setSubmitting(false);
      }
    })();
  };

  const currentClaim = order.payment.claims[order.payment.claims.length - 1] ?? null;

  return (
    <section
      aria-labelledby="payment-detail-heading"
      className="rounded-2xl border border-line bg-surface p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="payment-detail-heading" className="text-base font-semibold text-ink">
          Payment
        </h2>
        <PaymentStatusBadge status={order.paymentStatus} />
      </div>

      {loading ? (
        <Skeleton className="mt-4 h-24 w-full rounded-xl" />
      ) : loadError ? (
        <p className="mt-3 text-sm text-danger">{loadError}</p>
      ) : method && !method.enabled ? (
        <Notice tone="info" className="mt-3">
          This payment method is not available right now. Do not send money; contact support so we
          can help with your order.
        </Notice>
      ) : !method ? (
        <Notice tone="info" className="mt-3">
          Payment instructions are unavailable right now. Refresh the page or contact support
          before sending money.
        </Notice>
      ) : null}

      {method?.enabled ? (
        <div className="mt-4 space-y-4">
          {canSubmit ? (
            <div className="rounded-xl border border-line bg-tile p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Send exactly</p>
              <p className="mt-0.5 text-lg font-semibold text-ink">
                <Price poisha={order.total} />
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted">Receiving number</span>
                <span className="font-mono text-base font-semibold tracking-wide text-ink">
                  {method.receivingNumber}
                </span>
                {method.receivingNumber ? (
                  <CopyButton
                    value={method.receivingNumber}
                    label="Copy number"
                    announcement={`${method.label} receiving number copied`}
                  />
                ) : null}
              </div>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-xs text-muted">
                {method.instructions.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {order.paymentStatus === 'pending_verification' ? (
            <Notice tone="info">
              <p className="font-medium">Your payment is being verified.</p>
              <p className="mt-1 text-xs">
                We will confirm the payment before dispatch. Do not send a second payment for this
                order.
              </p>
              {currentClaim ? (
                <dl className="mt-3 grid gap-1 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt>Sender number</dt>
                    <dd className="font-medium">{currentClaim.senderNumber}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Transaction ID</dt>
                    <dd className="font-mono font-medium">{currentClaim.trxId}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Submitted</dt>
                    <dd className="font-medium">{formatDate(currentClaim.submittedAt)}</dd>
                  </div>
                </dl>
              ) : null}
            </Notice>
          ) : null}

          {order.paymentStatus === 'rejected' ? (
            <Notice tone="error">
              <p className="font-medium">Your payment could not be verified.</p>
              {order.payment.rejectionReason ? (
                <p className="mt-1 text-xs">Reason: {order.payment.rejectionReason}</p>
              ) : null}
              <p className="mt-2 text-xs">
                Check the transaction with your provider before resubmitting. Use a valid
                transaction ID that has not been submitted before.
              </p>
            </Notice>
          ) : null}

          {order.paymentStatus === 'paid' ? (
            <Notice tone="success">
              Payment verified. Your order is confirmed and will be prepared for dispatch.
            </Notice>
          ) : null}

          {order.paymentStatus === 'refund_pending' ? (
            <Notice tone="info">
              This paid order was cancelled. A manual refund is pending; our team will contact you.
              No automatic refund has been issued.
            </Notice>
          ) : null}

          {order.paymentStatus === 'refunded' ? (
            <Notice tone="success">
              <p>The manual refund for this order is marked complete.</p>
              {order.payment.refundReference ? (
                <p className="mt-1 text-xs">
                  Provider reference{' '}
                  <span className="font-mono">{order.payment.refundReference}</span>
                  {order.payment.refundAmount !== null ? (
                    <> · amount <Price poisha={order.payment.refundAmount} /></>
                  ) : null}
                  {order.payment.refundRecipient ? (
                    <> · recipient {order.payment.refundRecipient}</>
                  ) : null}
                </p>
              ) : null}
            </Notice>
          ) : null}

          {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

          {canSubmit ? (
            <form onSubmit={onSubmit} noValidate className="space-y-4 border-t border-line pt-4">
              <p className="text-sm font-medium text-ink">
                Submit your payment details
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  id="payment-sender-number"
                  label="Sender wallet number"
                  hint="The number you sent the money from."
                  inputMode="tel"
                  autoComplete="tel"
                  value={senderNumber}
                  error={errors.senderNumber}
                  disabled={submitting}
                  onChange={(event) => {
                    setSenderNumber(event.target.value);
                    setErrors((previous) => ({ ...previous, senderNumber: undefined }));
                  }}
                />
                <Input
                  id="payment-trx-id"
                  label="Transaction ID"
                  hint="From your payment confirmation message."
                  value={trxId}
                  error={errors.trxId}
                  disabled={submitting}
                  maxLength={64}
                  onChange={(event) => {
                    setTrxId(event.target.value);
                    setErrors((previous) => ({ ...previous, trxId: undefined }));
                  }}
                />
              </div>
              <p className="text-xs text-muted">
                We never ask for your wallet PIN, OTP or password. Only share the sender number and
                transaction ID.
              </p>
              <Button
                type="submit"
                loading={submitting}
                disabled={submitting}
                className="min-h-11 w-full sm:w-auto"
              >
                Submit for verification
              </Button>
            </form>
          ) : null}

          {order.payment.verificationHistory.length > 0 ? (
            <div className="border-t border-line pt-4">
              <h3 className="text-sm font-semibold text-ink">Payment history</h3>
              <ol className="mt-2 space-y-1.5 text-xs text-muted">
                {order.payment.verificationHistory.map((entry, index) => (
                  <li key={`${entry.action}-${entry.at}-${index}`}>
                    <span className="font-medium capitalize text-ink">{entry.action}</span> —{' '}
                    {formatDate(entry.at)}
                    {entry.actor ? ` · ${entry.actor}` : ''}
                    {entry.reason ? ` · ${entry.reason}` : ''}
                    {entry.refundReference ? (
                      <> · refund reference <span className="font-mono">{entry.refundReference}</span></>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

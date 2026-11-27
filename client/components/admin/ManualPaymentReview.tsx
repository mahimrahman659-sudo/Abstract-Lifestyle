'use client';

import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { PaymentStatusBadge } from '@/components/orders/PaymentStatusBadge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Notice, type NoticeTone } from '@/components/ui/Notice';
import { Price } from '@/components/ui/Price';
import { Textarea } from '@/components/ui/Textarea';
import { adminApi } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import { paymentApi } from '@/lib/api/payment';
import type { OrderDto, PublicPaymentMethod } from '@/lib/types';
import {
  normalizeSenderNumber,
  parseBdtToPoisha,
  validateRefundEvidence,
  type RefundEvidenceErrors,
} from '@/lib/validation/payment';

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function ManualPaymentReview({
  order,
  onOrderChange,
  onNotice,
  onRefresh,
}: {
  order: OrderDto;
  onOrderChange: (order: OrderDto) => void;
  onNotice: (notice: { tone: NoticeTone; message: string } | null) => void;
  onRefresh: () => void;
}) {
  const [methods, setMethods] = useState<PublicPaymentMethod[]>([]);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundReference, setRefundReference] = useState('');
  const [refundAmountBdt, setRefundAmountBdt] = useState((order.total / 100).toFixed(2));
  const [refundRecipient, setRefundRecipient] = useState(order.payment.senderNumber ?? '');
  const [refundConfirmed, setRefundConfirmed] = useState(false);
  const [refundErrors, setRefundErrors] = useState<RefundEvidenceErrors>({});
  const [refundNote, setRefundNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { methods: items } = await paymentApi.methods();
        if (!cancelled) setMethods(items);
      } catch {
        // The admin can still review using the provider statement.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const method = methods.find((item) => item.method === order.paymentMethod) ?? null;
  const pendingClaim = [...order.payment.claims]
    .reverse()
    .find((claim) => claim.status === 'pending_verification');

  const decide = (decision: 'paid' | 'rejected', rejectionReason?: string) => {
    if (!pendingClaim) {
      onNotice({ tone: 'error', message: 'No pending payment claim to review.' });
      return;
    }
    if (decision === 'rejected' && (!rejectionReason || rejectionReason.trim().length < 3)) {
      setReasonError('Enter a rejection reason (at least 3 characters).');
      return;
    }
    setBusy(true);
    onNotice(null);
    void (async () => {
      try {
        const { order: updated } = await adminApi.reviewPayment(order.id, {
          claimId: pendingClaim.id,
          decision,
          ...(rejectionReason ? { rejectionReason: rejectionReason.trim() } : {}),
        });
        onOrderChange(updated);
        onNotice({
          tone: 'success',
          message:
            decision === 'paid'
              ? 'Payment verified and marked paid.'
              : 'Payment claim rejected. The customer can resubmit valid details.',
        });
        setRejecting(false);
        setReason('');
        setApproveOpen(false);
      } catch (error) {
        onNotice({
          tone: 'error',
          message:
            error instanceof ApiError
              ? error.message
              : 'Could not record the payment decision.',
        });
        onRefresh();
      } finally {
        setBusy(false);
      }
    })();
  };

  const completeRefund = () => {
    const validation = validateRefundEvidence(
      { refundReference, refundAmountBdt, refundRecipient, confirmed: refundConfirmed },
      order.total,
      order.payment.senderNumber,
    );
    setRefundErrors(validation);
    onNotice(null);
    if (Object.keys(validation).length > 0) {
      return;
    }
    const refundAmount = parseBdtToPoisha(refundAmountBdt);
    if (refundAmount === null) {
      return;
    }

    setBusy(true);
    void (async () => {
      try {
        const { order: updated } = await adminApi.completeRefund(order.id, {
          refundReference: refundReference.trim(),
          refundAmount,
          refundRecipient: normalizeSenderNumber(refundRecipient),
          confirmed: true,
          ...(refundNote.trim() ? { note: refundNote.trim() } : {}),
        });
        onOrderChange(updated);
        onNotice({ tone: 'success', message: 'Manual refund recorded with provider evidence.' });
        setRefundOpen(false);
        setRefundErrors({});
        setRefundReference('');
        setRefundConfirmed(false);
        setRefundNote('');
      } catch (error) {
        if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
          const next: RefundEvidenceErrors = {};
          for (const detail of error.details) {
            if (detail.path === 'refundReference') next.refundReference = detail.message;
            if (detail.path === 'refundAmount') next.refundAmountBdt = detail.message;
            if (detail.path === 'refundRecipient') next.refundRecipient = detail.message;
            if (detail.path === 'confirmed') next.confirmed = detail.message;
          }
          setRefundErrors(next);
          if (Object.keys(next).length === 0) {
            onNotice({ tone: 'error', message: error.message });
          }
        } else {
          onNotice({
            tone: 'error',
            message:
              error instanceof ApiError ? error.message : 'Could not complete the manual refund.',
          });
          onRefresh();
        }
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <section
      aria-labelledby="admin-payment-heading"
      className="rounded-2xl border border-line bg-surface p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="admin-payment-heading" className="text-base font-semibold text-ink">
          Payment verification
        </h2>
        <PaymentStatusBadge status={order.paymentStatus} />
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted">Payable total (authoritative)</dt>
          <dd className="text-lg font-semibold text-ink">
            <Price poisha={order.total} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Method</dt>
          <dd className="font-medium capitalize text-ink">{order.paymentMethod}</dd>
        </div>
        {method ? (
          <div>
            <dt className="text-xs text-muted">Configured receiving account</dt>
            <dd className="font-mono font-medium text-ink">
              {method.receivingNumber ?? 'Not configured'}
              {method.enabled ? null : ' (provider disabled)'}
            </dd>
          </div>
        ) : null}
        {pendingClaim ? (
          <>
            <div>
              <dt className="text-xs text-muted">Sender number</dt>
              <dd className="font-medium text-ink">{pendingClaim.senderNumber}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Transaction ID</dt>
              <dd className="font-mono font-medium text-ink">{pendingClaim.trxId}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Submitted</dt>
              <dd className="font-medium text-ink">{formatDate(pendingClaim.submittedAt)}</dd>
            </div>
          </>
        ) : (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted">Latest claim</dt>
            <dd className="text-muted">
              No claim is pending verification. Check the history below.
            </dd>
          </div>
        )}
      </dl>

      {order.payment.rejectionReason ? (
        <Notice tone="error" className="mt-4">
          Rejected: {order.payment.rejectionReason}
        </Notice>
      ) : null}

      {order.paymentStatus === 'pending_verification' ? (
        <div className="mt-4 space-y-3 rounded-xl border border-line bg-tile p-4">
          <p className="text-sm font-semibold text-ink">Verify against the receiving account</p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
            <li>Check the recipient account in the actual provider statement/receiving device.</li>
            <li>Check that the received amount equals the authoritative order total.</li>
            <li>Check that the sender number and transaction ID match the provider record.</li>
            <li>Do not mark paid from the TrxID format alone; verify the money was received.</li>
          </ul>

          {rejecting ? (
            <div className="space-y-3">
              <Textarea
                id="payment-rejection-reason"
                label="Rejection reason (required)"
                hint="The customer will see this reason and can resubmit valid details."
                value={reason}
                error={reasonError ?? undefined}
                disabled={busy}
                maxLength={500}
                onChange={(event) => {
                  setReason(event.target.value);
                  setReasonError(null);
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  loading={busy}
                  disabled={busy}
                  onClick={() => decide('rejected', reason)}
                >
                  Confirm rejection
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setRejecting(false);
                    setReason('');
                    setReasonError(null);
                  }}
                >
                  Back
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => setApproveOpen(true)}>
                Mark paid
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => setRejecting(true)}>
                Reject payment
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {order.paymentStatus === 'refund_pending' ? (
        <div className="mt-4 rounded-xl border border-line bg-tile p-4">
          <p className="text-sm font-semibold text-ink">Manual refund pending</p>
          <p className="mt-1 text-xs text-muted">
            Complete the refund through the provider first. Then enter the provider reference, the
            exact amount and the customer account from the actual refund record. No refund is
            automated.
          </p>
          {refundOpen ? (
            <div className="mt-3 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  id="refund-reference"
                  label="Provider refund reference (required)"
                  hint="From the actual provider refund confirmation."
                  value={refundReference}
                  error={refundErrors.refundReference}
                  disabled={busy}
                  maxLength={100}
                  onChange={(event) => {
                    setRefundReference(event.target.value);
                    setRefundErrors((previous) => ({ ...previous, refundReference: undefined }));
                  }}
                />
                <Input
                  id="refund-amount"
                  label="Refunded amount (BDT, required)"
                  hint={`Must equal ৳${(order.total / 100).toFixed(2)}.`}
                  inputMode="decimal"
                  value={refundAmountBdt}
                  error={refundErrors.refundAmountBdt}
                  disabled={busy}
                  onChange={(event) => {
                    setRefundAmountBdt(event.target.value);
                    setRefundErrors((previous) => ({ ...previous, refundAmountBdt: undefined }));
                  }}
                />
                <Input
                  id="refund-recipient"
                  label="Customer receiving account (required)"
                  hint="Must match the account that paid for this order."
                  inputMode="tel"
                  value={refundRecipient}
                  error={refundErrors.refundRecipient}
                  disabled={busy}
                  onChange={(event) => {
                    setRefundRecipient(event.target.value);
                    setRefundErrors((previous) => ({ ...previous, refundRecipient: undefined }));
                  }}
                />
                <Input
                  id="refund-note"
                  label="Internal refund note (optional)"
                  value={refundNote}
                  disabled={busy}
                  maxLength={500}
                  onChange={(event) => setRefundNote(event.target.value)}
                />
              </div>
              <label className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={refundConfirmed}
                  disabled={busy}
                  onChange={(event) => {
                    setRefundConfirmed(event.target.checked);
                    setRefundErrors((previous) => ({ ...previous, confirmed: undefined }));
                  }}
                  className="mt-1 size-4 accent-accent"
                />
                <span>
                  I checked the actual provider refund record and confirm the customer received
                  this refund.
                </span>
              </label>
              {refundErrors.confirmed ? (
                <p role="alert" className="text-xs text-danger">
                  {refundErrors.confirmed}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button loading={busy} disabled={busy} onClick={completeRefund}>
                  Confirm refund completed
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setRefundOpen(false)}
                >
                  Back
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" className="mt-3" onClick={() => setRefundOpen(true)}>
              Record completed refund
            </Button>
          )}
        </div>
      ) : null}

      {order.paymentStatus === 'refunded' ? (
        <Notice tone="success" className="mt-4">
          Refund completed.
          {order.payment.refundReference ? (
            <>
              {' '}Provider reference <span className="font-mono">{order.payment.refundReference}</span>
              {order.payment.refundAmount !== null ? (
                <> · amount <Price poisha={order.payment.refundAmount} /></>
              ) : null}
              {order.payment.refundRecipient ? <> · recipient {order.payment.refundRecipient}</> : null}
            </>
          ) : null}
        </Notice>
      ) : null}

      {order.payment.claims.length > 0 ? (
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="text-sm font-semibold text-ink">Claim history</h3>
          <ul className="mt-2 space-y-2 text-xs text-muted">
            {order.payment.claims.map((claim) => (
              <li key={claim.id} className="rounded-lg border border-line px-3 py-2">
                <p>
                  <span className="font-medium capitalize text-ink">
                    {claim.status.replace(/_/g, ' ')}
                  </span>{' '}
                  · {formatDate(claim.submittedAt)}
                </p>
                <p>
                  Sender {claim.senderNumber} · TrxID{' '}
                  <span className="font-mono">{claim.trxId}</span>
                </p>
                {claim.reviewedAt ? (
                  <p>
                    Reviewed {formatDate(claim.reviewedAt)}
                    {claim.reviewedBy ? ` by ${claim.reviewedBy}` : ''}
                  </p>
                ) : null}
                {claim.rejectionReason ? <p>Reason: {claim.rejectionReason}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {order.payment.verificationHistory.length > 0 ? (
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="text-sm font-semibold text-ink">Verification audit trail</h3>
          <ol className="mt-2 space-y-1.5 text-xs text-muted">
            {order.payment.verificationHistory.map((entry, index) => (
              <li key={`${entry.action}-${entry.at}-${index}`}>
                <span className="font-medium capitalize text-ink">{entry.action}</span> —{' '}
                {formatDate(entry.at)}
                {entry.by
                  ? ` · ${entry.actor === 'customer' ? 'customer' : entry.actor ?? 'actor'} ${entry.by}`
                  : ''}
                {entry.reason ? ` · ${entry.reason}` : ''}
                {entry.refundReference ? (
                  <>
                    {' '}· refund reference <span className="font-mono">{entry.refundReference}</span>
                    {entry.refundAmount !== null ? (
                      <> · amount <Price poisha={entry.refundAmount} /></>
                    ) : null}
                    {entry.refundRecipient ? <> · recipient {entry.refundRecipient}</> : null}
                  </>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <ConfirmDialog
        open={approveOpen}
        title="Mark this payment as paid?"
        message={`Confirm that ৳${(order.total / 100).toFixed(2)} was received in the configured account with the submitted sender number and transaction ID. This cannot be undone from this screen.`}
        confirmLabel="Yes, mark paid"
        confirmVariant="primary"
        busy={busy}
        onConfirm={() => decide('paid')}
        onCancel={() => setApproveOpen(false)}
      />
    </section>
  );
}

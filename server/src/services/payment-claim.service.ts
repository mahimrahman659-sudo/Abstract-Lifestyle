import mongoose from 'mongoose';
import { getManualPaymentConfig } from '../config/payment.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error-handler.js';
import {
  OrderModel,
  type OrderDocument,
  type PaymentClaim,
} from '../models/order.model.js';
import type { UserDocument } from '../models/user.model.js';
import {
  manualPaymentSubmissionSchema,
  type ManualPaymentSubmissionInput,
} from '../schemas/order.schema.js';
import type {
  AdminPaymentRefundInput,
  AdminPaymentReviewInput,
} from '../schemas/admin.schema.js';
import { assertPaymentIndexReadyForManualOperations } from '../config/payment-index.js';
import { isValidTrxId, normalizeSenderNumber, normalizeTrxId, PAYMENT_METHOD_LABELS } from '../utils/payment.js';
import { normalizeBdMobile } from '../utils/phone.js';
import { deliverNotifications, enqueueNotification } from './notification.service.js';
import { toOrderDto, type OrderDto } from './order.service.js';
import { emitServerEvent } from './activity.service.js';
import { deterministicEventId } from '../utils/event-id.js';

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === 11000;

const pendingClaimOf = (order: OrderDocument): PaymentClaim | null =>
  order.payment?.claims.find((claim) => claim.status === 'pending_verification') ?? null;

const claimMatches = (
  claim: PaymentClaim | null,
  senderNumber: string,
  trxIdNormalized: string,
): boolean =>
  claim !== null &&
  claim.senderNumber === senderNumber &&
  claim.trxIdNormalized === trxIdNormalized;

const loadOwnedOrder = async (
  userId: string,
  orderId: string,
  session?: mongoose.ClientSession,
): Promise<OrderDocument> => {
  const query = OrderModel.findOne({ _id: orderId, user: userId });
  const order = await (session ? query.session(session) : query).exec();
  if (!order) {
    throw new AppError(404, 'NOT_FOUND', 'Order not found');
  }
  return order;
};

/**
 * Customer submits sender + TrxID for their own manual-payment order.
 *
 * Idempotent when the exact same claim is retried while pending. Any different
 * claim is rejected unless the order is awaiting payment or was rejected.
 */
export const submitManualPayment = async (
  user: UserDocument,
  orderId: string,
  rawInput: ManualPaymentSubmissionInput,
): Promise<OrderDto> => {
  const input = manualPaymentSubmissionSchema.parse(rawInput);
  const senderNumber = normalizeSenderNumber(input.senderNumber);
  const trxIdNormalized = normalizeTrxId(input.trxId);

  if (senderNumber === null) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Enter a valid Bangladeshi sender mobile number.');
  }
  if (!isValidTrxId(trxIdNormalized, env.MFS_TRX_ID_MIN_LENGTH, env.MFS_TRX_ID_MAX_LENGTH)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Enter a valid transaction ID.');
  }

  const preflight = await loadOwnedOrder(user._id.toString(), orderId);
  if (preflight.paymentMethod === 'cod') {
    throw new AppError(409, 'NOT_MANUAL_PAYMENT', 'This order does not use a manual payment method.');
  }
  await assertPaymentIndexReadyForManualOperations();
  if (!getManualPaymentConfig(preflight.paymentMethod).enabled) {
    throw new AppError(
      409,
      'PAYMENT_METHOD_UNAVAILABLE',
      'This payment method is not available right now. Contact support before sending money.',
    );
  }

  if (preflight.paymentStatus === 'pending_verification') {
    if (claimMatches(pendingClaimOf(preflight), senderNumber, trxIdNormalized)) {
      return toOrderDto(preflight);
    }
    throw new AppError(
      409,
      'PAYMENT_CLAIM_LOCKED',
      'Your payment details are already under verification and cannot be changed. Contact support if they are wrong.',
    );
  }

  if (preflight.paymentStatus !== 'awaiting_payment' && preflight.paymentStatus !== 'rejected') {
    throw new AppError(
      409,
      'PAYMENT_STATE_INVALID',
      'This order is not accepting payment details right now.',
    );
  }

  const alreadyUsed = await OrderModel.exists({
    'payment.claims.trxIdNormalized': trxIdNormalized,
  });
  if (alreadyUsed) {
    throw new AppError(
      409,
      'PAYMENT_TRX_ID_USED',
      'This transaction ID has already been submitted. Check the ID or contact support.',
    );
  }

  const session = await mongoose.startSession();
  const result: { order: OrderDto | null; freshClaimId: string | null } = {
    order: null,
    freshClaimId: null,
  };

  try {
    try {
      await session.withTransaction(async () => {
        const order = await loadOwnedOrder(user._id.toString(), orderId, session);

        if (order.paymentStatus === 'pending_verification') {
          if (claimMatches(pendingClaimOf(order), senderNumber, trxIdNormalized)) {
            result.order = toOrderDto(order);
            return;
          }
          throw new AppError(409, 'PAYMENT_CLAIM_LOCKED', 'Payment details are already under verification.');
        }

        if (order.paymentStatus !== 'awaiting_payment' && order.paymentStatus !== 'rejected') {
          throw new AppError(409, 'PAYMENT_STATE_INVALID', 'This order is not accepting payment details.');
        }

        const duplicate = await OrderModel.exists({
          'payment.claims.trxIdNormalized': trxIdNormalized,
        }).session(session);
        if (duplicate) {
          throw new AppError(
            409,
            'PAYMENT_TRX_ID_USED',
            'This transaction ID has already been submitted. Check the ID or contact support.',
          );
        }

        const now = new Date();
        const claimId = new mongoose.Types.ObjectId();
        const updated = await OrderModel.findOneAndUpdate(
          {
            _id: order._id,
            user: user._id,
            paymentStatus: order.paymentStatus,
          },
          {
            $set: {
              paymentStatus: 'pending_verification',
              'payment.provider': 'manual',
              'payment.senderNumber': senderNumber,
              'payment.trxId': trxIdNormalized,
              'payment.trxIdNormalized': trxIdNormalized,
              'payment.submittedAt': now,
              'payment.verifiedBy': null,
              'payment.verifiedAt': null,
              'payment.rejectionReason': null,
            },
            $push: {
              'payment.claims': {
                _id: claimId,
                senderNumber,
                trxId: trxIdNormalized,
                trxIdNormalized,
                submittedAt: now,
                submittedBy: user._id,
                status: 'pending_verification',
                reviewedBy: null,
                reviewedAt: null,
                rejectionReason: null,
              },
              'payment.verificationHistory': {
                action: 'submitted',
                at: now,
                actor: 'customer',
                by: user._id,
                reason: null,
                senderNumber,
                trxId: trxIdNormalized,
              },
            },
          },
          { returnDocument: 'after', session },
        ).exec();

        if (!updated) {
          const fresh = await loadOwnedOrder(user._id.toString(), orderId, session);
          if (claimMatches(pendingClaimOf(fresh), senderNumber, trxIdNormalized)) {
            result.order = toOrderDto(fresh);
            return;
          }
          throw new AppError(
            409,
            'PAYMENT_CLAIM_CONFLICT',
            'Another payment submission was completed first. Refresh the order and try again.',
          );
        }

        await enqueueNotification(
          {
            user: updated.user,
            order: updated._id,
            orderNumber: updated.orderNumber,
            type: 'payment_submitted',
            message: `We received your ${PAYMENT_METHOD_LABELS[updated.paymentMethod]} payment details for order ${updated.orderNumber}. We will verify them before dispatch.`,
          },
          session,
        );

        // Only a NEWLY created claim produces an event; idempotent replays
        // of an identical pending claim (early returns above) do not.
        result.freshClaimId = claimId.toString();
        result.order = toOrderDto(updated);
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new AppError(
          409,
          'PAYMENT_TRX_ID_USED',
          'This transaction ID has already been submitted. Check the ID or contact support.',
        );
      }
      throw error;
    }
  } finally {
    await session.endSession();
  }

  if (!result.order) {
    throw new AppError(409, 'PAYMENT_CLAIM_CONFLICT', 'Payment submission did not complete.');
  }
  // Post-commit success path only. NO transaction reference or sender number
  // is ever copied into analytics — ids and outcome enums only.
  if (result.freshClaimId) {
    emitServerEvent({
      type: 'payment.claim_submitted',
      eventId: deterministicEventId(`payment.claim.submitted:${result.freshClaimId}`),
      userId: user._id,
      orderId,
    });
  }
  deliverNotifications();
  return result.order;
};

/**
 * Admin approves or rejects the exact pending claim. The filter and the
 * arrayFilters both require the claim to still be pending, so two competing
 * admins cannot apply conflicting decisions.
 */
export const reviewManualPayment = async (
  admin: UserDocument,
  orderId: string,
  input: AdminPaymentReviewInput,
): Promise<OrderDto> => {
  const preflight = await OrderModel.findById(orderId).exec();
  if (!preflight) {
    throw new AppError(404, 'NOT_FOUND', 'Order not found');
  }
  if (preflight.paymentMethod === 'cod') {
    throw new AppError(409, 'NOT_MANUAL_PAYMENT', 'This order does not use a manual payment method.');
  }
  await assertPaymentIndexReadyForManualOperations();

  const session = await mongoose.startSession();
  const result: {
    order: OrderDto | null;
    claimId: string | null;
    decision: 'paid' | 'rejected' | null;
  } = { order: null, claimId: null, decision: null };

  try {
    await session.withTransaction(async () => {
      const order = await OrderModel.findById(orderId).session(session).exec();
      if (!order) {
        throw new AppError(404, 'NOT_FOUND', 'Order not found');
      }
      if (order.paymentMethod === 'cod') {
        throw new AppError(409, 'NOT_MANUAL_PAYMENT', 'This order does not use a manual payment method.');
      }
      if (order.paymentStatus !== 'pending_verification') {
        throw new AppError(409, 'PAYMENT_CLAIM_NOT_PENDING', 'No payment claim is awaiting verification.');
      }

      const claim = order.payment?.claims.find(
        (item) => item._id?.toString() === input.claimId,
      );
      if (!claim || claim.status !== 'pending_verification') {
        throw new AppError(
          409,
          'PAYMENT_CLAIM_NOT_PENDING',
          'Another administrator has already reviewed this payment claim. Refresh the order.',
        );
      }

      if (input.decision === 'rejected' && !input.rejectionReason) {
        throw new AppError(400, 'VALIDATION_ERROR', 'A rejection reason is required.');
      }

      const now = new Date();
      const approved = input.decision === 'paid';
      const updated = await OrderModel.findOneAndUpdate(
        {
          _id: order._id,
          paymentStatus: 'pending_verification',
          'payment.claims': {
            $elemMatch: { _id: claim._id, status: 'pending_verification' },
          },
        },
        {
          $set: {
            paymentStatus: approved ? 'paid' : 'rejected',
            'payment.verifiedBy': admin._id,
            'payment.verifiedAt': now,
            'payment.rejectionReason': approved ? null : input.rejectionReason,
            'payment.claims.$[claim].status': approved ? 'approved' : 'rejected',
            'payment.claims.$[claim].reviewedBy': admin._id,
            'payment.claims.$[claim].reviewedAt': now,
            'payment.claims.$[claim].rejectionReason': approved
              ? null
              : input.rejectionReason,
          },
          $push: {
            'payment.verificationHistory': {
              action: approved ? 'approved' : 'rejected',
              at: now,
              actor: 'admin',
              by: admin._id,
              reason: approved ? null : input.rejectionReason,
              senderNumber: claim.senderNumber,
              trxId: claim.trxIdNormalized,
            },
          },
        },
        {
          arrayFilters: [{ 'claim._id': claim._id, 'claim.status': 'pending_verification' }],
          returnDocument: 'after',
          session,
        },
      ).exec();

      if (!updated) {
        throw new AppError(
          409,
          'PAYMENT_CLAIM_NOT_PENDING',
          'Another administrator has already reviewed this payment claim. Refresh the order.',
        );
      }

      await enqueueNotification(
        {
          user: updated.user,
          order: updated._id,
          orderNumber: updated.orderNumber,
          type: approved ? 'payment_approved' : 'payment_rejected',
          message: approved
            ? `Your payment for order ${updated.orderNumber} has been verified. Thank you.`
            : `Your payment for order ${updated.orderNumber} could not be verified. Open the order to see the reason and submit a valid transaction.`,
        },
        session,
      );

      result.order = toOrderDto(updated, { includeInternal: true });
      result.claimId = claim._id ? claim._id.toString() : null;
      result.decision = approved ? 'paid' : 'rejected';
    });
  } finally {
    await session.endSession();
  }

  if (!result.order) {
    throw new AppError(409, 'PAYMENT_CLAIM_NOT_PENDING', 'Payment review did not complete.');
  }
  // Post-commit success path only. NO rejection reason, sender number or
  // transaction reference is copied — ids + decision enum only. The
  // authoritative verification trail stays in orders.payment.verificationHistory.
  if (result.claimId && result.decision) {
    emitServerEvent({
      type: 'payment.claim_reviewed',
      eventId: deterministicEventId(`payment.claim.reviewed:${result.claimId}`),
      userId: admin._id,
      orderId,
      decision: result.decision,
    });
  }
  deliverNotifications();
  return result.order;
};

const refundEvidenceMatches = (
  order: OrderDocument,
  input: { refundReference: string; refundAmount: number; refundRecipient: string },
): boolean =>
  order.payment?.refundReference === input.refundReference &&
  order.payment?.refundAmount === input.refundAmount &&
  order.payment?.refundRecipient === input.refundRecipient;

/**
 * Records a completed manual refund only after the admin supplies the actual
 * provider refund reference, the exact refunded amount and the confirmed
 * recipient account. The amount must equal the order total, and the recipient
 * must match the wallet that paid. The same exact evidence is idempotent; a
 * different completion is rejected.
 */
export const completeManualRefund = async (
  admin: UserDocument,
  orderId: string,
  input: AdminPaymentRefundInput,
): Promise<OrderDto> => {
  const refundRecipient = normalizeBdMobile(input.refundRecipient);
  if (refundRecipient === null) {
    throw new AppError(400, 'REFUND_RECIPIENT_INVALID', 'Enter a valid refund recipient account.');
  }
  const refundReference = input.refundReference.trim();
  if (input.confirmed !== true) {
    throw new AppError(
      400,
      'REFUND_CONFIRMATION_REQUIRED',
      'Confirm that the customer actually received the refund before recording it.',
    );
  }

  const preflight = await OrderModel.findById(orderId).exec();
  if (!preflight) {
    throw new AppError(404, 'NOT_FOUND', 'Order not found');
  }
  if (preflight.paymentMethod === 'cod') {
    throw new AppError(409, 'NOT_MANUAL_PAYMENT', 'This order does not use a manual payment method.');
  }

  if (preflight.paymentStatus === 'refunded') {
    if (
      refundEvidenceMatches(preflight, {
        refundReference,
        refundAmount: input.refundAmount,
        refundRecipient,
      })
    ) {
      deliverNotifications();
      return toOrderDto(preflight, { includeInternal: true });
    }
    throw new AppError(
      409,
      'REFUND_ALREADY_COMPLETED',
      'This refund was already completed with different evidence. The existing record was not changed.',
    );
  }
  if (preflight.paymentStatus !== 'refund_pending') {
    throw new AppError(409, 'REFUND_NOT_PENDING', 'This order has no refund awaiting completion.');
  }
  if (input.refundAmount !== preflight.total) {
    throw new AppError(
      400,
      'REFUND_AMOUNT_MISMATCH',
      `Refund amount must equal the paid order total (${preflight.total} poisha).`,
    );
  }
  if (!preflight.payment?.senderNumber || preflight.payment.senderNumber !== refundRecipient) {
    throw new AppError(
      400,
      'REFUND_RECIPIENT_MISMATCH',
      'Refund recipient must match the sender account that paid for this order.',
    );
  }

  const session = await mongoose.startSession();
  const result: { order: OrderDto | null; fresh: boolean } = { order: null, fresh: false };

  try {
    await session.withTransaction(async () => {
      const order = await OrderModel.findById(orderId).session(session).exec();
      if (!order) {
        throw new AppError(404, 'NOT_FOUND', 'Order not found');
      }
      if (order.paymentStatus === 'refunded') {
        if (
          refundEvidenceMatches(order, {
            refundReference,
            refundAmount: input.refundAmount,
            refundRecipient,
          })
        ) {
          result.order = toOrderDto(order, { includeInternal: true });
          return;
        }
        throw new AppError(
          409,
          'REFUND_ALREADY_COMPLETED',
          'This refund was already completed with different evidence. The existing record was not changed.',
        );
      }
      if (order.paymentStatus !== 'refund_pending') {
        throw new AppError(409, 'REFUND_NOT_PENDING', 'This order has no refund awaiting completion.');
      }
      if (input.refundAmount !== order.total) {
        throw new AppError(400, 'REFUND_AMOUNT_MISMATCH', 'Refund amount does not match the paid total.');
      }
      if (!order.payment?.senderNumber || order.payment.senderNumber !== refundRecipient) {
        throw new AppError(400, 'REFUND_RECIPIENT_MISMATCH', 'Refund recipient does not match the payer.');
      }

      const now = new Date();
      const updated = await OrderModel.findOneAndUpdate(
        {
          _id: order._id,
          paymentStatus: 'refund_pending',
          'payment.refundedAt': null,
        },
        {
          $set: {
            paymentStatus: 'refunded',
            'payment.refundedBy': admin._id,
            'payment.refundedAt': now,
            'payment.refundReference': refundReference,
            'payment.refundAmount': input.refundAmount,
            'payment.refundRecipient': refundRecipient,
            'payment.refundNote': input.note ?? null,
          },
          $push: {
            'payment.verificationHistory': {
              action: 'refunded',
              at: now,
              actor: 'admin',
              by: admin._id,
              reason: input.note ?? null,
              refundReference,
              refundAmount: input.refundAmount,
              refundRecipient,
            },
          },
        },
        { returnDocument: 'after', session },
      ).exec();

      if (!updated) {
        const fresh = await OrderModel.findById(orderId).session(session).exec();
        if (
          fresh?.paymentStatus === 'refunded' &&
          refundEvidenceMatches(fresh, {
            refundReference,
            refundAmount: input.refundAmount,
            refundRecipient,
          })
        ) {
          result.order = toOrderDto(fresh, { includeInternal: true });
          return;
        }
        throw new AppError(
          409,
          'REFUND_ALREADY_COMPLETED',
          'Another administrator completed this refund first. Refresh the order.',
        );
      }

      await enqueueNotification(
        {
          user: updated.user,
          order: updated._id,
          orderNumber: updated.orderNumber,
          type: 'payment_refunded',
          message: `Your refund for order ${updated.orderNumber} was recorded as completed.`,
        },
        session,
      );

      result.order = toOrderDto(updated, { includeInternal: true });
      // Only the FIRST completion emits; idempotent replays of the same
      // evidence (early returns above) stay silent.
      result.fresh = true;
    });
  } finally {
    await session.endSession();
  }

  if (!result.order) {
    throw new AppError(409, 'REFUND_NOT_PENDING', 'Refund completion did not complete.');
  }
  // Post-commit success path only. The refund reference, amount and
  // recipient are NEVER copied into analytics — ids only; the authoritative
  // financial record stays on the order document.
  if (result.fresh) {
    emitServerEvent({
      type: 'payment.refunded',
      eventId: deterministicEventId(`payment.refunded:${orderId}`),
      userId: admin._id,
      orderId,
    });
  }
  deliverNotifications();
  return result.order;
};

export const getPendingClaimId = (order: OrderDocument): string | null =>
  pendingClaimOf(order)?._id?.toString() ?? null;

import mongoose from 'mongoose';
import { AppError } from '../middleware/error-handler.js';
import { OrderModel, type OrderStatus } from '../models/order.model.js';
import { VariantModel } from '../models/variant.model.js';
import { UserModel, type UserDocument } from '../models/user.model.js';
import type { AdminOrderQuery, AdminOrderStatusUpdateInput } from '../schemas/admin.schema.js';
import { toOrderDto, type OrderDto, type OrderListResult } from './order.service.js';
import { normalizeBdMobile } from '../utils/phone.js';
import { paymentStatusAfterCancellation, paymentStatusFilter } from '../utils/payment.js';
import { deliverNotifications, enqueueNotification } from './notification.service.js';
import { emitServerEvent } from './activity.service.js';
import { deterministicEventId } from '../utils/event-id.js';

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

export const adminListOrders = async (query: AdminOrderQuery): Promise<OrderListResult> => {
  // Exact indexed lookup only: never interpolate user input into a regex.
  const phone = query.search ? normalizeBdMobile(query.search) : null;
  const filter = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
    ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
    ...(query.search ? phone
      ? { 'shippingAddress.phone': phone }
      : { orderNumber: query.search.toUpperCase() } : {}),
  };

  const [orders, total] = await Promise.all([
    OrderModel.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .exec(),
    OrderModel.countDocuments(filter).exec(),
  ]);

  return {
    items: orders.map((order) => toOrderDto(order, { includeInternal: true })),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
};

export interface AdminOrderCustomerDto {
  id: string;
  name: string;
  email: string;
}

export interface AdminOrderDetailDto {
  order: OrderDto;
  customer: AdminOrderCustomerDto | null;
}

/** Admin order detail: any order plus the customer that placed it. */
export const adminGetOrder = async (orderId: string): Promise<AdminOrderDetailDto> => {
  const order = await OrderModel.findById(orderId).exec();
  if (!order) {
    throw new AppError(404, 'NOT_FOUND', 'Order not found');
  }
  const user = await UserModel.findById(order.user).exec();

  return {
    order: toOrderDto(order, { includeInternal: true }),
    customer: user
      ? { id: user._id.toString(), name: user.name, email: user.email }
      : null,
  };
};

export const adminUpdateOrderStatus = async (
  admin: UserDocument,
  orderId: string,
  input: AdminOrderStatusUpdateInput,
): Promise<OrderDto> => {
  const target = input.status;
  const session = await mongoose.startSession();
  const result: { updated: OrderDto | null; from: OrderStatus | null } = {
    updated: null,
    from: null,
  };

  try {
    await session.withTransaction(async () => {
      const order = await OrderModel.findById(orderId).session(session).exec();
      if (!order) {
        throw new AppError(404, 'NOT_FOUND', 'Order not found');
      }

      if (!ALLOWED_TRANSITIONS[order.status].includes(target)) {
        throw new AppError(
          409,
          'CONFLICT',
          `Cannot change status from ${order.status} to ${target}`,
        );
      }

      if (
        target !== 'cancelled' &&
        order.paymentMethod !== 'cod' &&
        order.paymentStatus !== 'paid'
      ) {
        throw new AppError(
          409,
          'PAYMENT_NOT_CONFIRMED',
          'This prepaid order cannot be processed, shipped or delivered until its payment is verified.',
        );
      }

      if (target === 'cancelled' && order.paymentStatus === 'pending_verification') {
        throw new AppError(
          409,
          'PAYMENT_REVIEW_IN_PROGRESS',
          'Resolve the pending payment verification before cancelling this order.',
        );
      }

      let nextPaymentStatus = order.paymentStatus;
      if (target === 'cancelled') {
        const computed = paymentStatusAfterCancellation(order.paymentMethod, order.paymentStatus);
        if (computed === null) {
          throw new AppError(409, 'PAYMENT_REVIEW_IN_PROGRESS', 'Payment review is in progress');
        }
        nextPaymentStatus = computed;
      }

      const now = new Date();
      // Atomic guarded transition: the status filter (plus stockRestored guard
      // for cancellations) makes sure stock is restored exactly once, never twice.
      const updated = await OrderModel.findOneAndUpdate(
        {
          _id: order._id,
          status: order.status,
          ...paymentStatusFilter(order.paymentStatus),
          ...(target === 'cancelled' ? { stockRestored: { $ne: true } } : {}),
        },
        {
          $set: {
            status: target,
            ...(target === 'cancelled' ? { stockRestored: true } : {}),
            ...(target === 'delivered' && order.paymentMethod === 'cod'
              ? { paymentStatus: 'paid' }
              : {}),
            ...(target === 'cancelled' && nextPaymentStatus !== order.paymentStatus
              ? { paymentStatus: nextPaymentStatus }
              : {}),
          },
          $push: {
            statusHistory: { status: target, at: now, by: admin._id },
            ...(target === 'cancelled' && nextPaymentStatus !== order.paymentStatus
              ? {
                  'payment.verificationHistory': {
                    action: 'cancelled',
                    at: now,
                    actor: 'admin',
                    by: admin._id,
                    reason: null,
                  },
                }
              : {}),
          },
        },
        { returnDocument: 'after', session },
      ).exec();

      if (!updated) {
        throw new AppError(409, 'CONFLICT', 'Order was modified concurrently');
      }
      // Captured for the post-commit analytics event (from → to).
      result.from = order.status;

      if (target === 'cancelled' && nextPaymentStatus === 'refund_pending') {
        await enqueueNotification(
          {
            user: updated.user,
            order: updated._id,
            orderNumber: updated.orderNumber,
            type: 'payment_refund_pending',
            message: `Order ${updated.orderNumber} was cancelled after payment. A manual refund is pending.`,
          },
          session,
        );
      }

      // Status change + stock restore + flag commit together or not at all.
      if (target === 'cancelled') {
        for (const item of updated.items) {
          const restored = await VariantModel.updateOne(
            { _id: item.variant },
            { $inc: { stock: item.quantity } },
            { session },
          ).exec();
          // A missing variant cannot be restocked: abort the transaction rather
          // than leaving a cancelled order with unrestored inventory.
          if (restored.matchedCount !== 1) {
            throw new AppError(
              409,
              'STOCK_RESTORE_FAILED',
              `Cannot restore stock for ${item.sku}: the variant no longer exists. The order was not cancelled.`,
            );
          }
        }
      }

      result.updated = toOrderDto(updated, { includeInternal: true });
    });
  } finally {
    await session.endSession();
  }

  if (!result.updated) {
    throw new AppError(409, 'CONFLICT', 'Order was modified concurrently');
  }
  // Post-commit, success path only. Cancellations are recorded as the
  // canonical `order.cancelled` fact (actor = admin userId); every other
  // admin transition as `admin.order_status_changed` — never both for one
  // action, so the feed cannot double-count. Retries are blocked by the
  // state machine (ALLOWED_TRANSITIONS), so a random v4 id is safe here;
  // no deterministic identifier exists for a repeatable transition.
  if (target === 'cancelled') {
    emitServerEvent({
      type: 'order.cancelled',
      eventId: deterministicEventId(`order.cancelled:${orderId}`),
      userId: admin._id,
      orderId,
    });
  } else {
    emitServerEvent({
      type: 'admin.order_status_changed',
      userId: admin._id,
      orderId,
      ...(result.from ? { fromStatus: result.from } : {}),
      toStatus: target,
    });
  }
  deliverNotifications();
  return result.updated;
};

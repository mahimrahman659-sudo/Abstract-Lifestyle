import type { Types } from 'mongoose';
import { AppError } from '../middleware/error-handler.js';
import { OrderModel, type OrderStatus } from '../models/order.model.js';
import type { UserDocument } from '../models/user.model.js';
import type { AdminOrderQuery, AdminOrderStatusUpdateInput } from '../schemas/admin.schema.js';
import { restoreStock, toOrderDto, type OrderDto, type OrderListResult } from './order.service.js';

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

export const adminListOrders = async (query: AdminOrderQuery): Promise<OrderListResult> => {
  const filter = query.status ? { status: query.status } : {};

  const [orders, total] = await Promise.all([
    OrderModel.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .exec(),
    OrderModel.countDocuments(filter).exec(),
  ]);

  return {
    items: orders.map(toOrderDto),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
};

export const adminUpdateOrderStatus = async (
  admin: UserDocument,
  orderId: string,
  input: AdminOrderStatusUpdateInput,
): Promise<OrderDto> => {
  const order = await OrderModel.findById(orderId).exec();
  if (!order) {
    throw new AppError(404, 'NOT_FOUND', 'Order not found');
  }

  const target = input.status;
  if (!ALLOWED_TRANSITIONS[order.status].includes(target)) {
    throw new AppError(
      409,
      'CONFLICT',
      `Cannot change status from ${order.status} to ${target}`,
    );
  }

  // Atomic guarded transition: the status filter (plus stockRestored guard for
  // cancellations) makes sure stock is restored exactly once, never twice.
  const updated = await OrderModel.findOneAndUpdate(
    {
      _id: order._id,
      status: order.status,
      ...(target === 'cancelled' ? { stockRestored: { $ne: true } } : {}),
    },
    {
      $set: {
        status: target,
        ...(target === 'cancelled' ? { stockRestored: true } : {}),
        ...(target === 'delivered' ? { paymentStatus: 'paid' } : {}),
      },
      $push: { statusHistory: { status: target, at: new Date(), by: admin._id as Types.ObjectId } },
    },
    { returnDocument: 'after' },
  ).exec();

  if (!updated) {
    throw new AppError(409, 'CONFLICT', 'Order was modified concurrently');
  }

  if (target === 'cancelled') {
    for (const item of updated.items) {
      await restoreStock([{ variantId: item.variant, quantity: item.quantity }]);
    }
  }

  return toOrderDto(updated);
};

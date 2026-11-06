import mongoose from 'mongoose';
import { AppError } from '../middleware/error-handler.js';
import { OrderModel, type OrderStatus } from '../models/order.model.js';
import { VariantModel } from '../models/variant.model.js';
import { UserModel, type UserDocument } from '../models/user.model.js';
import type { AdminOrderQuery, AdminOrderStatusUpdateInput } from '../schemas/admin.schema.js';
import { toOrderDto, type OrderDto, type OrderListResult } from './order.service.js';

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
    order: toOrderDto(order),
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
  const result: { updated: OrderDto | null } = { updated: null };

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

      // Atomic guarded transition: the status filter (plus stockRestored guard
      // for cancellations) makes sure stock is restored exactly once, never twice.
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
          $push: { statusHistory: { status: target, at: new Date(), by: admin._id } },
        },
        { returnDocument: 'after', session },
      ).exec();

      if (!updated) {
        throw new AppError(409, 'CONFLICT', 'Order was modified concurrently');
      }

      // Status change + stock restore + flag commit together or not at all.
      if (target === 'cancelled') {
        for (const item of updated.items) {
          await VariantModel.updateOne(
            { _id: item.variant },
            { $inc: { stock: item.quantity } },
            { session },
          ).exec();
        }
      }

      result.updated = toOrderDto(updated);
    });
  } finally {
    await session.endSession();
  }

  if (!result.updated) {
    throw new AppError(409, 'CONFLICT', 'Order was modified concurrently');
  }
  return result.updated;
};

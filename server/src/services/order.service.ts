import mongoose, { type ClientSession, type Types } from 'mongoose';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error-handler.js';
import { CartModel } from '../models/cart.model.js';
import {
  OrderModel,
  type OrderDocument,
  type OrderItem,
  type ShippingAddressSnapshot,
} from '../models/order.model.js';
import { ProductModel } from '../models/product.model.js';
import { VariantModel } from '../models/variant.model.js';
import type { UserDocument } from '../models/user.model.js';
import type { CreateOrderInput, OrderListQuery } from '../schemas/order.schema.js';
import { generateOrderNumber } from '../utils/order-number.js';
import { getPaymentProvider } from './payment.service.js';

export interface OrderDto {
  id: string;
  orderNumber: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  items: Array<{
    product: string;
    variant: string;
    name: string;
    sku: string;
    size: string | null;
    color: string | null;
    image: string | null;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }>;
  shippingAddress: ShippingAddressSnapshot;
  subtotal: number;
  shippingFee: number;
  total: number;
  statusHistory: Array<{ status: string; at: Date; by?: string }>;
  createdAt: Date;
}

export interface OrderListResult {
  items: OrderDto[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const ORDER_NUMBER_ATTEMPTS = 3;

/** A checkout claim older than this is considered stale (crashed request) and can be re-claimed. */
const CHECKOUT_CLAIM_STALE_MS = 60_000;

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === 11000;

export const toOrderDto = (order: OrderDocument): OrderDto => ({
  id: order._id.toString(),
  orderNumber: order.orderNumber,
  status: order.status,
  paymentMethod: order.paymentMethod,
  paymentStatus: order.paymentStatus,
  items: order.items.map((item) => ({
    product: item.product.toString(),
    variant: item.variant.toString(),
    name: item.name,
    sku: item.sku,
    size: item.size,
    color: item.color,
    image: item.image,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    lineTotal: item.lineTotal,
  })),
  shippingAddress: order.shippingAddress,
  subtotal: order.subtotal,
  shippingFee: order.shippingFee,
  total: order.total,
  statusHistory: order.statusHistory.map((entry) => ({
    status: entry.status,
    at: entry.at,
    by: entry.by ? entry.by.toString() : undefined,
  })),
  createdAt: order.createdAt,
});

const resolveShippingAddress = (
  user: UserDocument,
  input: CreateOrderInput,
): ShippingAddressSnapshot => {
  if (input.shippingAddress) {
    const { fullName, phone, line1, line2, city, state, postalCode, country } = input.shippingAddress;
    return { fullName, phone, line1, line2, city, state, postalCode, country };
  }

  const saved = user.addresses.find(
    (address) => address._id?.toString() === input.shippingAddressId,
  );
  if (!saved) {
    throw new AppError(404, 'NOT_FOUND', 'Address not found');
  }
  const { fullName, phone, line1, line2, city, state, postalCode, country } = saved;
  return { fullName, phone, line1, line2, city, state, postalCode, country };
};

const buildOrderItems = async (
  cartItems: Array<{ variant: Types.ObjectId; quantity: number }>,
  session: ClientSession,
): Promise<OrderItem[]> => {
  const variants = await VariantModel.find({
    _id: { $in: cartItems.map((item) => item.variant) },
  })
    .session(session)
    .exec();
  const products = await ProductModel.find({
    _id: { $in: variants.map((variant) => variant.product) },
  })
    .session(session)
    .exec();

  const variantById = new Map<string, (typeof variants)[number]>();
  for (const variant of variants) {
    variantById.set(variant._id.toString(), variant);
  }
  const productById = new Map<string, (typeof products)[number]>();
  for (const product of products) {
    productById.set(product._id.toString(), product);
  }

  return cartItems.map((cartItem) => {
    const variant = variantById.get(cartItem.variant.toString());
    const product = variant ? productById.get(variant.product.toString()) : undefined;

    if (!variant || !product || product.status !== 'active') {
      throw new AppError(
        409,
        'CONFLICT',
        `Item no longer available: ${variant?.sku ?? 'unknown'}`,
      );
    }

    const unitPrice = variant.price ?? product.basePrice;
    return {
      product: product._id,
      variant: variant._id,
      name: product.name,
      sku: variant.sku,
      size: variant.size,
      color: variant.color,
      image: variant.images[0] ?? product.images[0] ?? null,
      unitPrice,
      quantity: cartItem.quantity,
      lineTotal: unitPrice * cartItem.quantity,
    };
  });
};

export const createOrder = async (
  user: UserDocument,
  input: CreateOrderInput,
): Promise<OrderDto> => {
  const shippingAddress = resolveShippingAddress(user, input);
  const provider = getPaymentProvider(input.paymentMethod);
  const { checkoutId } = input;

  // Idempotency: replaying the same checkoutId returns the original order
  // instead of creating a second one.
  const replayed = await OrderModel.findOne({ checkoutId }).exec();
  if (replayed) {
    if (replayed.user.toString() !== user._id.toString()) {
      throw new AppError(409, 'CONFLICT', 'checkoutId already used');
    }
    return toOrderDto(replayed);
  }

  const cart = await CartModel.findOne({ user: user._id }).exec();
  if (!cart || cart.items.length === 0) {
    throw new AppError(409, 'CONFLICT', 'Cart is empty');
  }

  // Double-submit guard: atomically claim checkout for this cart. A claim that
  // is older than CHECKOUT_CLAIM_STALE_MS counts as stale (crashed request).
  const claimTime = new Date();
  const staleCutoff = new Date(claimTime.getTime() - CHECKOUT_CLAIM_STALE_MS);
  const claimed = await CartModel.findOneAndUpdate(
    {
      _id: cart._id,
      $or: [{ checkoutInProgress: null }, { checkoutInProgress: { $lt: staleCutoff } }],
    },
    { $set: { checkoutInProgress: claimTime } },
    { returnDocument: 'after' },
  ).exec();
  if (!claimed) {
    throw new AppError(409, 'CONFLICT', 'Checkout already in progress');
  }

  // Stock decrements, order creation and cart clearing happen in ONE
  // transaction: any failure aborts everything automatically, so no manual
  // compensating rollback is needed.
  const session = await mongoose.startSession();
  const result: { created: OrderDocument | null } = { created: null };

  try {
    for (let attempt = 1; attempt <= ORDER_NUMBER_ATTEMPTS; attempt += 1) {
      try {
        await session.withTransaction(async () => {
          // Re-validate and re-price everything from the database (inside the session).
          const items = await buildOrderItems([...cart.items], session);
          const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
          const shippingFee = env.SHIPPING_FEE;
          const total = subtotal + shippingFee;

          // Atomic conditional decrement per line, inside the transaction.
          for (const item of items) {
            const updated = await VariantModel.findOneAndUpdate(
              { _id: item.variant, stock: { $gte: item.quantity } },
              { $inc: { stock: -item.quantity } },
              { returnDocument: 'after', session },
            ).exec();

            if (!updated) {
              throw new AppError(409, 'CONFLICT', `Insufficient stock for ${item.sku}`);
            }
          }

          const [order] = await OrderModel.create(
            [
              {
                orderNumber: generateOrderNumber(),
                user: user._id,
                checkoutId,
                items,
                shippingAddress,
                paymentMethod: provider.method,
                paymentStatus: provider.initialPaymentStatus(),
                subtotal,
                shippingFee,
                total,
                status: 'pending',
                statusHistory: [{ status: 'pending', at: new Date() }],
                stockRestored: false,
              },
            ],
            { session },
          );
          if (!order) {
            throw new AppError(500, 'SERVER_ERROR', 'Failed to create order');
          }

          // Clear the cart only if we still hold our claim (stale takeovers
          // must not wipe a cart that already belongs to a newer checkout).
          const cleared = await CartModel.updateOne(
            { _id: cart._id, checkoutInProgress: claimTime },
            { $set: { items: [] } },
            { session },
          ).exec();
          if (cleared.modifiedCount !== 1) {
            throw new AppError(409, 'CONFLICT', 'Checkout already in progress');
          }

          result.created = order;
        });
        break;
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          // A concurrent duplicate submit won the checkoutId race → return its order.
          const winner = await OrderModel.findOne({ checkoutId }).exec();
          if (winner) {
            if (winner.user.toString() !== user._id.toString()) {
              throw new AppError(409, 'CONFLICT', 'checkoutId already used');
            }
            return toOrderDto(winner);
          }
          // Otherwise it was an orderNumber collision — retry with a new number.
          if (attempt < ORDER_NUMBER_ATTEMPTS) {
            continue;
          }
        }
        throw error;
      }
    }

    const committed = result.created;
    if (!committed) {
      throw new AppError(500, 'SERVER_ERROR', 'Failed to create order');
    }

    await provider.onOrderPlaced(committed);
    return toOrderDto(committed);
  } finally {
    // Release only our own claim (matched by timestamp) so a stale-claim
    // takeover can never be cleared by the original crashed request.
    await CartModel.updateOne(
      { _id: cart._id, checkoutInProgress: claimTime },
      { $set: { checkoutInProgress: null } },
    ).exec();
    await session.endSession();
  }
};

export const listOrders = async (
  user: UserDocument,
  query: OrderListQuery,
): Promise<OrderListResult> => {
  const filter = { user: user._id };
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

export const getOrder = async (user: UserDocument, orderId: string): Promise<OrderDto> => {
  const filter =
    user.role === 'admin' ? { _id: orderId } : { _id: orderId, user: user._id };

  const order = await OrderModel.findOne(filter).exec();
  if (!order) {
    throw new AppError(404, 'NOT_FOUND', 'Order not found');
  }
  return toOrderDto(order);
};

/**
 * Customer cancellation: only while `pending`. The status change, the
 * `stockRestored` flag and the stock restoration all happen in ONE
 * transaction, so a failed restore can never leave an order cancelled
 * without its stock back (and vice versa).
 */
export const cancelOrder = async (user: UserDocument, orderId: string): Promise<OrderDto> => {
  const session = await mongoose.startSession();
  const result: { cancelled: OrderDto | null } = { cancelled: null };

  try {
    await session.withTransaction(async () => {
      const updated = await OrderModel.findOneAndUpdate(
        { _id: orderId, user: user._id, status: 'pending', stockRestored: { $ne: true } },
        {
          $set: { status: 'cancelled', stockRestored: true },
          $push: { statusHistory: { status: 'cancelled', at: new Date() } },
        },
        { returnDocument: 'after', session },
      ).exec();

      if (!updated) {
        const exists = await OrderModel.findOne({ _id: orderId, user: user._id })
          .session(session)
          .exec();
        if (!exists) {
          throw new AppError(404, 'NOT_FOUND', 'Order not found');
        }
        throw new AppError(409, 'CONFLICT', 'Order cannot be cancelled');
      }

      // Only the winner of the guarded transition above restores stock.
      for (const item of updated.items) {
        await VariantModel.updateOne(
          { _id: item.variant },
          { $inc: { stock: item.quantity } },
          { session },
        ).exec();
      }

      result.cancelled = toOrderDto(updated);
    });
  } finally {
    await session.endSession();
  }

  if (!result.cancelled) {
    throw new AppError(409, 'CONFLICT', 'Order cannot be cancelled');
  }
  return result.cancelled;
};



import mongoose, { type ClientSession, type Types } from 'mongoose';
import { CHECKOUT_CLAIM_STALE_MS, cartVersionFilter } from '../config/checkout.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error-handler.js';
import { CartModel } from '../models/cart.model.js';
import {
  OrderModel,
  type OrderDocument,
  type OrderItem,
  type PaymentMethod,
  type PaymentStatus,
  type ShippingAddressSnapshot,
} from '../models/order.model.js';
import { ProductModel } from '../models/product.model.js';
import { VariantModel } from '../models/variant.model.js';
import type { UserDocument } from '../models/user.model.js';
import type { CreateOrderInput, OrderListQuery } from '../schemas/order.schema.js';
import { generateOrderNumber } from '../utils/order-number.js';
import { firstImageUrl } from '../utils/images.js';
import { paymentStatusAfterCancellation, paymentStatusFilter } from '../utils/payment.js';
import { assertPaymentIndexReadyForManualOperations } from '../config/payment-index.js';
import { getPaymentProvider } from './payment.service.js';
import { deliverNotifications, enqueueNotification } from './notification.service.js';

export interface OrderPaymentDto {
  provider: 'cod' | 'manual';
  senderNumber: string | null;
  trxId: string | null;
  submittedAt: Date | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  rejectionReason: string | null;
  refundedBy: string | null;
  refundedAt: Date | null;
  refundReference: string | null;
  refundAmount: number | null;
  refundRecipient: string | null;
  refundNote: string | null;
  claims: Array<{
    id: string;
    senderNumber: string;
    trxId: string;
    submittedAt: Date;
    status: 'pending_verification' | 'approved' | 'rejected';
    reviewedBy: string | null;
    reviewedAt: Date | null;
    rejectionReason: string | null;
  }>;
  verificationHistory: Array<{
    action: 'submitted' | 'approved' | 'rejected' | 'refunded' | 'cancelled';
    at: Date;
    actor: 'customer' | 'admin' | 'system' | null;
    by: string | null;
    reason: string | null;
    refundReference: string | null;
    refundAmount: number | null;
    refundRecipient: string | null;
  }>;
}

export interface OrderDto {
  id: string;
  orderNumber: string;
  status: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  payment: OrderPaymentDto;
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

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === 11000;

const toPaymentDto = (order: OrderDocument): OrderPaymentDto => {
  const payment = order.payment;
  return {
    provider: payment?.provider ?? (order.paymentMethod === 'cod' ? 'cod' : 'manual'),
    senderNumber: payment?.senderNumber ?? null,
    trxId: payment?.trxId ?? null,
    submittedAt: payment?.submittedAt ?? null,
    verifiedBy: payment?.verifiedBy ? payment.verifiedBy.toString() : null,
    verifiedAt: payment?.verifiedAt ?? null,
    rejectionReason: payment?.rejectionReason ?? null,
    refundedBy: payment?.refundedBy ? payment.refundedBy.toString() : null,
    refundedAt: payment?.refundedAt ?? null,
    refundReference: payment?.refundReference ?? null,
    refundAmount: payment?.refundAmount ?? null,
    refundRecipient: payment?.refundRecipient ?? null,
    refundNote: payment?.refundNote ?? null,
    claims: (payment?.claims ?? []).map((claim) => ({
      id: claim._id ? claim._id.toString() : '',
      senderNumber: claim.senderNumber,
      trxId: claim.trxId,
      submittedAt: claim.submittedAt,
      status: claim.status,
      reviewedBy: claim.reviewedBy ? claim.reviewedBy.toString() : null,
      reviewedAt: claim.reviewedAt ?? null,
      rejectionReason: claim.rejectionReason ?? null,
    })),
    verificationHistory: (payment?.verificationHistory ?? []).map((entry) => ({
      action: entry.action,
      at: entry.at,
      actor: entry.actor ?? null,
      by: entry.by ? entry.by.toString() : null,
      reason: entry.reason ?? null,
      refundReference: entry.refundReference ?? null,
      refundAmount: entry.refundAmount ?? null,
      refundRecipient: entry.refundRecipient ?? null,
    })),
  };
};

export const toOrderDto = (order: OrderDocument): OrderDto => ({
  id: order._id.toString(),
  orderNumber: order.orderNumber,
  status: order.status,
  paymentMethod: order.paymentMethod,
  paymentStatus: order.paymentStatus,
  payment: toPaymentDto(order),
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

interface CartLineIssue {
  path: string;
  message: string;
}

/**
 * Rebuilds order lines from the database and rejects anything that is not
 * genuinely orderable. Runs once before the checkout claim (fast, actionable
 * feedback) and again inside the transaction (authoritative).
 *
 * Checks per line: positive quantity, variant exists and is not archived,
 * product exists and is active, price is a positive integer in poisha, and the
 * requested quantity is within stock. All issues are returned together so the
 * shopper can fix the cart in one pass.
 */
const buildOrderItems = async (
  cartItems: Array<{ variant: Types.ObjectId; quantity: number }>,
  session?: ClientSession,
): Promise<OrderItem[]> => {
  const variantQuery = VariantModel.find({
    _id: { $in: cartItems.map((item) => item.variant) },
  });
  const variants = await (session ? variantQuery.session(session) : variantQuery).exec();

  const productQuery = ProductModel.find({
    _id: { $in: variants.map((variant) => variant.product) },
  });
  const products = await (session ? productQuery.session(session) : productQuery).exec();

  const variantById = new Map<string, (typeof variants)[number]>();
  for (const variant of variants) {
    variantById.set(variant._id.toString(), variant);
  }
  const productById = new Map<string, (typeof products)[number]>();
  for (const product of products) {
    productById.set(product._id.toString(), product);
  }

  const issues: CartLineIssue[] = [];
  const items: OrderItem[] = [];

  for (const cartItem of cartItems) {
    const variant = variantById.get(cartItem.variant.toString());
    const label = variant?.sku ?? 'Unknown item';

    if (!Number.isInteger(cartItem.quantity) || cartItem.quantity < 1) {
      issues.push({ path: 'items', message: `${label}: quantity is not valid` });
      continue;
    }
    if (!variant) {
      issues.push({ path: 'items', message: `${label}: this item is no longer available` });
      continue;
    }
    if (variant.archivedAt) {
      issues.push({ path: 'items', message: `${variant.sku}: this item is no longer sold` });
      continue;
    }

    const product = productById.get(variant.product.toString());
    if (!product || product.status !== 'active') {
      issues.push({
        path: 'items',
        message: `${variant.sku}: this product is not available right now`,
      });
      continue;
    }

    const unitPrice = variant.price ?? product.basePrice;
    if (!Number.isInteger(unitPrice) || unitPrice <= 0) {
      issues.push({
        path: 'items',
        message: `${variant.sku}: the price is unavailable, so it cannot be ordered`,
      });
      continue;
    }
    if (variant.stock < cartItem.quantity) {
      issues.push({
        path: 'items',
        message: `${variant.sku}: only ${variant.stock} left in stock`,
      });
      continue;
    }

    items.push({
      product: product._id,
      variant: variant._id,
      name: product.name,
      sku: variant.sku,
      size: variant.size,
      color: variant.color,
      image: variant.images[0] ?? firstImageUrl(product.images) ?? null,
      unitPrice,
      quantity: cartItem.quantity,
      lineTotal: unitPrice * cartItem.quantity,
    });
  }

  if (issues.length > 0) {
    throw new AppError(
      409,
      'CART_NOT_ORDERABLE',
      'Some items in your cart can no longer be ordered. Review the cart and try again.',
      issues,
    );
  }

  return items;
};

export const createOrder = async (
  user: UserDocument,
  input: CreateOrderInput,
): Promise<OrderDto> => {
  const shippingAddress = resolveShippingAddress(user, input);
  const { checkoutId } = input;

  // Idempotency: replaying the same checkoutId returns the original order
  // instead of creating a second one. This runs before provider gating so a
  // retry still returns an order even if the method was disabled afterwards.
  const replayed = await OrderModel.findOne({ checkoutId }).exec();
  if (replayed) {
    if (replayed.user.toString() !== user._id.toString()) {
      throw new AppError(409, 'CONFLICT', 'checkoutId already used');
    }
    return toOrderDto(replayed);
  }

  if (input.paymentMethod !== 'cod') {
    await assertPaymentIndexReadyForManualOperations();
  }
  const provider = getPaymentProvider(input.paymentMethod);

  const cart = await CartModel.findOne({ user: user._id }).exec();
  if (!cart || cart.items.length === 0) {
    throw new AppError(409, 'CONFLICT', 'Cart is empty');
  }

  // Fail fast with per-line reasons before claiming the cart; the same checks
  // run again inside the transaction, where they are authoritative.
  await buildOrderItems(
    cart.items.map((item) => ({ variant: item.variant, quantity: item.quantity })),
  );

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
    throw new AppError(409, 'CHECKOUT_IN_PROGRESS', 'Checkout already in progress');
  }
  // Version the claim was taken on — the final clear compare-and-swaps on it.
  const claimedVersion = claimed.version;

  // Stock decrements, order creation and cart clearing happen in ONE
  // transaction: any failure aborts everything automatically, so no manual
  // compensating rollback is needed.
  const session = await mongoose.startSession();
  const result: { created: OrderDocument | null } = { created: null };

  try {
    for (let attempt = 1; attempt <= ORDER_NUMBER_ATTEMPTS; attempt += 1) {
      try {
        await session.withTransaction(async () => {
          // Re-read the cart inside the transaction. The checkout claim blocks
          // cart writes, and this read is the snapshot the order is built from —
          // never the copy loaded before the claim.
          const freshCart = await CartModel.findOne({ _id: cart._id }).session(session).exec();
          if (!freshCart || freshCart.items.length === 0) {
            throw new AppError(409, 'CONFLICT', 'Cart is empty');
          }
          const items = await buildOrderItems(
            freshCart.items.map((item) => ({ variant: item.variant, quantity: item.quantity })),
            session,
          );
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
                payment: {
                  provider: provider.provider,
                  senderNumber: null,
                  trxId: null,
                  trxIdNormalized: null,
                  submittedAt: null,
                  verifiedBy: null,
                  verifiedAt: null,
                  rejectionReason: null,
                  refundedBy: null,
                  refundedAt: null,
                  refundReference: null,
                  refundAmount: null,
                  refundRecipient: null,
                  refundNote: null,
                  claims: [],
                  verificationHistory: [],
                },
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

          // Compare-and-swap the clear: the claim timestamp AND the cart version
          // captured at claim time must still match, so a cart that changed
          // underneath this checkout can never be erased by it.
          const cleared = await CartModel.updateOne(
            {
              _id: cart._id,
              checkoutInProgress: claimTime,
              ...cartVersionFilter(claimedVersion),
            },
            { $set: { items: [], checkoutInProgress: null }, $inc: { version: 1 } },
            { session },
          ).exec();
          if (cleared.matchedCount !== 1) {
            throw new AppError(
              409,
              'CHECKOUT_CONFLICT',
              'Your cart changed during checkout. Please review it and try again.',
            );
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
 * Customer cancellation: while pending or processing. The status change, the
 * `stockRestored` flag and the stock restoration all happen in ONE
 * transaction, so a failed restore can never leave an order cancelled
 * without its stock back (and vice versa).
 */
export const cancelOrder = async (user: UserDocument, orderId: string): Promise<OrderDto> => {
  const session = await mongoose.startSession();
  const result: { cancelled: OrderDto | null } = { cancelled: null };

  try {
    await session.withTransaction(async () => {
      const current = await OrderModel.findOne({ _id: orderId, user: user._id })
        .session(session)
        .exec();
      if (!current) {
        throw new AppError(404, 'NOT_FOUND', 'Order not found');
      }
      if (current.paymentStatus === 'pending_verification') {
        throw new AppError(
          409,
          'PAYMENT_REVIEW_IN_PROGRESS',
          'A payment is being verified for this order. Contact support to cancel or correct it.',
        );
      }

      const nextPaymentStatus = paymentStatusAfterCancellation(
        current.paymentMethod,
        current.paymentStatus,
      );
      if (nextPaymentStatus === null) {
        throw new AppError(409, 'PAYMENT_REVIEW_IN_PROGRESS', 'Payment review is in progress');
      }

      const now = new Date();
      const updated = await OrderModel.findOneAndUpdate(
        {
          _id: orderId,
          user: user._id,
          status: { $in: ['pending', 'processing'] },
          stockRestored: { $ne: true },
          ...paymentStatusFilter(current.paymentStatus),
        },
        {
          $set: {
            status: 'cancelled',
            stockRestored: true,
            ...(nextPaymentStatus !== current.paymentStatus
              ? { paymentStatus: nextPaymentStatus }
              : {}),
          },
          $push: {
            statusHistory: { status: 'cancelled', at: now },
            ...(nextPaymentStatus !== current.paymentStatus
              ? {
                  'payment.verificationHistory': {
                    action: 'cancelled',
                    at: now,
                    actor: 'customer',
                    by: user._id,
                    reason: null,
                  },
                }
              : {}),
          },
        },
        { returnDocument: 'after', session },
      ).exec();

      if (!updated) {
        throw new AppError(
          409,
          'CONFLICT',
          'Only pending or processing orders can be cancelled. This order may already have shipped or been cancelled.',
        );
      }

      // Only the winner of the guarded transition above restores stock. A
      // missing variant means inventory cannot be made whole, so the whole
      // cancellation is aborted instead of reporting a false success.
      for (const item of updated.items) {
        const restored = await VariantModel.updateOne(
          { _id: item.variant },
          { $inc: { stock: item.quantity } },
          { session },
        ).exec();
        if (restored.matchedCount !== 1) {
          throw new AppError(
            409,
            'STOCK_RESTORE_FAILED',
            `Cannot restore stock for ${item.sku}: the variant no longer exists. The order was not cancelled.`,
          );
        }
      }

      if (nextPaymentStatus === 'refund_pending') {
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

      result.cancelled = toOrderDto(updated);
    });
  } finally {
    await session.endSession();
  }

  if (!result.cancelled) {
    throw new AppError(409, 'CONFLICT', 'Order cannot be cancelled');
  }
  deliverNotifications();
  return result.cancelled;
};



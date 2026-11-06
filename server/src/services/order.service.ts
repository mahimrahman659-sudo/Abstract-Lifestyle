import type { Types } from 'mongoose';
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

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === 11000;

const toOrderDto = (order: OrderDocument): OrderDto => ({
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

const restoreStock = async (
  decrements: Array<{ variantId: Types.ObjectId; quantity: number }>,
): Promise<void> => {
  for (const entry of decrements) {
    await VariantModel.updateOne({ _id: entry.variantId }, { $inc: { stock: entry.quantity } }).exec();
  }
};

const buildOrderItems = async (cartItems: Array<{ variant: Types.ObjectId; quantity: number }>): Promise<OrderItem[]> => {
  const variants = await VariantModel.find({ _id: { $in: cartItems.map((item) => item.variant) } }).exec();
  const products = await ProductModel.find({
    _id: { $in: variants.map((variant) => variant.product) },
  }).exec();

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

  const cart = await CartModel.findOne({ user: user._id }).exec();
  if (!cart || cart.items.length === 0) {
    throw new AppError(409, 'CONFLICT', 'Cart is empty');
  }

  // Double-submit guard: atomically claim checkout for this cart.
  const claimed = await CartModel.findOneAndUpdate(
    { _id: cart._id, checkoutInProgress: { $ne: true } },
    { $set: { checkoutInProgress: true } },
    { returnDocument: 'after' },
  ).exec();
  if (!claimed) {
    throw new AppError(409, 'CONFLICT', 'Checkout already in progress');
  }

  try {
    // Re-validate and re-price everything from the database.
    const items = await buildOrderItems([...cart.items]);
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const shippingFee = env.SHIPPING_FEE;
    const total = subtotal + shippingFee;

    // Atomic conditional decrement per line; rollback all on any failure.
    const decrements: Array<{ variantId: Types.ObjectId; quantity: number }> = [];
    for (const item of items) {
      const updated = await VariantModel.findOneAndUpdate(
        { _id: item.variant, stock: { $gte: item.quantity } },
        { $inc: { stock: -item.quantity } },
        { returnDocument: 'after' },
      ).exec();

      if (!updated) {
        await restoreStock(decrements);
        throw new AppError(409, 'CONFLICT', `Insufficient stock for ${item.sku}`);
      }
      decrements.push({ variantId: item.variant, quantity: item.quantity });
    }

    // Save the order (retry orderNumber collisions); roll stock back on failure.
    let order: OrderDocument | null = null;
    for (let attempt = 1; attempt <= ORDER_NUMBER_ATTEMPTS; attempt += 1) {
      try {
        order = await OrderModel.create({
          orderNumber: generateOrderNumber(),
          user: user._id,
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
        });
        break;
      } catch (error) {
        if (isDuplicateKeyError(error) && attempt < ORDER_NUMBER_ATTEMPTS) {
          continue;
        }
        await restoreStock(decrements);
        throw error;
      }
    }

    if (!order) {
      await restoreStock(decrements);
      throw new AppError(500, 'SERVER_ERROR', 'Failed to create order');
    }

    await provider.onOrderPlaced(order);

    // Clear the cart only after the order is saved successfully.
    cart.items = [];
    await cart.save();

    return toOrderDto(order);
  } finally {
    await CartModel.updateOne(
      { _id: cart._id },
      { $set: { checkoutInProgress: false } },
    ).exec();
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
 * Customer cancellation: only while `pending`. The status transition is a single
 * atomic update, so a double cancel can never restore stock twice.
 */
export const cancelOrder = async (user: UserDocument, orderId: string): Promise<OrderDto> => {
  const existing = await OrderModel.findOne({ _id: orderId, user: user._id }).exec();
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Order not found');
  }

  const updated = await OrderModel.findOneAndUpdate(
    { _id: orderId, user: user._id, status: 'pending' },
    {
      $set: { status: 'cancelled', stockRestored: true },
      $push: { statusHistory: { status: 'cancelled', at: new Date() } },
    },
    { returnDocument: 'after' },
  ).exec();

  if (!updated) {
    throw new AppError(409, 'CONFLICT', 'Order cannot be cancelled');
  }

  // Only the winner of the transition above restores stock.
  for (const item of updated.items) {
    await VariantModel.updateOne(
      { _id: item.variant },
      { $inc: { stock: item.quantity } },
    ).exec();
  }

  return toOrderDto(updated);
};



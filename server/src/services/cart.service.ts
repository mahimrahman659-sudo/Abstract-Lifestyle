import type { HydratedDocument, Types } from 'mongoose';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error-handler.js';
import { CartModel, type CartDocument } from '../models/cart.model.js';
import { ProductModel, type Product } from '../models/product.model.js';
import { VariantModel, type Variant } from '../models/variant.model.js';
import { mergeCartItemSchema, type MergeCartItemInput } from '../schemas/cart.schema.js';

export interface CartItemView {
  variantId: string;
  product: string | null;
  name: string | null;
  sku: string | null;
  size: string | null;
  color: string | null;
  image: string | null;
  unitPrice: number | null;
  quantity: number;
  lineTotal: number | null;
  outOfStock: boolean;
  insufficientStock: boolean;
  unavailable: boolean;
}

export interface CartView {
  items: CartItemView[];
  subtotal: number;
  /** Flat fee from SHIPPING_FEE env (poisha) — server is the only source. */
  shippingFee: number;
  /** subtotal + shippingFee. */
  total: number;
}

type VariantDoc = HydratedDocument<Variant>;
type ProductDoc = HydratedDocument<Product>;

const getOrCreateCart = async (userId: Types.ObjectId): Promise<CartDocument> => {
  const cart = await CartModel.findOneAndUpdate(
    { user: userId },
    { $setOnInsert: { user: userId, items: [] } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).exec();

  if (!cart) {
    throw new AppError(500, 'SERVER_ERROR', 'Failed to load cart');
  }
  return cart;
};

/** Loads a variant + product, or null when unknown/inactive. */
const findAvailableVariant = async (
  variantId: string,
): Promise<{ variant: NonNullable<VariantDoc>; product: NonNullable<ProductDoc> } | null> => {
  const variant = await VariantModel.findById(variantId).exec();
  if (!variant) {
    return null;
  }
  const product = await ProductModel.findById(variant.product).exec();
  if (!product || product.status !== 'active') {
    return null;
  }
  return { variant, product };
};

/** Recomputes prices, stock flags and totals from the database on every call. */
const buildCartView = async (cart: CartDocument): Promise<CartView> => {
  const variantIds = cart.items.map((item) => item.variant);
  const variants = await VariantModel.find({ _id: { $in: variantIds } }).exec();
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

  let subtotal = 0;
  const items: CartItemView[] = cart.items.map((item) => {
    const variantId = item.variant.toString();
    const variant = variantById.get(variantId);
    const product = variant ? productById.get(variant.product.toString()) : undefined;

    const name = product?.name ?? null;
    const sku = variant?.sku ?? null;
    const size = variant?.size ?? null;
    const color = variant?.color ?? null;
    const image = variant?.images[0] ?? product?.images[0] ?? null;

    if (!variant || !product || product.status !== 'active') {
      return {
        variantId,
        product: variant ? variant.product.toString() : null,
        name,
        sku,
        size,
        color,
        image,
        unitPrice: null,
        quantity: item.quantity,
        lineTotal: null,
        outOfStock: false,
        insufficientStock: false,
        unavailable: true,
      };
    }

    const unitPrice = variant.price ?? product.basePrice;
    const lineTotal = unitPrice * item.quantity;
    subtotal += lineTotal;

    return {
      variantId,
      product: variant.product.toString(),
      name,
      sku,
      size,
      color,
      image,
      unitPrice,
      quantity: item.quantity,
      lineTotal,
      outOfStock: variant.stock === 0,
      insufficientStock: item.quantity > variant.stock,
      unavailable: false,
    };
  });

  const shippingFee = env.SHIPPING_FEE;
  return { items, subtotal, shippingFee, total: subtotal + shippingFee };
};

export const getCart = async (userId: Types.ObjectId): Promise<CartView> => {
  const cart = await getOrCreateCart(userId);
  return buildCartView(cart);
};

export const addItem = async (
  userId: Types.ObjectId,
  variantId: string,
  quantity: number,
): Promise<CartView> => {
  const available = await findAvailableVariant(variantId);
  if (!available) {
    throw new AppError(404, 'NOT_FOUND', 'Variant not found');
  }
  const { variant } = available;
  if (variant.stock === 0) {
    throw new AppError(409, 'CONFLICT', 'Insufficient stock');
  }

  const cart = await getOrCreateCart(userId);
  const existing = cart.items.find((item) => item.variant.toString() === variantId);
  const currentQuantity = existing ? existing.quantity : 0;
  const targetQuantity = Math.min(currentQuantity + quantity, variant.stock);

  if (existing) {
    existing.quantity = targetQuantity;
  } else {
    cart.items.push({ variant: variant._id, quantity: targetQuantity });
  }

  await cart.save();
  return buildCartView(cart);
};

export const updateItem = async (
  userId: Types.ObjectId,
  variantId: string,
  quantity: number,
): Promise<CartView> => {
  const cart = await getOrCreateCart(userId);
  const existing = cart.items.find((item) => item.variant.toString() === variantId);
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Item not in cart');
  }

  const available = await findAvailableVariant(variantId);
  if (!available) {
    throw new AppError(409, 'CONFLICT', 'Item is no longer available');
  }
  const { variant } = available;
  if (variant.stock === 0) {
    throw new AppError(409, 'CONFLICT', 'Insufficient stock');
  }

  existing.quantity = Math.min(quantity, variant.stock);
  await cart.save();
  return buildCartView(cart);
};

export const removeItem = async (userId: Types.ObjectId, variantId: string): Promise<CartView> => {
  const cart = await getOrCreateCart(userId);
  cart.items = cart.items.filter((item) => item.variant.toString() !== variantId);
  await cart.save();
  return buildCartView(cart);
};

export const clearCart = async (userId: Types.ObjectId): Promise<CartView> => {
  const cart = await getOrCreateCart(userId);
  cart.items = [];
  await cart.save();
  return buildCartView(cart);
};

/** Merges a guest (localStorage) cart. Invalid entries are skipped, valid ones are capped at stock. */
export const mergeGuestItems = async (
  userId: Types.ObjectId,
  rawItems: unknown[],
): Promise<CartView> => {
  const cart = await getOrCreateCart(userId);

  for (const raw of rawItems) {
    const parsed = mergeCartItemSchema.safeParse(raw);
    if (!parsed.success) {
      continue;
    }
    const entry: MergeCartItemInput = parsed.data;

    const available = await findAvailableVariant(entry.variantId);
    if (!available || available.variant.stock === 0) {
      continue;
    }
    const { variant } = available;

    const existing = cart.items.find((item) => item.variant.toString() === entry.variantId);
    const currentQuantity = existing ? existing.quantity : 0;
    const targetQuantity = Math.min(currentQuantity + entry.quantity, variant.stock);

    if (existing) {
      existing.quantity = targetQuantity;
    } else {
      cart.items.push({ variant: variant._id, quantity: targetQuantity });
    }
  }

  await cart.save();
  return buildCartView(cart);
};


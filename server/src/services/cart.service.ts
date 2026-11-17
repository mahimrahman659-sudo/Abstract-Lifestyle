import type { HydratedDocument, Types } from 'mongoose';
import {
  CART_MUTATION_ATTEMPTS,
  CHECKOUT_CLAIM_STALE_MS,
  CHECKOUT_IN_PROGRESS_MESSAGE,
  cartVersionFilter,
} from '../config/checkout.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error-handler.js';
import { CartModel, type CartDocument, type CartItem } from '../models/cart.model.js';
import { ProductModel, type Product } from '../models/product.model.js';
import { VariantModel, type Variant } from '../models/variant.model.js';
import { mergeCartItemSchema, type MergeCartItemInput } from '../schemas/cart.schema.js';
import { firstImageUrl } from '../utils/images.js';

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

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === 11000;

/** True while another request holds a non-stale checkout claim on the cart. */
const hasActiveCheckout = (cart: { checkoutInProgress: Date | null }, now: number): boolean =>
  cart.checkoutInProgress !== null &&
  now - cart.checkoutInProgress.getTime() < CHECKOUT_CLAIM_STALE_MS;

const getOrCreateCart = async (userId: Types.ObjectId): Promise<CartDocument> => {
  const existing = await CartModel.findOne({ user: userId }).exec();
  if (existing) {
    return existing;
  }

  try {
    const created = await CartModel.findOneAndUpdate(
      { user: userId },
      { $setOnInsert: { user: userId, items: [], version: 0 } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    ).exec();

    if (!created) {
      throw new AppError(500, 'SERVER_ERROR', 'Failed to load cart');
    }
    return created;
  } catch (error) {
    // Two first-time requests can race the unique user index. The loser simply
    // re-reads the winner's cart — never a 500, never a second cart.
    if (isDuplicateKeyError(error)) {
      const raced = await CartModel.findOne({ user: userId }).exec();
      if (raced) {
        return raced;
      }
    }
    throw error;
  }
};

/**
 * Applies a cart mutation through a compare-and-swap on `version`, and only
 * while no checkout claim is active. This is what stops a cart write from being
 * silently erased by checkout's final clear (or vice versa):
 *
 * - mutations are rejected with 409 while checkout holds a non-stale claim;
 * - a concurrent mutation makes the CAS fail and the operation retries on the
 *   freshly loaded cart instead of overwriting it;
 * - checkout itself clears with the same CAS (see order.service).
 */
const mutateCart = async (
  userId: Types.ObjectId,
  mutate: (items: CartItem[]) => CartItem[],
): Promise<CartDocument> => {
  for (let attempt = 1; attempt <= CART_MUTATION_ATTEMPTS; attempt += 1) {
    const cart = await getOrCreateCart(userId);
    const now = Date.now();

    if (hasActiveCheckout(cart, now)) {
      throw new AppError(409, 'CHECKOUT_IN_PROGRESS', CHECKOUT_IN_PROGRESS_MESSAGE);
    }

    const nextItems = mutate(
      cart.items.map((item) => ({ variant: item.variant, quantity: item.quantity })),
    );
    const staleCutoff = new Date(now - CHECKOUT_CLAIM_STALE_MS);

    const updated = await CartModel.findOneAndUpdate(
      {
        _id: cart._id,
        $and: [
          cartVersionFilter(cart.version),
          { $or: [{ checkoutInProgress: null }, { checkoutInProgress: { $lt: staleCutoff } }] },
        ],
      },
      { $set: { items: nextItems }, $inc: { version: 1 } },
      { returnDocument: 'after' },
    ).exec();

    if (updated) {
      return updated;
    }
    // Lost the race (concurrent mutation or a claim appeared) → retry.
  }

  throw new AppError(
    409,
    'CONFLICT',
    'Your cart changed in another request. Please try again.',
  );
};

/** Loads a variant + product, or null when unknown/inactive/archived. */
const findAvailableVariant = async (
  variantId: string,
): Promise<{ variant: NonNullable<VariantDoc>; product: NonNullable<ProductDoc> } | null> => {
  const variant = await VariantModel.findById(variantId).exec();
  if (!variant || variant.archivedAt) {
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
    const image = variant?.images[0] ?? firstImageUrl(product?.images) ?? null;

    if (!variant || !product || product.status !== 'active' || variant.archivedAt) {
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

  const updated = await mutateCart(userId, (items) => {
    const existing = items.find((item) => item.variant.toString() === variantId);
    const currentQuantity = existing ? existing.quantity : 0;
    // Stock is re-read above; the cap is enforced server-side, never the client.
    const targetQuantity = Math.min(currentQuantity + quantity, variant.stock);

    if (existing) {
      existing.quantity = targetQuantity;
      return items;
    }
    return [...items, { variant: variant._id, quantity: targetQuantity }];
  });

  return buildCartView(updated);
};

export const updateItem = async (
  userId: Types.ObjectId,
  variantId: string,
  quantity: number,
): Promise<CartView> => {
  const available = await findAvailableVariant(variantId);
  if (!available) {
    throw new AppError(409, 'CONFLICT', 'Item is no longer available');
  }
  const { variant } = available;
  if (variant.stock === 0) {
    throw new AppError(409, 'CONFLICT', 'Insufficient stock');
  }

  const updated = await mutateCart(userId, (items) => {
    const existing = items.find((item) => item.variant.toString() === variantId);
    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', 'Item not in cart');
    }
    existing.quantity = Math.min(quantity, variant.stock);
    return items;
  });

  return buildCartView(updated);
};

export const removeItem = async (userId: Types.ObjectId, variantId: string): Promise<CartView> => {
  const updated = await mutateCart(userId, (items) =>
    items.filter((item) => item.variant.toString() !== variantId),
  );
  return buildCartView(updated);
};

export const clearCart = async (userId: Types.ObjectId): Promise<CartView> => {
  const updated = await mutateCart(userId, () => []);
  return buildCartView(updated);
};

/** Merges a guest (localStorage) cart. Invalid entries are skipped, valid ones are capped at stock. */
export const mergeGuestItems = async (
  userId: Types.ObjectId,
  rawItems: unknown[],
): Promise<CartView> => {
  const additions: Array<{ variant: NonNullable<VariantDoc>; quantity: number }> = [];

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
    additions.push({ variant: available.variant, quantity: entry.quantity });
  }

  const updated = await mutateCart(userId, (items) => {
    for (const addition of additions) {
      const existing = items.find(
        (item) => item.variant.toString() === addition.variant._id.toString(),
      );
      const currentQuantity = existing ? existing.quantity : 0;
      const targetQuantity = Math.min(
        currentQuantity + addition.quantity,
        addition.variant.stock,
      );

      if (existing) {
        existing.quantity = targetQuantity;
      } else {
        items.push({ variant: addition.variant._id, quantity: targetQuantity });
      }
    }
    return items;
  });

  return buildCartView(updated);
};


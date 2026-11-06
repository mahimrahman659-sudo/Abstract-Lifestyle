import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface CartItem {
  variant: Types.ObjectId;
  quantity: number;
}

export interface Cart {
  user: Types.ObjectId;
  items: CartItem[];
  /** Timestamp of an active checkout claim; claims older than 60s are stale. */
  checkoutInProgress: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CartDocument = HydratedDocument<Cart>;

const cartItemSchema = new Schema<CartItem>(
  {
    variant: { type: Schema.Types.ObjectId, ref: 'Variant', required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const cartSchema = new Schema<Cart>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    items: { type: [cartItemSchema], default: [] },
    // Guards against concurrent checkout (double submit) for the same cart.
    // A claim older than CHECKOUT_CLAIM_STALE_MS is treated as crashed/stale.
    checkoutInProgress: { type: Date, default: null },
  },
  { timestamps: true },
);

cartSchema.index({ user: 1 }, { unique: true });

export const CartModel = model<Cart>('Cart', cartSchema);

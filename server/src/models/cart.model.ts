import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface CartItem {
  variant: Types.ObjectId;
  quantity: number;
}

export interface Cart {
  user: Types.ObjectId;
  items: CartItem[];
  checkoutInProgress: boolean;
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
    checkoutInProgress: { type: Boolean, default: false },
  },
  { timestamps: true },
);

cartSchema.index({ user: 1 }, { unique: true });

export const CartModel = model<Cart>('Cart', cartSchema);

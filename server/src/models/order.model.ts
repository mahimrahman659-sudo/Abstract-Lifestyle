import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
export type PaymentMethod = 'cod';
export type PaymentStatus = 'unpaid' | 'paid';

export interface OrderItem {
  product: Types.ObjectId;
  variant: Types.ObjectId;
  name: string;
  sku: string;
  size: string | null;
  color: string | null;
  image: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface ShippingAddressSnapshot {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: string;
}

export interface OrderStatusEntry {
  status: OrderStatus;
  at: Date;
  by?: Types.ObjectId;
}

export interface Order {
  orderNumber: string;
  user: Types.ObjectId;
  /** Client-generated UUID for idempotent checkout retries (unique, sparse). */
  checkoutId?: string;
  items: OrderItem[];
  shippingAddress: ShippingAddressSnapshot;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  subtotal: number;
  shippingFee: number;
  total: number;
  status: OrderStatus;
  statusHistory: OrderStatusEntry[];
  stockRestored: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type OrderDocument = HydratedDocument<Order>;

const orderItemSchema = new Schema<OrderItem>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variant: { type: Schema.Types.ObjectId, ref: 'Variant', required: true },
    name: { type: String, required: true },
    sku: { type: String, required: true },
    size: { type: String, default: null },
    color: { type: String, default: null },
    image: { type: String, default: null },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const shippingAddressSchema = new Schema<ShippingAddressSnapshot>(
  {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    line1: { type: String, required: true },
    line2: { type: String },
    city: { type: String, required: true },
    state: { type: String },
    postalCode: { type: String },
    country: { type: String, required: true },
  },
  { _id: false },
);

const orderStatusEntrySchema = new Schema<OrderStatusEntry>(
  {
    status: {
      type: String,
      enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
      required: true,
    },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
);

const orderSchema = new Schema<Order>(
  {
    orderNumber: { type: String, required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    checkoutId: { type: String },
    items: { type: [orderItemSchema], required: true },
    shippingAddress: { type: shippingAddressSchema, required: true },
    paymentMethod: { type: String, enum: ['cod'], required: true },
    paymentStatus: { type: String, enum: ['unpaid', 'paid'], default: 'unpaid' },
    subtotal: { type: Number, required: true, min: 0 },
    shippingFee: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
      default: 'pending',
    },
    statusHistory: { type: [orderStatusEntrySchema], default: [] },
    stockRestored: { type: Boolean, default: false },
  },
  { timestamps: true },
);

orderSchema.index({ orderNumber: 1 }, { unique: true });
orderSchema.index({ checkoutId: 1 }, { unique: true, sparse: true });
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });

export const OrderModel = model<Order>('Order', orderSchema);

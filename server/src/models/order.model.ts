import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
export type PaymentMethod = 'cod' | 'bkash' | 'nagad' | 'rocket';
export type PaymentProviderId = 'cod' | 'manual';
/**
 * ONE authoritative payment state per order. Fulfilment (`status`) and payment
 * (`paymentStatus`) are deliberately separate lifecycles.
 */
export type PaymentStatus =
  | 'unpaid'
  | 'awaiting_payment'
  | 'pending_verification'
  | 'paid'
  | 'rejected'
  | 'refund_pending'
  | 'refunded'
  | 'cancelled';

export type PaymentClaimStatus = 'pending_verification' | 'approved' | 'rejected';

export interface PaymentClaim {
  _id?: Types.ObjectId;
  senderNumber: string;
  trxId: string;
  trxIdNormalized: string;
  submittedAt: Date;
  submittedBy: Types.ObjectId;
  status: PaymentClaimStatus;
  reviewedBy?: Types.ObjectId | null;
  reviewedAt?: Date | null;
  rejectionReason?: string | null;
}

export type PaymentHistoryAction = 'submitted' | 'approved' | 'rejected' | 'refunded' | 'cancelled';

export interface PaymentHistoryEntry {
  action: PaymentHistoryAction;
  at: Date;
  actor?: 'customer' | 'admin' | 'system';
  by?: Types.ObjectId;
  reason?: string | null;
  senderNumber?: string | null;
  trxId?: string | null;
  refundReference?: string | null;
  refundAmount?: number | null;
  refundRecipient?: string | null;
}

export interface OrderPayment {
  provider: PaymentProviderId;
  /** Latest submitted claim values (denormalized for display/queries). */
  senderNumber: string | null;
  trxId: string | null;
  trxIdNormalized: string | null;
  submittedAt: Date | null;
  verifiedBy: Types.ObjectId | null;
  verifiedAt: Date | null;
  rejectionReason: string | null;
  refundedBy: Types.ObjectId | null;
  refundedAt: Date | null;
  refundReference: string | null;
  refundAmount: number | null;
  refundRecipient: string | null;
  refundNote: string | null;
  /** Every submitted claim, including rejected ones. */
  claims: PaymentClaim[];
  /** Human-readable audit trail for customers and admins. */
  verificationHistory: PaymentHistoryEntry[];
}

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
  /** Optional: checkout only collects name, phone and address. */
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
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
  payment?: OrderPayment;
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
    city: { type: String },
    state: { type: String },
    postalCode: { type: String },
    country: { type: String },
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

const paymentClaimSchema = new Schema<PaymentClaim>(
  {
    senderNumber: { type: String, required: true },
    trxId: { type: String, required: true },
    trxIdNormalized: { type: String, required: true },
    submittedAt: { type: Date, required: true },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['pending_verification', 'approved', 'rejected'],
      required: true,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
  },
  { _id: true },
);

const paymentHistorySchema = new Schema<PaymentHistoryEntry>(
  {
    action: {
      type: String,
      enum: ['submitted', 'approved', 'rejected', 'refunded', 'cancelled'],
      required: true,
    },
    at: { type: Date, required: true },
    actor: { type: String, enum: ['customer', 'admin', 'system'] },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, default: null },
    senderNumber: { type: String, default: null },
    trxId: { type: String, default: null },
    refundReference: { type: String, default: null },
    refundAmount: { type: Number, default: null, min: 0 },
    refundRecipient: { type: String, default: null },
  },
  { _id: false },
);

const orderPaymentSchema = new Schema<OrderPayment>(
  {
    provider: { type: String, enum: ['cod', 'manual'], required: true },
    senderNumber: { type: String, default: null },
    trxId: { type: String, default: null },
    trxIdNormalized: { type: String, default: null },
    submittedAt: { type: Date, default: null },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    refundedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    refundedAt: { type: Date, default: null },
    refundReference: { type: String, default: null },
    refundAmount: { type: Number, default: null, min: 0 },
    refundRecipient: { type: String, default: null },
    refundNote: { type: String, default: null },
    claims: { type: [paymentClaimSchema], default: [] },
    verificationHistory: { type: [paymentHistorySchema], default: [] },
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
    paymentMethod: { type: String, enum: ['cod', 'bkash', 'nagad', 'rocket'], required: true },
    paymentStatus: {
      type: String,
      enum: [
        'unpaid',
        'awaiting_payment',
        'pending_verification',
        'paid',
        'rejected',
        'refund_pending',
        'refunded',
        'cancelled',
      ],
      default: 'unpaid',
    },
    payment: { type: orderPaymentSchema },
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
orderSchema.index({ 'shippingAddress.phone': 1, createdAt: -1, _id: -1 });
orderSchema.index({ 'shippingAddress.phone': 1, status: 1, createdAt: -1, _id: -1 });
orderSchema.index({ paymentStatus: 1, createdAt: -1 });
orderSchema.index({ paymentMethod: 1, createdAt: -1 });
// Global uniqueness for every submitted transaction reference, including
// rejected claims (they stay in `claims`). Partial so COD/legacy orders without
// claims are unaffected. Tested against a disposable replica set only.
orderSchema.index(
  { 'payment.claims.trxIdNormalized': 1 },
  {
    name: 'payment_trxid_unique',
    unique: true,
    partialFilterExpression: { 'payment.claims.trxIdNormalized': { $type: 'string' } },
  },
);

export const OrderModel = model<Order>('Order', orderSchema);

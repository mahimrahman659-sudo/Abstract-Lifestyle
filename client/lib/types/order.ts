export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
export type PaymentMethod = 'cod' | 'bkash' | 'nagad' | 'rocket';
export type PaymentProviderId = 'cod' | 'manual';
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
  id: string;
  senderNumber: string;
  trxId: string;
  submittedAt: string;
  status: PaymentClaimStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

export interface PaymentHistoryEntry {
  action: 'submitted' | 'approved' | 'rejected' | 'refunded' | 'cancelled';
  at: string;
  actor: 'customer' | 'admin' | 'system' | null;
  by: string | null;
  reason: string | null;
  refundReference: string | null;
  refundAmount: number | null;
  refundRecipient: string | null;
}

export interface OrderPayment {
  provider: PaymentProviderId;
  senderNumber: string | null;
  trxId: string | null;
  submittedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  refundedBy: string | null;
  refundedAt: string | null;
  refundReference: string | null;
  refundAmount: number | null;
  refundRecipient: string | null;
  refundNote: string | null;
  claims: PaymentClaim[];
  verificationHistory: PaymentHistoryEntry[];
}

/** Purchase-time snapshot — survives later catalog edits. */
export interface OrderItemSnapshot {
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
}

export interface ShippingAddressSnapshot {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface OrderStatusEntry {
  status: OrderStatus;
  at: string;
  by?: string;
}

export interface OrderDto {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  payment: OrderPayment;
  items: OrderItemSnapshot[];
  shippingAddress: ShippingAddressSnapshot;
  subtotal: number;
  shippingFee: number;
  total: number;
  statusHistory: OrderStatusEntry[];
  createdAt: string;
}

export interface OrderResponse {
  order: OrderDto;
}

export interface PublicPaymentMethod {
  method: PaymentMethod;
  provider: PaymentProviderId;
  label: string;
  enabled: boolean;
  receivingNumber: string | null;
  instructions: string[];
  requiresProof: boolean;
  trxIdMinLength?: number;
  trxIdMaxLength?: number;
}

export interface ManualPaymentSubmission {
  senderNumber: string;
  trxId: string;
}

export interface CustomerNotification {
  id: string;
  orderId: string;
  orderNumber: string;
  type:
    | 'payment_submitted'
    | 'payment_approved'
    | 'payment_rejected'
    | 'payment_refund_pending'
    | 'payment_refunded';
  message: string;
  createdAt: string;
}

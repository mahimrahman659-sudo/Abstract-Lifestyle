export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
export type PaymentMethod = 'cod';
export type PaymentStatus = 'unpaid' | 'paid';

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

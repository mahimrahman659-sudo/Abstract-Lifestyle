import type {
  AddressPayload,
  ListEnvelope,
  ManualPaymentSubmission,
  OrderDto,
  OrderResponse,
  PaymentMethod,
} from '../types';
import { apiFetch } from './client';

export interface CreateOrderPayload {
  /** Client-generated UUID — idempotency key for safe checkout retries. */
  checkoutId: string;
  paymentMethod: PaymentMethod;
  shippingAddressId?: string;
  shippingAddress?: AddressPayload;
}

export const orderApi = {
  create: (payload: CreateOrderPayload) =>
    apiFetch<OrderResponse>('/orders', { method: 'POST', body: payload }),
  list: (page = 1, limit = 10) =>
    apiFetch<ListEnvelope<OrderDto>>(`/orders?page=${page}&limit=${limit}`),
  get: (id: string) => apiFetch<OrderResponse>(`/orders/${id}`),
  cancel: (id: string) => apiFetch<OrderResponse>(`/orders/${id}/cancel`, { method: 'POST' }),
  submitPayment: (id: string, payload: ManualPaymentSubmission) =>
    apiFetch<OrderResponse>(`/orders/${id}/payment`, { method: 'POST', body: payload }),
};
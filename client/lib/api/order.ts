import type {
  AddressPayload,
  ListEnvelope,
  OrderDto,
  OrderResponse,
} from '../types';
import { apiFetch } from './client';

export interface CreateOrderPayload {
  paymentMethod: 'cod';
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
};
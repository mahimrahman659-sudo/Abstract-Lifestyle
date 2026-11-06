import type { CartView, MergeCartPayload } from '../types';
import { apiFetch } from './client';

export const cartApi = {
  getCart: () => apiFetch<CartView>('/cart'),
  addItem: (variantId: string, quantity: number) =>
    apiFetch<CartView>('/cart/items', { method: 'POST', body: { variantId, quantity } }),
  updateItem: (variantId: string, quantity: number) =>
    apiFetch<CartView>(`/cart/items/${variantId}`, { method: 'PATCH', body: { quantity } }),
  removeItem: (variantId: string) =>
    apiFetch<CartView>(`/cart/items/${variantId}`, { method: 'DELETE' }),
  clear: () => apiFetch<CartView>('/cart', { method: 'DELETE' }),
  merge: (payload: MergeCartPayload) =>
    apiFetch<CartView>('/cart/merge', { method: 'POST', body: payload }),
};

import type { AddressListResponse, AddressPayload, AddressResponse, UserResponse } from '../types';
import { apiFetch } from './client';

export const userApi = {
  updateProfile: (name: string) => apiFetch<UserResponse>('/users/me', { method: 'PATCH', body: { name } }),
  patchAddress: (id: string, payload: Partial<AddressPayload>) => apiFetch<AddressResponse>(`/users/me/addresses/${id}`, { method: 'PATCH', body: payload }),
  deleteAddress: (id: string) => apiFetch<void>(`/users/me/addresses/${id}`, { method: 'DELETE' }),
  getAddresses: () => apiFetch<AddressListResponse>('/users/me/addresses'),
  createAddress: (payload: AddressPayload) =>
    apiFetch<AddressResponse>('/users/me/addresses', { method: 'POST', body: payload }),
};

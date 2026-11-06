import type { AddressListResponse, AddressPayload, AddressResponse } from '../types';
import { apiFetch } from './client';

export const userApi = {
  getAddresses: () => apiFetch<AddressListResponse>('/users/me/addresses'),
  createAddress: (payload: AddressPayload) =>
    apiFetch<AddressResponse>('/users/me/addresses', { method: 'POST', body: payload }),
};
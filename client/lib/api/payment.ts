import type { CustomerNotification, PublicPaymentMethod } from '../types';
import { apiFetch } from './client';

export const paymentApi = {
  methods: () =>
    apiFetch<{
      methods: PublicPaymentMethod[];
      manualPaymentsUnavailable: boolean;
    }>('/payments/methods'),
};

export const notificationApi = {
  list: () => apiFetch<{ items: CustomerNotification[] }>('/notifications'),
};

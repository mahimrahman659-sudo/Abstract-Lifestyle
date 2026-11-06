import type { LoginPayload, RegisterPayload, UserResponse } from '../types';
import { apiFetch } from './client';

export const authApi = {
  getMe: () => apiFetch<UserResponse>('/auth/me'),
  login: (payload: LoginPayload) =>
    apiFetch<UserResponse>('/auth/login', { method: 'POST', body: payload }),
  register: (payload: RegisterPayload) =>
    apiFetch<UserResponse>('/auth/register', { method: 'POST', body: payload }),
  logout: () => apiFetch<void>('/auth/logout', { method: 'POST' }),
};

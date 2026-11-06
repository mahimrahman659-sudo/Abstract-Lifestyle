export type UserRole = 'customer' | 'admin';

export interface Address {
  _id: string;
  label?: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: string;
  isDefault: boolean;
}

/** `user` in API responses — never includes passwordHash. */
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  addresses: Address[];
}

export interface UserResponse {
  user: User;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  name: string;
}

/** Request body for POST /users/me/addresses (mirrors server addressSchema). */
export interface AddressPayload {
  label?: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: string;
  isDefault?: boolean;
}

export interface AddressListResponse {
  items: Address[];
}

export interface AddressResponse {
  address: Address;
}

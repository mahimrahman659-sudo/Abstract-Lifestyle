import type { AddressPayload } from '@/lib/types';
import { BD_MOBILE_ERROR, normalizeBdMobile } from '../utils/phone.ts';
import type { FieldErrors } from './auth';

/**
 * Client-side mirror of the server Zod rules (server stays the authority).
 * Kept in sync with the addressSchema in server/src/schemas/user.schema.ts.
 */
export type AddressFormValues = AddressPayload;

export const optionalAddressFields = [
  { name: 'label', label: 'Address label (optional)', maxLength: 30 },
  { name: 'line2', label: 'Address line 2 (optional)', maxLength: 200 },
  { name: 'city', label: 'City (optional)', maxLength: 100 },
  { name: 'state', label: 'State or region (optional)', maxLength: 100 },
  { name: 'postalCode', label: 'Postal code (optional)', maxLength: 20 },
  { name: 'country', label: 'Country (optional)', maxLength: 100 },
] as const;

export const validateAddress = (values: AddressFormValues): FieldErrors<AddressFormValues> => {
  const errors: FieldErrors<AddressFormValues> = {};
  const text = (value: string | undefined): string => (value ?? '').trim();

  const fullName = text(values.fullName);
  if (fullName.length === 0) {
    errors.fullName = 'Full name is required';
  } else if (fullName.length > 100) {
    errors.fullName = 'Full name must be at most 100 characters';
  }

  // Bangladeshi mobile only — spaces/dashes and +880/880 are accepted.
  if (normalizeBdMobile(text(values.phone)) === null) {
    errors.phone = BD_MOBILE_ERROR;
  }

  const line1 = text(values.line1);
  if (line1.length === 0) {
    errors.line1 = 'Address is required';
  } else if (line1.length > 200) {
    errors.line1 = 'Address must be at most 200 characters';
  }

  if (text(values.line2).length > 200) {
    errors.line2 = 'Address line 2 must be at most 200 characters';
  }

  if (text(values.city).length > 100) {
    errors.city = 'City must be at most 100 characters';
  }

  if (text(values.state).length > 100) {
    errors.state = 'State must be at most 100 characters';
  }
  if (text(values.postalCode).length > 20) {
    errors.postalCode = 'Postal code must be at most 20 characters';
  }

  if (text(values.country).length > 100) {
    errors.country = 'Country must be at most 100 characters';
  }

  if (text(values.label).length > 30) {
    errors.label = 'Label must be at most 30 characters';
  }

  return errors;
};

/** Strips empty optional strings so the payload matches the server schema. */
export const cleanAddressPayload = (values: AddressFormValues): AddressPayload => {
  const payload: AddressPayload = {
    fullName: values.fullName.trim(),
    // Send the canonical 01XXXXXXXXX form when the input is valid.
    phone: normalizeBdMobile(values.phone.trim()) ?? values.phone.trim(),
    line1: values.line1.trim(),
  };
  const optional = (
    key: 'label' | 'line2' | 'city' | 'state' | 'postalCode' | 'country',
  ): void => {
    const value = values[key]?.trim();
    if (value) {
      payload[key] = value;
    }
  };
  optional('label');
  optional('line2');
  optional('city');
  optional('state');
  optional('postalCode');
  optional('country');
  return payload;
};

/** PATCH: omitted optional fields stay omitted; explicit empty strings clear them. */
export const addressUpdatePayload = (values: AddressFormValues): AddressPayload => {
  const payload = cleanAddressPayload(values);
  for (const { name } of optionalAddressFields) {
    if (values[name] !== undefined) payload[name] = values[name].trim();
  }
  if (values.isDefault !== undefined) payload.isDefault = values.isDefault;
  return payload;
};

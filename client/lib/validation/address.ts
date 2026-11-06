import type { AddressPayload } from '@/lib/types';
import type { FieldErrors } from './auth';

/**
 * Client-side mirror of the server Zod rules (server stays the authority).
 * Kept in sync with the addressSchema in server/src/schemas/user.schema.ts.
 */
export type AddressFormValues = AddressPayload;

export const validateAddress = (values: AddressFormValues): FieldErrors<AddressFormValues> => {
  const errors: FieldErrors<AddressFormValues> = {};
  const text = (value: string | undefined): string => (value ?? '').trim();

  const fullName = text(values.fullName);
  if (fullName.length === 0) {
    errors.fullName = 'Full name is required';
  } else if (fullName.length > 100) {
    errors.fullName = 'Full name must be at most 100 characters';
  }

  const phone = text(values.phone);
  if (phone.length < 6) {
    errors.phone = 'Phone must be at least 6 characters';
  } else if (phone.length > 20) {
    errors.phone = 'Phone must be at most 20 characters';
  }

  const line1 = text(values.line1);
  if (line1.length === 0) {
    errors.line1 = 'Address line 1 is required';
  } else if (line1.length > 200) {
    errors.line1 = 'Address line 1 must be at most 200 characters';
  }

  if (text(values.line2).length > 200) {
    errors.line2 = 'Address line 2 must be at most 200 characters';
  }

  const city = text(values.city);
  if (city.length === 0) {
    errors.city = 'City is required';
  } else if (city.length > 100) {
    errors.city = 'City must be at most 100 characters';
  }

  if (text(values.state).length > 100) {
    errors.state = 'State must be at most 100 characters';
  }
  if (text(values.postalCode).length > 20) {
    errors.postalCode = 'Postal code must be at most 20 characters';
  }

  const country = text(values.country);
  if (country.length === 0) {
    errors.country = 'Country is required';
  } else if (country.length > 100) {
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
    phone: values.phone.trim(),
    line1: values.line1.trim(),
    city: values.city.trim(),
    country: values.country.trim(),
  };
  const optional = (
    key: 'label' | 'line2' | 'state' | 'postalCode',
  ): void => {
    const value = values[key]?.trim();
    if (value) {
      payload[key] = value;
    }
  };
  optional('label');
  optional('line2');
  optional('state');
  optional('postalCode');
  return payload;
};

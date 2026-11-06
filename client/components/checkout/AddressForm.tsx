'use client';

import { Input } from '@/components/ui/Input';
import type { AddressFormValues } from '@/lib/validation/address';

export type AddressFormErrors = Partial<Record<keyof AddressFormValues, string>>;

interface AddressFormProps {
  idPrefix: string;
  values: AddressFormValues;
  errors: AddressFormErrors;
  disabled?: boolean;
  onChange: (field: keyof AddressFormValues, value: string) => void;
}

/** Shared shipping-address form fields (mobile-first, fully labelled). */
export function AddressForm({ values, errors, disabled, onChange }: AddressFormProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Input
          label="Full name"
          autoComplete="name"
          required
          disabled={disabled}
          value={values.fullName}
          error={errors.fullName}
          onChange={(event) => onChange('fullName', event.target.value)}
        />
      </div>
      <Input
        label="Phone"
        type="tel"
        autoComplete="tel"
        required
        disabled={disabled}
        value={values.phone}
        error={errors.phone}
        onChange={(event) => onChange('phone', event.target.value)}
      />
      <Input
        label="City"
        autoComplete="address-level2"
        required
        disabled={disabled}
        value={values.city}
        error={errors.city}
        onChange={(event) => onChange('city', event.target.value)}
      />
      <div className="sm:col-span-2">
        <Input
          label="Address line 1"
          autoComplete="address-line1"
          required
          disabled={disabled}
          value={values.line1}
          error={errors.line1}
          onChange={(event) => onChange('line1', event.target.value)}
        />
      </div>
      <div className="sm:col-span-2">
        <Input
          label="Address line 2 (optional)"
          autoComplete="address-line2"
          disabled={disabled}
          value={values.line2 ?? ''}
          error={errors.line2}
          onChange={(event) => onChange('line2', event.target.value)}
        />
      </div>
      <Input
        label="State (optional)"
        autoComplete="address-level1"
        disabled={disabled}
        value={values.state ?? ''}
        error={errors.state}
        onChange={(event) => onChange('state', event.target.value)}
      />
      <Input
        label="Postal code (optional)"
        autoComplete="postal-code"
        disabled={disabled}
        value={values.postalCode ?? ''}
        error={errors.postalCode}
        onChange={(event) => onChange('postalCode', event.target.value)}
      />
      <div className="sm:col-span-2">
        <Input
          label="Country"
          autoComplete="country-name"
          required
          disabled={disabled}
          value={values.country}
          error={errors.country}
          onChange={(event) => onChange('country', event.target.value)}
        />
      </div>
    </div>
  );
}

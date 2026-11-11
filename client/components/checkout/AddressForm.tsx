'use client';

import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import type { AddressFormValues } from '@/lib/validation/address';

export type AddressFormErrors = Partial<Record<keyof AddressFormValues, string>>;

interface AddressFormProps {
  idPrefix: string;
  values: AddressFormValues;
  errors: AddressFormErrors;
  disabled?: boolean;
  onChange: (field: keyof AddressFormValues, value: string) => void;
}

/**
 * Checkout shipping fields — exactly what the store needs to deliver and to
 * confirm the order by phone: full name, Bangladeshi mobile number and the
 * address itself.
 */
export function AddressForm({ values, errors, disabled, onChange }: AddressFormProps) {
  return (
    <div className="grid gap-4">
      <Input
        label="Full name"
        autoComplete="name"
        required
        disabled={disabled}
        value={values.fullName}
        error={errors.fullName}
        onChange={(event) => onChange('fullName', event.target.value)}
      />
      <Input
        label="Phone number"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="01XXXXXXXXX"
        hint="We will call this number to confirm your order."
        required
        disabled={disabled}
        value={values.phone}
        error={errors.phone}
        onChange={(event) => onChange('phone', event.target.value)}
      />
      <Textarea
        label="Address"
        autoComplete="street-address"
        placeholder="House, road, area, city"
        rows={3}
        required
        disabled={disabled}
        value={values.line1}
        error={errors.line1}
        onChange={(event) => onChange('line1', event.target.value)}
      />
    </div>
  );
}

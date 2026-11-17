import assert from 'node:assert/strict';
import { it } from 'node:test';
import { addressUpdatePayload, optionalAddressFields, validateAddress, type AddressFormValues } from '../validation/address.ts';

const required = { fullName: 'Customer', phone: '01712345678', line1: 'Dhaka' };
it('preserves and trims every supported optional value during editing', () => {
  const values: AddressFormValues = { ...required };
  for (const { name } of optionalAddressFields) values[name] = ` ${name} value `;
  const payload = addressUpdatePayload(values);
  for (const { name } of optionalAddressFields) assert.equal(payload[name], `${name} value`);
});
it('sends explicit empty and whitespace-only optional values as clear operations', () => {
  for (const empty of ['', '   ']) {
    const values: AddressFormValues = { ...required };
    for (const { name } of optionalAddressFields) values[name] = empty;
    const payload = addressUpdatePayload(values);
    for (const { name } of optionalAddressFields) assert.equal(payload[name], '');
  }
});
it('keeps omitted optional fields omitted from the PATCH payload', () => {
  const payload = addressUpdatePayload(required);
  for (const { name } of optionalAddressFields) assert.equal(Object.hasOwn(payload, name), false);
});
it('rejects invalid required fields', () => {
  const errors = validateAddress({ fullName: '', phone: 'invalid', line1: '' });
  assert.ok(errors.fullName && errors.phone && errors.line1);
});
it('validates the length of each supported optional field', () => {
  for (const { name, maxLength } of optionalAddressFields) {
    assert.ok(validateAddress({ ...required, [name]: 'x'.repeat(maxLength + 1) })[name]);
  }
});
it('normalizes a formatted phone and preserves an explicit default flag', () => {
  const payload = addressUpdatePayload({ ...required, phone: '+8801712345678', isDefault: false });
  assert.equal(payload.phone, '01712345678'); assert.equal(payload.isDefault, false);
});

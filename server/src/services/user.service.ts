import { AppError } from '../middleware/error-handler.js';
import type { Address, UserDocument } from '../models/user.model.js';
import type { AddressInput, AddressUpdateInput, UpdateProfileInput } from '../schemas/user.schema.js';

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: 'customer' | 'admin';
  addresses: Address[];
}

/** Public user shape — never includes passwordHash. */
export const toUserDto = (user: UserDocument): UserDto => ({
  id: user._id.toString(),
  email: user.email,
  name: user.name,
  role: user.role,
  addresses: user.addresses,
});

export const updateProfile = async (
  user: UserDocument,
  input: UpdateProfileInput,
): Promise<UserDocument> => {
  if (input.name !== undefined) {
    user.name = input.name;
  }
  await user.save();
  return user;
};

export const listAddresses = (user: UserDocument): Address[] => user.addresses;

export const addAddress = async (user: UserDocument, input: AddressInput): Promise<Address> => {
  if (input.isDefault) {
    for (const existing of user.addresses) {
      existing.isDefault = false;
    }
  }

  user.addresses.push(input);
  await user.save();

  const created = user.addresses[user.addresses.length - 1];
  if (!created) {
    throw new AppError(500, 'SERVER_ERROR', 'Failed to save address');
  }
  return created;
};

export const updateAddress = async (
  user: UserDocument,
  addressId: string,
  input: AddressUpdateInput,
): Promise<Address> => {
  const address = user.addresses.find(
    (existing) => existing._id !== undefined && existing._id.toString() === addressId,
  );
  if (!address) {
    throw new AppError(404, 'NOT_FOUND', 'Address not found');
  }

  if (input.isDefault) {
    for (const existing of user.addresses) {
      if (existing._id?.toString() !== addressId) {
        existing.isDefault = false;
      }
    }
  }

  if (input.label !== undefined) address.label = input.label;
  if (input.fullName !== undefined) address.fullName = input.fullName;
  if (input.phone !== undefined) address.phone = input.phone;
  if (input.line1 !== undefined) address.line1 = input.line1;
  if (input.line2 !== undefined) address.line2 = input.line2;
  if (input.city !== undefined) address.city = input.city;
  if (input.state !== undefined) address.state = input.state;
  if (input.postalCode !== undefined) address.postalCode = input.postalCode;
  if (input.country !== undefined) address.country = input.country;
  if (input.isDefault !== undefined) address.isDefault = input.isDefault;

  await user.save();
  return address;
};

export const deleteAddress = async (user: UserDocument, addressId: string): Promise<void> => {
  const exists = user.addresses.some(
    (existing) => existing._id !== undefined && existing._id.toString() === addressId,
  );
  if (!exists) {
    throw new AppError(404, 'NOT_FOUND', 'Address not found');
  }

  user.addresses = user.addresses.filter(
    (existing) => existing._id?.toString() !== addressId,
  );
  await user.save();
};

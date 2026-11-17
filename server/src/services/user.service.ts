import { AppError } from '../middleware/error-handler.js';
import mongoose from 'mongoose';
import { UserModel } from '../models/user.model.js';
import type { Address, UserDocument } from '../models/user.model.js';
import type { AddressInput, AddressUpdateInput, UpdateProfileInput } from '../schemas/user.schema.js';

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: 'customer' | 'admin';
  addresses: Address[];
}

/** Public user shape — never includes passwordHash or googleId. */
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
  const updated = await UserModel.findByIdAndUpdate(user._id, { $set: { name: input.name } }, { returnDocument: 'after', runValidators: true }).exec();
  if (!updated) throw new AppError(404, 'NOT_FOUND', 'Account not found');
  return updated;
};

/** Reload within a transaction so concurrent address edits retry on fresh data. */
const mutateAddresses = async <T>(user: UserDocument, mutate: (fresh: UserDocument) => Promise<T>): Promise<T> => {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const fresh = await UserModel.findById(user._id).session(session).exec();
      if (!fresh) throw new AppError(404, 'NOT_FOUND', 'Account not found');
      const result = await mutate(fresh);
      const selected = fresh.addresses.find((address) => address.isDefault) ?? fresh.addresses[0];
      for (const address of fresh.addresses) address.isDefault = address === selected;
      await fresh.save({ session });
      return result;
    });
  } finally { await session.endSession(); }
};

export const listAddresses = (user: UserDocument): Address[] => user.addresses;

export const addAddress = async (user: UserDocument, input: AddressInput): Promise<Address> => {
  return mutateAddresses(user, async (user) => {
  if (input.isDefault) {
    for (const existing of user.addresses) {
      existing.isDefault = false;
    }
  }

  user.addresses.push(input);

  const created = user.addresses[user.addresses.length - 1];
  if (!created) {
    throw new AppError(500, 'SERVER_ERROR', 'Failed to save address');
  }
  return created;
  });
};

export const updateAddress = async (
  user: UserDocument,
  addressId: string,
  input: AddressUpdateInput,
): Promise<Address> => {
  return mutateAddresses(user, async (user) => {
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

  return address;
  });
};

export const deleteAddress = async (user: UserDocument, addressId: string): Promise<void> => {
  await mutateAddresses(user, async (user) => {
  const exists = user.addresses.some(
    (existing) => existing._id !== undefined && existing._id.toString() === addressId,
  );
  if (!exists) {
    throw new AppError(404, 'NOT_FOUND', 'Address not found');
  }

  user.addresses = user.addresses.filter(
    (existing) => existing._id?.toString() !== addressId,
  );
  });
};

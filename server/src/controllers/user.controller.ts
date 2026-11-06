import type { RequestHandler } from 'express';
import { getAuthUser } from '../middleware/auth.js';
import { objectIdSchema } from '../schemas/common.schema.js';
import {
  addAddress,
  deleteAddress,
  listAddresses,
  toUserDto,
  updateAddress,
  updateProfile,
} from '../services/user.service.js';

export const updateMe: RequestHandler = async (req, res) => {
  const user = await updateProfile(getAuthUser(req), req.body);
  res.status(200).json({ user: toUserDto(user) });
};

export const getAddresses: RequestHandler = (req, res) => {
  res.status(200).json({ items: listAddresses(getAuthUser(req)) });
};

export const createAddress: RequestHandler = async (req, res) => {
  const address = await addAddress(getAuthUser(req), req.body);
  res.status(201).json({ address });
};

export const patchAddress: RequestHandler = async (req, res) => {
  const addressId = objectIdSchema.parse(req.params.id);
  const address = await updateAddress(getAuthUser(req), addressId, req.body);
  res.status(200).json({ address });
};

export const removeAddress: RequestHandler = async (req, res) => {
  const addressId = objectIdSchema.parse(req.params.id);
  await deleteAddress(getAuthUser(req), addressId);
  res.status(204).end();
};

import type { RequestHandler } from 'express';
import { getAuthUser } from '../middleware/auth.js';
import {
  addToCartSchema,
  cartItemParamsSchema,
  mergeCartSchema,
  updateCartItemSchema,
} from '../schemas/cart.schema.js';
import {
  addItem,
  clearCart,
  getCart,
  mergeGuestItems,
  removeItem,
  updateItem,
} from '../services/cart.service.js';

export const getCartHandler: RequestHandler = async (req, res) => {
  const user = getAuthUser(req);
  res.status(200).json(await getCart(user._id));
};

export const addItemHandler: RequestHandler = async (req, res) => {
  const input = addToCartSchema.parse(req.body);
  const user = getAuthUser(req);
  res.status(200).json(await addItem(user._id, input.variantId, input.quantity));
};

export const updateItemHandler: RequestHandler = async (req, res) => {
  const { variantId } = cartItemParamsSchema.parse(req.params);
  const input = updateCartItemSchema.parse(req.body);
  const user = getAuthUser(req);
  res.status(200).json(await updateItem(user._id, variantId, input.quantity));
};

export const removeItemHandler: RequestHandler = async (req, res) => {
  const { variantId } = cartItemParamsSchema.parse(req.params);
  const user = getAuthUser(req);
  res.status(200).json(await removeItem(user._id, variantId));
};

export const clearCartHandler: RequestHandler = async (req, res) => {
  const user = getAuthUser(req);
  res.status(200).json(await clearCart(user._id));
};

export const mergeCartHandler: RequestHandler = async (req, res) => {
  const input = mergeCartSchema.parse(req.body);
  const user = getAuthUser(req);
  res.status(200).json(await mergeGuestItems(user._id, input.items));
};
